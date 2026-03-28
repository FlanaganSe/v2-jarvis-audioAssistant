# Product Overview

## What this is

Jarvis is a real-time voice assistant demo. You talk to it, it talks back. It can check the weather, look up GitHub repos/issues/PRs, recall past conversations, and describe its own capabilities. Audio streams directly between the client (browser or iOS) and OpenAI via WebRTC — the server never touches audio. The server participates only to mint sessions and execute tools via a sideband WebSocket to the same OpenAI session. Two clients exist: a React web app and a native SwiftUI iOS app.

## Architecture

A request flows through two parallel paths:

```
Browser / iOS ──WebRTC──> OpenAI Realtime API ──WebRTC──> Browser / iOS
                               │
                          sideband WS
                               │
                            Server (tool execution, persistence)
```

1. **Session creation:** Client POSTs `/api/session`. Server calls OpenAI to mint an ephemeral key. Client uses it for the WebRTC SDP exchange with OpenAI directly (`https://api.openai.com/v1/realtime/calls`).
2. **Sideband:** After WebRTC connects, client POSTs `/api/session/sideband` with the `callId` (from the SDP response `Location` header) and `ephemeralKey`. Server opens a WebSocket to `wss://api.openai.com/v1/realtime?call_id=...` authenticated with the ephemeral key.
3. **Tool execution:** When OpenAI decides to call a tool, it sends `response.function_call_arguments.done` over both the data channel (client shows "working" state) and the sideband WS (server dispatches the handler). Server sends the result back over the sideband. OpenAI generates speech from the result.
4. **Persistence:** Turns, tool calls, and evidence are written to PostgreSQL as they happen. When the sideband closes, the server generates a summary via `gpt-4o-mini`.
5. **Client notifications:** All client-visible tool data comes from existing channels — OpenAI data channel events, REST API, and `RTCPeerConnection.getStats()`. No SSE or server push (ADR-011).

Both the web and iOS clients follow the same flow. The iOS client uses the `stasel/WebRTC` framework (Google's `libwebrtc` compiled for Apple platforms) and extracts the `callId` from the SDP exchange `Location` header.

The server never touches audio. It only handles session minting, tool dispatch, and persistence.

## Directory structure

```
src/
  config.ts                    # Zod env schema
  db/
    schema.ts                  # Drizzle table definitions (5 tables)
    index.ts                   # DB singleton (connectDb/getDb/disconnectDb)
    persistence.ts             # Query builders (CRUD + full-text search)
  server/
    server.ts                  # Entry point, startup, graceful shutdown
    app.ts                     # Fastify factory (cors, rate-limit, static, routes)
    routes/
      session.ts               # POST /api/session, POST /api/session/sideband
      history.ts               # GET /api/sessions, GET /api/sessions/:id/turns
    realtime/
      sideband.ts              # WebSocket to OpenAI, tool dispatch, keepalive
      summary.ts               # Post-session summary generation via gpt-4o-mini
    tools/
      recall.ts                # Memory search (full-text on turns + summaries)
      weather.ts               # Open-Meteo geocode + forecast
      capabilities.ts          # Static self-description
      evidence.ts              # Evidence record creation + persistence
      github/
        tool.ts                # Entry point, delegates to fetchers
        parser.ts              # URL → { owner, repo, type, number, path }
        fetchers.ts            # Octokit calls for repo/file/issue/PR
        client.ts              # Octokit factory with throttle
client/
  src/
    App.tsx                    # Top-level layout + auto-reconnect on visibility change
    main.tsx                   # React 19 entry (createRoot)
    types.ts                   # VoiceState, Turn, SessionSummary, GitHubDigest, etc.
    index.css                  # Tailwind import + custom orb animations
    api/session.ts             # Fetch wrappers for server endpoints
    hooks/
      useSession.ts            # WebRTC lifecycle, state machine, data channel events
      useAnalyser.ts           # Web Audio RMS amplitude → CSS variable for orb
    components/
      Orb.tsx                  # Audio-reactive animated sphere (CSS, no WebGL)
      PttButton.tsx            # Push-to-talk (spacebar + mouse/touch)
      VadToggle.tsx            # PTT ↔ semantic VAD toggle
      Transcript.tsx           # Chat-like scroll log (user/assistant/tool turns)
      SessionSidebar.tsx       # Past session history with expandable detail
      StatusBadge.tsx          # Connection state label + color
      LatencyBadge.tsx         # WebRTC RTT display (color-coded)
      GitHubDigestPanel.tsx    # Structured GitHub tool result cards
ios/
  Jarvis/Jarvis/
    JarvisApp.swift            # SwiftUI app entry point
    Config.swift               # Base URL (localhost debug, Railway prod)
    APIClient.swift            # URLSession wrappers for server endpoints
    Models.swift               # VoiceState, TranscriptEntry, GitHubDigest, RealtimeEvent
    WebRTCManager.swift        # RTCPeerConnection lifecycle, data channel, state machine
    ContentView.swift          # Main screen (connect, PTT, VAD, transcript, digest)
    PttButton.swift            # Hold-to-talk (long press gesture)
    StatusIndicator.swift      # Voice state badge
    TranscriptView.swift       # Scrollable chat log
    SessionHistoryView.swift   # Past sessions list + detail sheet
    GitHubDigestCard.swift     # Structured GitHub result cards
drizzle/                       # Generated SQL migrations
public/                        # Dev-only fallback static assets (legacy)
docs/                          # ADRs, requirements, this file
```

## Core concepts

**Session:** A voice conversation. Has a start/end time, metadata (including `callId`), turns, tool calls, and a post-session summary. Stored in `sessions` table.

**Turn:** A single user or assistant utterance within a session. Transcribed from audio. Stored in `turns` table with full-text search index via `to_tsvector`.

**Tool call:** A function invocation triggered by OpenAI during conversation. Stores the tool name, arguments, and result as JSONB. Not always linked to a specific turn (`turnId` is nullable).

**Evidence:** A citation record for tool results. Captures source type (weather, github_repo, etc.), URL, and snippet. Used to ground AI responses in verifiable facts.

**Summary:** Post-session structured extraction via `gpt-4o-mini`. Contains topics, entities, key facts, and unresolved questions. Powers the recall tool's cross-session search.

**Sideband:** The WebSocket connection from server to OpenAI that runs parallel to the browser's WebRTC stream. This is how the server executes tools — it receives tool call events, runs handlers, and sends results back. Ping keepalive every 25s, 10s connection timeout.

**GitHub Digest:** Client-side parsed structured data from GitHub tool results. Displayed as typed cards (repo/issue/pull/file) in `GitHubDigestPanel`. Extracted from `conversation.item.created` data channel events.

## Key patterns and conventions

- **Named exports only.** No default exports.
- **Co-located tests.** `foo.ts` → `foo.test.ts` in the same directory.
- **Immutable patterns, functional style.** Pure functions, `readonly` interfaces, no mutation.
- **Fastify structured logging.** `app.log.info/warn/error` with object-first args. Never `console.log` in server code.
- **Graceful degradation.** Missing `DATABASE_URL` → echo-only mode. Missing `GITHUB_TOKEN` → GitHub tool disabled. Logged at startup.
- **Evidence-grounded responses.** Tools return `evidence` alongside data. The system prompt instructs the AI to cite sources and refuse to fabricate.
- **Tool pluggability.** Each tool exports a `TOOL_DEF` (OpenAI function schema) and a `handle*` function. `buildToolDefs()` and `buildToolHandler()` in `session.ts` wire them together conditionally based on available config/db.
- **No external state library.** All client state lives in `useSession()` hook. Components receive props from `App.tsx`.
- **CSS animations over JS.** Orb uses CSS custom property `--amplitude` updated via `requestAnimationFrame`. No `setState` in rAF loop — avoids React re-renders.

## Data layer

PostgreSQL with Drizzle ORM. Five tables:

| Table               | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `sessions`          | Session lifecycle (start/end time, metadata JSONB)                |
| `turns`             | Transcribed utterances (role, content, full-text via `tsvector`)  |
| `session_summaries` | AI-generated summaries (topics[], entities, keyFacts, unresolved) |
| `tool_calls`        | Tool invocation log (name, args JSONB, result JSONB)              |
| `evidence_records`  | Citation records (sourceType, sourceUrl, snippet)                 |

**Relationships:** sessions → turns (1:many), sessions → session_summaries (1:many), turns → tool_calls (1:many). `evidence_records` is standalone (no FK).

**Search:** Recall uses PostgreSQL `to_tsvector` full-text search on turn content and `ILIKE` on summary topics with `UNNEST`. No vector search — schema is designed so a vector column can be added later (ADR-003).

**Connection:** Singleton pattern via `connectDb()`/`getDb()`. Uses `postgres-js` driver.

Migrations live in `drizzle/` and are generated from schema via `npm run db:generate`. Applied via `npm run db:migrate`.

## API surface

| Endpoint                  | Method | Purpose                                             |
| ------------------------- | ------ | --------------------------------------------------- |
| `/api/session`            | POST   | Mint ephemeral key for WebRTC                       |
| `/api/session/sideband`   | POST   | Open sideband WS (body: `{ callId, ephemeralKey }`) |
| `/api/sessions`           | GET    | List recent sessions (limit 20)                     |
| `/api/sessions/:id/turns` | GET    | Get session detail with turns + summary             |
| `/health`                 | GET    | Health check (rate-limit exempt)                    |

Non-`/api` paths serve the React SPA via `@fastify/static` with an `index.html` catch-all.

Rate limit: 30 requests/minute globally.

## Tools

| Tool           | Trigger                  | Data source       | Evidence |
| -------------- | ------------------------ | ----------------- | -------- |
| `recall`       | Memory/history questions | PostgreSQL FTS    | No       |
| `get_weather`  | Weather questions        | Open-Meteo API    | Yes      |
| `github`       | GitHub URL provided      | Octokit REST API  | Yes      |
| `capabilities` | "What can you do?"       | Static definition | No       |
| `echo`         | Fallback (no DB)         | Passthrough       | No       |

**Availability:** `echo` is always present. `recall` and `capabilities` require `DATABASE_URL`. `github` additionally requires `GITHUB_TOKEN`. Tool defs are built once at session creation and included in the system prompt.

## Client state machine

Both web (`useSession()`) and iOS (`WebRTCManager`) implement the same 8-state voice state:

```
disconnected → connecting → ready → listening | processing | working | speaking → disconnected
                                                                                 → error
```

**Input modes:**

- **PTT (default):** Mic disabled until button press. Sequence: `input_audio_buffer.clear` → `cancel` → `output_audio_buffer.clear` on push; `commit` → `response.create` on release.
- **VAD:** Mic enabled continuously. `session.update` sends `semantic_vad` config. Barge-in pauses remote audio on `speech_started`.

**RTT monitoring (web only):** Polls `RTCPeerConnection.getStats()` every 2s for `candidate-pair.currentRoundTripTime`. Displayed in `LatencyBadge` with color thresholds (green < 150ms, yellow < 300ms, red).

**Auto-reconnect (web only):** Re-establishes session on page visibility change (e.g., wake from sleep).

## Environment

See [.env.example](../.env.example) for all variables. Validated at startup via Zod — server crashes immediately if `OPENAI_API_KEY` is missing. Tools degrade gracefully when optional vars are absent.

## Testing

63 unit tests across 9 files. See [TESTING.md](TESTING.md) for coverage details and the manual QA runbook.

For architecture decision records, see [decisions.md](decisions.md).

## Gotchas

- **The server never touches audio.** Audio goes browser → OpenAI → browser via WebRTC. If you're debugging audio issues, look at the client's `RTCPeerConnection`, not the server.
- **Ephemeral keys expire in ~60 seconds.** The sideband must connect within that window. In practice this happens in <1 second. `generateAndStoreSummary` uses the long-lived key because it runs after session close.
- **`useAnalyser` must not connect to `AudioContext.destination`.** Doing so breaks echo cancellation. It taps the stream read-only.
- **Tool availability is config-driven at session creation.** `buildToolDefs()` runs each time a session is created in `session.ts`. If you add a tool, it needs to be wired in both `buildToolDefs` and `buildToolHandler`.
- **The `activeSidebands` map is in-memory.** If the server restarts, active sidebands are lost. Acceptable for single-instance deployment but would need external state for horizontal scaling.
- **The GitHub tool only accepts URLs.** It cannot search for repos by name or list PRs. The system prompt tells the AI to use it "when the user provides a GitHub URL."
- **Tailwind v4 uses `@tailwindcss/vite` plugin.** There is no `tailwind.config.js`. Configuration is done via CSS `@theme` blocks in `index.css`.
- **GitHub digest is client-parsed.** Tool output JSON is parsed client-side from `conversation.item.created` events. Error payloads (missing `type` field) are rejected silently. Digest clears on non-GitHub tool calls to avoid stale display.
- **Two separate `node_modules`.** Root and `client/` each have their own. `postinstall` auto-installs client deps. Docker build handles this across stages.
- **iOS uses `stasel/WebRTC` via SPM.** This is a precompiled binary of Google's `libwebrtc`. The Xcode project resolves it; there's no CocoaPods or Carthage. No `Package.swift` at the repo root.
- **iOS `Config.swift` has two base URLs.** `#if DEBUG` points to `localhost:3000`; release points to the Railway production URL. The iOS app cannot reach the dev server unless the device/simulator is on the same network.
- **iOS `WebRTCManager` is `@MainActor`.** All state mutations happen on the main thread. Delegate callbacks from WebRTC (which fire on internal threads) dispatch to `@MainActor` via `Task`.
- **iOS audio session uses `.videoChat` mode.** This enables echo cancellation and automatic gain control. The category is `.playAndRecord` with `.defaultToSpeaker` and `.allowBluetoothA2DP`.
