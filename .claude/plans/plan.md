# Plan: Native Swift iOS Jarvis Client

## Contract

### 1. Problem

No native iOS app exists. The current Jarvis voice assistant runs in a browser. We want a native Swift iPhone app that connects to the existing hosted server and provides the same live voice conversation experience — talk, hear responses, use tools (weather, recall, GitHub), see transcript.

### 2. Requirements

| ID  | Priority | Requirement                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------ |
| R1  | P0       | App connects to the existing server, establishes WebRTC session with OpenAI, and plays audio responses |
| R2  | P0       | Push-to-talk: hold to speak, release to send — model responds with voice                               |
| R3  | P0       | Sideband connects so server-side tools (weather, recall, GitHub, capabilities) work                    |
| R4  | P0       | Live transcript displays assistant speech and tool activity                                            |
| R5  | P1       | Connect/disconnect lifecycle with clear state indication                                               |
| R6  | P1       | VAD toggle (hands-free mode)                                                                           |
| R7  | P2       | Session history list and detail screens                                                                |
| R8  | P2       | Latency badge (RTT from WebRTC stats)                                                                  |

### 3. Acceptance criteria

**Given** the server is running (locally or on Railway),
**When** I open the app, tap Connect, hold the PTT button, speak, and release,
**Then** I hear Jarvis respond, see the transcript update, and tools fire through the sideband.

**Given** I ask about the weather,
**Then** the transcript shows "Checking weather..." and Jarvis speaks the result.

### 4. Non-goals

- App Store distribution
- Production quality error handling / retry logic
- Audio-reactive orb animation (simple state indicator is sufficient)
- Background audio / wake word
- Authentication / multi-user
- Offline mode
- CallKit integration
- iPad-specific layout

### 5. Constraints

- Existing server API must remain unchanged — no backend modifications
- Xcode is required for building/running (VS Code can edit Swift files but cannot build iOS apps)
- Must work on iOS Simulator at minimum; physical device is stretch goal
- Single SPM dependency: `stasel/WebRTC` (pre-built Google WebRTC XCFramework)

---

## Implementation Plan

### 1. Summary

Build a native SwiftUI app in an `ios/` subdirectory of the existing monorepo. The app is a thin client that calls the same 4 server API endpoints the React frontend uses, then establishes a WebRTC peer connection to OpenAI Realtime using the same ephemeral key + SDP + data channel flow. All tool execution, memory, and persistence remain server-side. The app contains ~10 Swift files with one external dependency (`stasel/WebRTC`).

The core architectural decision is: **replicate only the browser's transport layer** (`useSession.ts`) **in Swift, change nothing else**. The server stays identical. The WebRTC protocol is identical. The only difference is native `RTCPeerConnection` + `AVAudioSession` instead of browser APIs.

### 2. Current state

The system this app will connect to:

| Layer                 | What exists                                                  | Where                                  |
| --------------------- | ------------------------------------------------------------ | -------------------------------------- |
| Session minting       | `POST /api/session` → `{ ephemeralKey }`                     | `src/server/routes/session.ts:128-159` |
| Sideband bootstrap    | `POST /api/session/sideband` with `{ callId, ephemeralKey }` | `src/server/routes/session.ts:161-247` |
| Tool execution        | Server-side via sideband WebSocket                           | `src/server/realtime/sideband.ts`      |
| History               | `GET /api/sessions`, `GET /api/sessions/:id/turns`           | `src/server/routes/history.ts`         |
| Client (to replicate) | WebRTC + data channel + state machine                        | `client/src/hooks/useSession.ts`       |
| Types (to mirror)     | VoiceState, Turn, SessionSummary, etc.                       | `client/src/types.ts`                  |

The React frontend's `useSession.ts` (497 lines) is the ground truth for the Swift app's behavior. Every state transition, data channel event, and API call in the Swift app should match it.

### 3. Files to create

All files live under `ios/Jarvis/` (created after Xcode project setup).

| File                       | Purpose                                                  | Lines (est.) | Follows pattern from                                      |
| -------------------------- | -------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `Config.swift`             | Base URL, compile-time DEBUG/RELEASE switch              | ~15          | —                                                         |
| `Models.swift`             | Codable types mirroring `client/src/types.ts`            | ~120         | `client/src/types.ts`                                     |
| `APIClient.swift`          | URLSession calls to 4 server endpoints                   | ~80          | `client/src/api/session.ts`                               |
| `WebRTCManager.swift`      | RTCPeerConnection + data channel + state machine         | ~350         | `client/src/hooks/useSession.ts` + `VoiceModeWebRTCSwift` |
| `JarvisApp.swift`          | @main SwiftUI App entry point                            | ~15          | Standard SwiftUI template                                 |
| `ContentView.swift`        | Main conversation screen (orb area, buttons, transcript) | ~120         | `client/src/App.tsx`                                      |
| `TranscriptView.swift`     | Scrollable transcript list                               | ~50          | `client/src/components/Transcript.tsx`                    |
| `PttButton.swift`          | Long-press PTT button                                    | ~40          | `client/src/components/PttButton.tsx`                     |
| `StatusIndicator.swift`    | Voice state color/label display                          | ~30          | `client/src/components/StatusBadge.tsx`                   |
| `SessionHistoryView.swift` | Session list + detail screens                            | ~100         | `client/src/components/SessionSidebar.tsx`                |
| `GitHubDigestCard.swift`   | Styled card for GitHub tool results                      | ~80          | `client/src/components/GitHubDigestPanel.tsx`             |
| `ios/.gitignore`           | Ignore DerivedData, xcuserstate, etc.                    | ~15          | Standard Xcode gitignore                                  |

**Total: ~12 files, ~1015 lines estimated.**

The VoiceModeWebRTCSwift reference app (same pattern — SwiftUI + WebRTC + OpenAI Realtime) is ~400 lines across 4 files. Our app is larger because it adds transcript, tool display, PTT/VAD toggle, sideband connection, and history — but it's the same architectural shape.

### 4. Critical technical details for implementation

#### 4a. WebRTC session flow (must match useSession.ts exactly)

```
1. POST /api/session → { ephemeralKey }
2. Create RTCPeerConnectionFactory (share one instance)
3. Configure AVAudioSession: .playAndRecord, mode: .videoChat, defaultToSpeaker
4. Create RTCPeerConnection (no ICE servers — OpenAI handles ICE)
5. Create audio track with echo cancellation constraints, add to peer connection
6. Set track.isEnabled = false (starts muted for PTT)
7. Create data channel with label "oai-events"
8. Create SDP offer with OfferToReceiveAudio: "true"
9. Set local description
10. POST SDP to https://api.openai.com/v1/realtime/calls
    - Authorization: Bearer {ephemeralKey}
    - Content-Type: application/sdp
    - Body: raw SDP string
11. Extract callId from Location header: /v1/realtime/calls/rtc_xxxx → "rtc_xxxx"
12. Set remote description from response body (answer SDP)
13. POST /api/session/sideband with { callId, ephemeralKey }
14. On data channel open → set state = .ready
```

**CRITICAL:** The SDP endpoint is `https://api.openai.com/v1/realtime/calls` (GA endpoint). The VoiceModeWebRTCSwift reference uses the old beta endpoint (`/v1/realtime?model=...`) — do NOT copy that URL. Use the GA endpoint matching `useSession.ts:367`.

**CRITICAL:** The sideband requires `ephemeralKey` (per ADR-009 in `docs/decisions.md`). Do not simplify this away.

#### 4b. Data channel events to handle

Server → Client (from `useSession.ts:162-241`):

| Event type                               | Action                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| `response.output_audio_transcript.delta` | Append delta to transcript, set state = `.speaking`  |
| `response.output_audio_transcript.done`  | Finalize transcript entry (mark `isFinal = true`)    |
| `response.function_call_arguments.done`  | Add tool entry to transcript, set state = `.working` |
| `response.done`                          | Set state = `.ready`                                 |
| `response.cancelled`                     | Set state = `.ready`                                 |
| `input_audio_buffer.speech_started`      | Set state = `.listening` (VAD mode)                  |
| `input_audio_buffer.speech_stopped`      | Set state = `.processing` (VAD mode)                 |
| `session.updated`                        | Log only                                             |
| `conversation.item.created`              | Parse GitHub digest from tool output (stretch)       |
| `error`                                  | Log                                                  |

Client → Server:

| Action      | Events sent                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------- |
| PTT start   | `input_audio_buffer.clear`, then if speaking: `response.cancel` + `output_audio_buffer.clear` |
| PTT stop    | `input_audio_buffer.commit`, `response.create`                                                |
| VAD enable  | `session.update` with `semantic_vad` config                                                   |
| VAD disable | `session.update` with `turn_detection: null`                                                  |

#### 4c. Voice state machine (from `client/src/types.ts:1-9`)

```
disconnected → [connect()] → connecting → [dc.open] → ready
ready → [startTalking / speech_started] → listening
listening → [stopTalking / speech_stopped] → processing
processing → [transcript.delta] → speaking
speaking → [response.done / cancelled] → ready
any → [function_call_arguments.done] → working → [response.done] → ready
any → [connection error] → error / disconnected
```

#### 4d. AVAudioSession setup (from VoiceModeWebRTCSwift — proven pattern)

```swift
let session = AVAudioSession.sharedInstance()
try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
try session.setMode(.videoChat)
try session.setActive(true, options: .notifyOthersOnDeactivation)
```

This MUST be called before `RTCPeerConnectionFactory` initialization. WebRTC's Audio Device Module takes ownership of AVAudioSession after factory creation. Configuring it afterward causes silent mic/speaker failure.

#### 4e. Thread safety (High severity risk)

WebRTC delegates fire on arbitrary background threads. All `@Published` property mutations must dispatch to main actor:

```swift
// In every RTCDataChannelDelegate / RTCPeerConnectionDelegate method:
Task { @MainActor in
    self.state = .ready  // safe
}
```

Missing this causes SwiftUI runtime crashes. This pattern must be in EVERY delegate callback.

#### 4f. Tool labels (from `useSession.ts:83-88`)

```swift
let toolLabels: [String: String] = [
    "recall": "Searching memory",
    "get_weather": "Checking weather",
    "github": "Looking up GitHub",
    "capabilities": "Checking capabilities",
]
```

#### 4g. Transcript accumulation (from `useSession.ts:122-140`)

- If last entry has same role AND `isFinal == false`: replace with concatenated text (streaming delta)
- Otherwise: push new entry with `isFinal = false`
- Finalize: set `isFinal = true` on last entry

#### 4h. RealtimeEvent decoding

OpenAI data channel events use `snake_case` keys (e.g., `call_id`, `turn_detection`). Swift `Codable` defaults to `camelCase`. Use explicit `CodingKeys` for fields that differ:

```swift
struct RealtimeEvent: Decodable {
    let type: String
    let delta: String?
    let name: String?
    let item: RealtimeItem?
    // ...
    enum CodingKeys: String, CodingKey {
        case type, delta, name, item
        case callId = "call_id"
    }
}
```

### 5. Milestone outline

#### M1: Project scaffold + API client (no WebRTC)

`- [x] M1: Network foundation — server API calls work from iOS`

- [x] Step 1 — Create `ios/.gitignore` with Xcode ignores
- [x] Step 2 — Write `Config.swift` with DEBUG/RELEASE base URL switch
- [x] Step 3 — Write `Models.swift` with Codable types mirroring `client/src/types.ts`
- [x] Step 4 — Write `APIClient.swift` with 4 URLSession endpoints
- [x] Step 5 — Update `JarvisApp.swift` with onAppear API test (createSession + listSessions)
      Commit: "feat: add iOS API client and Codable models (M1)"
      Verify: Build succeeds in Xcode, Simulator console shows ephemeral key + session list

Note: Source files live at `ios/Jarvis/Jarvis/` (Xcode default nesting).

Depends on: **Manual setup tasks S1, S2** ✅ (both done)

Verification: Run in Simulator, confirm `POST /api/session` returns `{ ephemeralKey }` and `GET /api/sessions` returns session list. Log output to Xcode console.

#### M2: WebRTC connection + audio + state machine

`- [x] M2: Voice connection — mic to OpenAI to speaker works`

- [x] Step 1 — Write `WebRTCManager.swift` (~380 lines): AVAudioSession setup, factory, peer connection, audio track, data channel, SDP exchange, sideband, state machine, PTT, VAD, transcript, GitHub digest parsing
- [x] Step 2 — Update `ContentView.swift` with temporary Connect button + PTT button wired to WebRTCManager
- [x] Step 3 — Remove M1 verification code from `JarvisApp.swift`
      Commit: "feat: add WebRTC voice connection with PTT and state machine (M2)"
      Verify: Build in Xcode, run in Simulator, tap Connect → data channel opens → hold PTT → speak → release → hear Jarvis respond. Console shows DC events. Ask about weather to verify sideband.

Depends on: **Manual setup task S3** (add WebRTC SPM package)

Verification: Run in Simulator → tap Connect → hold PTT → speak → release → hear Jarvis respond. Sideband connected (tools work). Console logs show data channel events flowing.

#### M3: SwiftUI interface + polish

`- [ ] M3: Demo-ready UI — transcript, status, PTT, VAD, history, GitHub digest`

Build SwiftUI views (ContentView, TranscriptView, PttButton, StatusIndicator), wire to WebRTCManager. Add VAD toggle. Add session history (list + detail). Add styled GitHub digest card for tool results.

Verification: Full demo flow — connect, talk, see transcript update, tools fire (weather shows in transcript, GitHub shows styled card), disconnect. Session history shows past sessions. App looks presentable on physical iPhone.

### 6. Testing strategy

**Unit tests (M1):**

- `Models` Codable round-trip: encode → decode → verify fields
- `APIClient` response decoding: mock JSON → verify struct fields
- Use Swift Testing framework (`@Test` macro, Xcode 16+)

**Manual integration tests (M2-M3):**

- WebRTC/audio cannot be meaningfully unit tested — requires live OpenAI connection
- Test matrix: Simulator mic → OpenAI → speaker, PTT cycle, VAD cycle, tool execution
- Physical device test before demo (if available)

**No server tests needed** — the server API is already well-tested (56 `it()` cases across 9 test files). The iOS app is a new consumer of existing, stable endpoints.

### 7. Migration & rollback

Not applicable. The iOS app is additive — it lives in `ios/` and does not touch any existing server or client code. Rollback = delete `ios/`.

### 8. Manual setup tasks

These are actions the user must perform that Claude cannot automate.

#### S1: Create Xcode project (before M1)

1. Open Xcode 16+
2. File → New → Project → iOS → App
3. Product Name: `Jarvis`
4. Team: your Apple ID (free is fine)
5. Organization Identifier: `com.jarvis` (or any)
6. Interface: SwiftUI
7. Language: Swift
8. Storage: None
9. Include Tests: Yes
10. Save location: `ios/` directory in the repo root

This creates `ios/Jarvis.xcodeproj/` and `ios/Jarvis/` source directory.

#### S2: Configure Info.plist (before M1)

In Xcode, select the Jarvis target → Info tab. Add:

| Key                                                  | Value                                                    |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `NSMicrophoneUsageDescription`                       | `Jarvis needs microphone access for voice conversation.` |
| `NSAppTransportSecurity` → `NSAllowsLocalNetworking` | `YES`                                                    |

Without `NSMicrophoneUsageDescription`, the app crashes when WebRTC requests mic access.
Without `NSAllowsLocalNetworking`, HTTP calls to `localhost:3000` are blocked by App Transport Security.

#### S3: Add WebRTC SPM dependency (before M2)

In Xcode: File → Add Package Dependencies

| Field           | Value                                  |
| --------------- | -------------------------------------- |
| URL             | `https://github.com/stasel/WebRTC.git` |
| Dependency Rule | Up to Next Major Version               |
| Version         | `141.0.0`                              |
| Add to Target   | `Jarvis`                               |

This downloads ~120 MB of pre-built WebRTC XCFramework. First resolution takes 1-2 minutes.

#### S4: Ensure server is running (before M1 verification)

The iOS app needs the backend running. Either:

- **Local dev:** `npm run dev` in the repo root → server at `http://localhost:3000`
- **Railway:** Use the deployed URL (update `Config.swift` release URL)

For Simulator: `http://localhost:3000` works (Simulator shares Mac's network).
For physical device: use Mac's LAN IP (e.g., `http://192.168.x.x:3000`).

#### S5: Physical device setup (optional, for demo)

Free Apple ID provisioning works — no $99/yr program needed for personal device testing.

1. In Xcode: Settings → Accounts → add Apple ID
2. Select Jarvis target → Signing & Capabilities → Team: your Apple ID
3. Connect iPhone via USB or WiFi
4. Select device as run target → Run

Limitations: app certificate expires after 7 days (rebuild to renew). Max 3 devices.

### 9. Risks

| #   | Risk                                                                                                                         | Severity | Detection                                                                | Mitigation                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **AVAudioSession conflict with WebRTC ADM** — configuring audio session after factory init causes silent mic/speaker failure | High     | No audio in/out despite successful connection                            | Configure AVAudioSession BEFORE `RTCPeerConnectionFactory` init. Follow VoiceModeWebRTCSwift proven pattern exactly.        |
| 2   | **Thread safety in WebRTC delegates** — `@Published` mutations from background threads crash SwiftUI                         | High     | Runtime crash on state change                                            | Wrap EVERY delegate callback body in `Task { @MainActor in ... }`. No exceptions.                                           |
| 3   | **SDP endpoint mismatch** — using beta URL (`/v1/realtime?model=...`) instead of GA (`/v1/realtime/calls`)                   | High     | SDP exchange returns error; no `Location` header; sideband can't connect | Use `https://api.openai.com/v1/realtime/calls` exactly as in `useSession.ts:367`. Do NOT copy the VoiceModeWebRTCSwift URL. |
| 4   | **Simulator WebRTC audio regression** — some stasel/WebRTC versions have silent Simulator mic                                | Medium   | Mic capture works but no audio reaches OpenAI                            | Pin to `141.0.0`. If hit, test on physical device instead of debugging Simulator audio plumbing.                            |
| 5   | **Location header absent** — if OpenAI changes response format, callId extraction fails, sideband can't connect              | Medium   | `callId` is nil; tools don't fire                                        | Add nil check + log. The sideband is optional for basic audio — voice still works without tools.                            |
| 6   | **Ephemeral key not sent to sideband** — if simplified, sideband auth fails per ADR-009                                      | Medium   | Sideband returns 404/401; tools don't work                               | Always send `ephemeralKey` in sideband POST body. Do not change this.                                                       |
| 7   | **snake_case JSON decoding** — OpenAI events use `call_id`, `turn_detection` etc.                                            | Medium   | Decoding silently produces nil fields                                    | Use explicit `CodingKeys` on `RealtimeEvent`. Test decoding with sample JSON in unit tests.                                 |

### 10. Decisions (resolved)

1. **Physical device for demo** — Yes. User will connect their iPhone. S5 (device setup) is required. Simulator is the development workflow; physical device is the demo target.

2. **Server URL for demo** — Railway (production) preferred. `Config.swift` release URL should point to the Railway deployment. Local `npm run dev` for development/debugging only.

3. **Session history** — Include in M3. Low risk, already in the API, adds demo value. Keep it simple — list view + detail view.

4. **GitHub digest panel** — Include styled cards in M3. The structured data is already in the `conversation.item.created` event payload. Adds ~50 lines SwiftUI, high demo impact.

---

## Reference material

### Key source files in this repo (ground truth)

- `client/src/hooks/useSession.ts` — **THE** file to replicate in Swift. Every WebRTC operation, every data channel event, every state transition.
- `client/src/api/session.ts` — 4 API calls (createSession, connectSideband, listSessions, getSessionTurns)
- `client/src/types.ts` — All shared types (VoiceState, Turn, SessionSummary, GitHubDigest, etc.)
- `src/server/routes/session.ts` — Server endpoints the app calls
- `docs/decisions.md` — ADR-009 (sideband auth) and ADR-010 (GA migration) are particularly relevant

### External references

- `stasel/WebRTC` SPM package: `https://github.com/stasel/WebRTC.git` v141.0.0
- `VoiceModeWebRTCSwift` (reference implementation, ~400 lines): `https://github.com/PallavAg/VoiceModeWebRTCSwift`
- OpenAI Realtime WebRTC guide: `https://platform.openai.com/docs/guides/realtime-webrtc`

### Differences from VoiceModeWebRTCSwift reference

The reference app is the closest existing pattern but has key differences that must NOT be copied:

| Aspect            | VoiceModeWebRTCSwift           | Our app                                         |
| ----------------- | ------------------------------ | ----------------------------------------------- |
| Auth              | Raw API key                    | Ephemeral key from server (`POST /api/session`) |
| SDP endpoint      | Beta: `/v1/realtime?model=...` | GA: `/v1/realtime/calls`                        |
| callId extraction | Not done                       | Extract from `Location` header                  |
| Sideband          | Not used                       | Required — `POST /api/session/sideband`         |
| Input mode        | Always VAD                     | PTT default, VAD toggle                         |
| Transcript        | Not implemented                | Full streaming delta accumulation               |
| Tool display      | Not implemented                | Tool labels + GitHub digest                     |
| Factory           | Created twice (bug)            | Share one instance                              |
