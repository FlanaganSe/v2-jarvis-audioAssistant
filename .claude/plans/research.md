# Feature Research: 5 Proposed Enhancements

## Current State

### Architecture summary

The system has two communication paths in parallel:

1. **WebRTC data channel** (`oai-events`): browser ↔ OpenAI directly. The client reads all realtime events here — transcript deltas, function call signals, state transitions.
2. **WebSocket sideband** (`sideband.ts`): server ↔ OpenAI. The server listens here exclusively for tool execution. Tool results are sent back to OpenAI over this same channel. The client does not receive anything from the sideband directly.

The client has no server-push channel. `connectSideband` in `client/src/api/session.ts` is a fire-and-forget POST that simply asks the server to open its WebSocket. After that, client and server are decoupled.

---

## Feature 1: Tool Call Activity in Transcript

### Code path tracing

1. Client connects WebRTC; data channel `oai-events` opens (`useSession.ts:186-195`).
2. User speaks; OpenAI begins generating a response with a tool call.
3. **On the data channel** the client receives `response.function_call_arguments.done` — `useSession.ts:104-106` handles it by setting state to `'working'` only. No transcript entry is written.
4. **Simultaneously on the sideband** (`sideband.ts:119-139`), the server receives the same `response.function_call_arguments.done` event, dispatches the tool handler, then calls `events.onToolCall` after the result is ready.
5. `onToolCall` in `session.ts:194-204` persists to the `tool_calls` table. Nothing is sent back to the client.
6. The server sends `conversation.item.create` (function_call_output) + `response.create` back to OpenAI over the sideband WebSocket.

**Gap**: There is no server→client push path. The client sees `working` state but gets no label.

### What transcript entries look like

`TranscriptEntry` in `useSession.ts:6-10`:

```
{ role: 'user' | 'assistant', text: string, final: boolean }
```

The `role` discriminator is the only type field. There is no `'tool'` or `'system'` role yet.

### Is the data channel one-way?

The data channel is bidirectional — the client already _sends_ messages on it (session.update, input_audio_buffer.commit, response.cancel, etc.). OpenAI can send any realtime event on it. **The client does receive `response.function_call_arguments.done` already** (`useSession.ts:104`). The function call name is in that event but the client currently discards it.

Checking the realtime event shape in `sideband.ts:15-22`:

```
{ type, call_id?, name?, arguments?, transcript?, ... }
```

The `name` field (tool name) is present on `response.function_call_arguments.done`.

### What's actually hard

The client already receives the tool name via the data channel. The only thing missing is: (a) a `'tool'` role variant in `TranscriptEntry`, and (b) the client handling the `name` field from `response.function_call_arguments.done`.

The bigger complexity is **showing when the tool finishes and what it returned**. The client has no way to know when execution completes because that happens on the sideband. Options:

- Use the subsequent `response.output_audio_transcript.delta` as the implicit "done" signal (no new protocol needed).
- Add a server-push mechanism so the server can notify the client of completion.

The `response.done` event on the data channel fires after the entire response turn completes, but it carries no tool result payload. So the client can infer tool completion from `response.done` but cannot get the result text.

### Swift compatibility

A Swift client would receive the same `response.function_call_arguments.done` event on its data channel. It would need no new server protocol if the approach uses only data channel events. If we add a new server→client push endpoint, a Swift client must implement that too.

**Cleanest approach for Swift compatibility**: read `name` from `response.function_call_arguments.done` on the data channel and display "Calling [tool]..." — zero new server protocol.

---

## Feature 2: Post-Session Summary Display

### Code path tracing

1. Sideband WebSocket closes → `sideband.ts:169-173` fires closeCallbacks.
2. `session.ts:210-219`: `sideband.onClose` handler calls `endSession(db, dbSessionId)` then chains `.then(() => generateAndStoreSummary(...))`.
3. `generateAndStoreSummary` (`summary.ts:39-80`): fetches all turns from DB, calls `gpt-4o-mini` via HTTP, parses result, calls `insertSummary`.
4. The client has already disconnected by this point. The sideband close happens when OpenAI closes the WebSocket — which happens after the WebRTC peer connection closes on the client side.

**Timing problem**: Summary generation is async and triggered by sideband close. By the time it completes (one `gpt-4o-mini` round-trip, potentially several seconds), the client is fully disconnected. There is no way to push the result to the current session's client.

### How the sidebar currently uses summaries

`SessionSidebar.tsx:54-56`: Only `topics` is displayed as a comma-joined string. `keyFacts`, `entities`, and `unresolved` are fetched by `GET /api/sessions/:id/turns` but the `getSessionDetail` persistence function (`persistence.ts:115-143`) does **not join** `session_summaries` — it returns only `turns`. The summary fields never reach the client for the expanded detail view.

The `listSessions` query (`persistence.ts:82-98`) does left-join `session_summaries` and returns `topics`, but nothing else from the summary table.

### What's actually hard

1. **The current session**: Summary isn't ready when the session ends from the client's perspective. Displaying it requires either polling (`GET /api/sessions/:id/summary`?) or a server-sent event after reconnect. This is the main complexity.

2. **Past sessions in sidebar**: Easy — just extend `getSessionDetail` to join `session_summaries` and return `keyFacts`, `unresolved`, and `entities`. Then update `SessionSidebar` to render them in the expanded view.

3. **Showing summary for the _just-ended_ session**: The client would need to know its `dbSessionId`, which it currently does not (the sideband POST returns `{ ok: true }` with no session ID). The server knows `dbSessionId` but never sends it to the client.

4. **`getSessionDetail` missing summary data**: `persistence.ts:115-143` — no join to `session_summaries`. This is a concrete gap.

### Swift compatibility

A GET endpoint `/api/sessions/:id/summary` would be clean REST. Both web and Swift would poll after disconnect. The `dbSessionId` would need to be returned to the client at sideband connection time.

---

## Feature 3: Date/Time Awareness in System Prompt

### Where the system prompt is assembled

`session.ts:15-28` — `SYSTEM_PROMPT` is a module-level constant string. It is injected into the `POST /api/session` request body (`session.ts:122-123`: `instructions: systemPrompt`).

The prompt is sent once at session creation time to `https://api.openai.com/v1/realtime/client_secrets`. After that, the session is live and the instructions are fixed unless updated via `session.update` on the data channel.

There is also `BASE_SYSTEM_PROMPT` (line 30-33) used when `db` is absent.

### What's actually hard

Almost nothing. This is genuinely trivial. The only decision is format. `new Date().toLocaleString()` or an explicit ISO format with day-of-week. Since the model is reading prose, a human-readable format like `"Friday, March 28, 2026, 10:30 AM UTC"` is best.

The prompt assembly happens in the closure at `session.ts:105-109` (module-level vars) — `systemPrompt` is evaluated once at module load, not per-request. To make date/time accurate per request, the prompt must be built inside the route handler, not at module initialization.

**This is the one real risk**: `systemPrompt` is currently a module-level constant (`session.ts:108`). It must become a function call inside the route handler.

### Swift compatibility

No protocol change. System prompt is server-only. Zero impact.

---

## Feature 4: Evidence/Citation Display in Transcript

### Code path tracing

1. Tool handler executes (e.g., `handleWeather` in `weather.ts:139-168`).
2. Tool result includes an `evidence` field with `{ sourceType, sourceUrl, snippet }`.
3. `tryPersistEvidence` in `session.ts:58-74` extracts `result.evidence`, calls `createEvidence`, calls `persistEvidence(db, evidence)` — fire and forget.
4. `persistEvidence` (`evidence.ts:25-37`) inserts into `evidence_records` table.
5. The evidence record has **no foreign key to any turn, tool_call, session, or call_id**. It is orphaned in the database.

`evidence_records` schema (`schema.ts:41-48`):

```
id, sourceId (text, nullable), sourceType, sourceUrl, snippet, retrievedAt
```

No `session_id`, no `tool_call_id`, no `turn_id`. The `sourceId` field is a generic text field and is `null` in all current call sites (`createEvidence` in `evidence.ts:12-23` defaults it to null; the tool handlers don't pass it).

`insertToolCall` is called with `turnId: null` (`session.ts:198`) — so tool calls also have no turn association.

### What's actually hard

**There is no linkage chain**: evidence → tool call → turn → session. To display evidence alongside a transcript entry, you'd need to:

1. Add `sessionId` or `callId` to `evidence_records`.
2. Either return evidence in the tool result to the client via a new protocol, or query it server-side and associate it with the turn.

The client never receives the tool result content — it only knows a tool was called (`response.function_call_arguments.done`) and that the response completed (`response.done`). The actual data returned by the tool is only in the sideband WebSocket path; the client's data channel does not receive `conversation.item.create` for function outputs.

**Alternative**: embed evidence in the tool call result JSON and surface it differently. But the client still can't read tool results from the data channel.

**This is genuinely medium complexity**, not trivial. At minimum it requires:

- A new API endpoint (`GET /api/sessions/:id/evidence`) or inclusion in session detail response.
- Schema migration to link evidence to sessions.
- Client must know when to fetch/display evidence (after session ends? live during session?).

For live inline citations during a session, you would need a new push mechanism (SSE or a DC extension).

### Swift compatibility

A REST endpoint returning evidence per session is the cleanest approach. Inline real-time citations would require a SSE stream or data channel extension — both are implementable but increase protocol surface.

---

## Feature 5: Connection Quality / Latency Display

### Client access to RTCPeerConnection

`useSession.ts:32`: `pcRef = useRef<RTCPeerConnection | null>(null)`. The `pc` is created at `useSession.ts:152` and stored in `pcRef`. It is **not exposed** in the `UseSessionReturn` interface (`useSession.ts:12-23`). `App.tsx` never receives `pc`.

`RTCPeerConnection.getStats()` is a standard browser API that returns an `RTCStatsReport`. The relevant stat type is `candidate-pair` which has `currentRoundTripTime` (in seconds, from STUN consent checks). It is available during an active connection.

### What's actually hard

1. **Stats polling**: `getStats()` is async and must be polled (typically 1–2 second interval). This requires a `setInterval` inside `useSession`, a new piece of state, and cleanup.

2. **Exposing the value**: `pcRef` is internal to `useSession`. Either expose a new state value (e.g., `rttMs: number | null`) in `UseSessionReturn`, or create a new `useConnectionStats(pcRef)` hook.

3. **`currentRoundTripTime` availability**: STUN candidate-pair RTT is only available when the connection is in `connected` state and STUN consent refreshes are occurring. It may read `undefined` early in the connection or if there's no STUN. WebRTC to OpenAI's TURN/STUN infra should have reliable RTT, but it's not guaranteed.

4. **ICE connection state vs peer connection state**: Both exist on `RTCPeerConnection`. `onconnectionstatechange` is already handled (`useSession.ts:166-171`). ICE state changes are not tracked. These are separate signals.

This feature is self-contained in the client — no server changes needed. The RTT display would be purely a frontend addition.

### Swift compatibility

`AVFoundation`/`WebRTC` on iOS exposes the same `RTCPeerConnection` stats API. A native Swift app would implement this independently. No protocol change needed.

---

## Constraints (What Can't Change)

1. **WebRTC is browser→OpenAI direct** (`useSession.ts:231`): server never sees audio. Any feature requiring real-time server→client push of tool activity must use a separate channel.
2. **Sideband is server→OpenAI only**: it does not push to the browser. There is no existing server→client push mechanism (no SSE, no WebSocket to the browser).
3. **The data channel is client↔OpenAI**: server cannot inject messages into it. Only the browser and OpenAI put messages on `oai-events`.
4. **`callId`** is the session identifier used by both the sideband and the data channel, but `dbSessionId` (Postgres UUID) is server-internal. The client currently does not know its `dbSessionId`.
5. **Evidence records have no session/turn linkage** (confirmed at schema level).
6. **Tool calls are persisted with `turnId: null`** (`session.ts:198`).
7. **`getSessionDetail` does not include summary data** (only `turns`).

---

## Options Per Feature

### Feature 1: Tool calls in transcript

**Option A — Data channel only (recommended)**

- On `response.function_call_arguments.done`, read `event.name` from the data channel (already available at `useSession.ts:104`).
- Add a `'tool'` role to `TranscriptEntry` (or use a discriminated union with a `kind` field).
- Append a non-final entry like `"Searching memory..."`. Mark it final on `response.done`.
- No server changes.

**Option B — Server push via SSE**

- Add a GET `/api/session/:callId/events` SSE endpoint on the server.
- Server pushes tool start/complete events.
- Client connects SSE alongside WebRTC.
- More protocol surface; harder for Swift.

**Option C — Return tool name in sideband POST response and poll**

- Polling is too slow for UX; reject.

**Trade-offs**: Option A is zero-server-change, clean for Swift. The downside: client can only see tool _name_ (from `response.function_call_arguments.done`), not the _result_. For feature 4 (evidence) you'd eventually need option B anyway.

---

### Feature 2: Post-session summary display

**Option A — Extend existing REST (recommended for past sessions)**

1. `getSessionDetail` joins `session_summaries`.
2. Client renders `keyFacts`, `unresolved` in expanded sidebar.

- Changes: one persistence function, one component.

**Option B — Return `dbSessionId` at sideband connect, poll for summary**

- `POST /api/session/sideband` returns `{ ok: true, sessionId: dbSessionId }`.
- Client stores `sessionId`; after disconnect, polls a new `GET /api/sessions/:id/summary` endpoint.
- Changes: sideband route, new endpoint, client polling logic.
- Enables real-time post-session summary display.

**Option C — SSE push of summary**

- Over-engineering for a summary that takes 2–5 seconds and only matters at session end. Reject.

**Trade-offs**: Option A is immediate value for zero new endpoints. Option B enables showing the _current_ session's summary after it ends — higher demo value but more client logic.

---

### Feature 3: Date/time in system prompt

**Option A — Build prompt per-request (recommended)**

- Move `systemPrompt` construction inside the `POST /api/session` route handler.
- Inject `new Date()` formatted as `"Day, Month DD, YYYY, HH:MM UTC"`.
- Single, trivial change.

**Option B — `session.update` after DC opens**

- Client sends a `session.update` with updated instructions after the data channel opens.
- Requires client to know the current datetime (it does — it's a browser), but it changes the instructions-ownership model and may conflict with the server-set prompt.

**Trade-offs**: Option A keeps the prompt server-authoritative. Option B works but splits prompt ownership.

---

### Feature 4: Evidence/citation display

**Option A — Post-session REST (recommended, lower risk)**

1. Add `sessionId` column to `evidence_records`.
2. Populate it in `tryPersistEvidence` (needs `sessionId` threaded through).
3. Add `GET /api/sessions/:id/evidence` endpoint.
4. Show evidence in SessionSidebar expanded view after session ends.

**Option B — Live inline via SSE (high value, higher complexity)**

- Server pushes `{ type: 'tool.evidence', sourceType, snippet, sourceUrl }` when tool result is ready.
- Client appends a citation entry to transcript in real time.
- Requires new SSE or persistent HTTP/WS channel.

**Trade-offs**: Option A is safe and useful for history. Option B is the "wow" feature but requires new server push infrastructure. Both require schema migration.

---

### Feature 5: Connection quality display

**Option A — `useConnectionStats` hook polling `pcRef` (recommended)**

- New hook: `useConnectionStats(pcRef): { rttMs: number | null }`.
- `setInterval` polling `pc.getStats()`, extracting `candidate-pair.currentRoundTripTime`.
- Expose `rttMs` from `useSession`, render in a new `ConnectionBadge` component.

**Option B — Use `iceConnectionState` only (simpler, less informative)**

- No polling needed; just listen to `pc.oniceconnectionstatechange`.
- Shows state (checking/connected/failed) but not latency number.

**Trade-offs**: Option A gives quantitative RTT. Option B gives qualitative state. Both are client-only changes.

---

## Recommendation

### Priority order by effort/value

| Feature                               | Effort                                   | Demo value                               | Recommended approach                         |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| 3 — Date/time                         | Trivial (1 line)                         | High (avoids "what day is it?" failures) | Option A — prompt per-request                |
| 1 — Tool calls in transcript          | Low (client only)                        | High (shows Jarvis is "thinking")        | Option A — data channel, add tool entry type |
| 2 — Session summary (past)            | Low (extend REST)                        | Medium                                   | Option A — extend `getSessionDetail`         |
| 5 — Latency display                   | Low–medium (client only)                 | Low–medium                               | Option A — `useConnectionStats` hook         |
| 4 — Evidence (post-session)           | Medium (schema migration + new endpoint) | Medium                                   | Option A — post-session REST                 |
| 2 — Session summary (current session) | Medium (return sessionId + polling)      | High if demo-focused                     | Option B — if time allows                    |
| 4 — Evidence (live inline)            | High (needs SSE infra)                   | High                                     | Defer until SSE infrastructure exists        |

---

## Risk Inventory

### Feature 1

- **Known**: `response.function_call_arguments.done` comes from the data channel before the server's sideband has even dispatched the tool. So the client can only show "starting tool X," never "tool X returned Y."
- **Known**: `TranscriptEntry` type is defined in `useSession.ts` not `types.ts`. Adding a `'tool'` role requires updating the type in two places (the interface and the `Transcript.tsx` render).
- **Unknown-unknown**: Does OpenAI send `response.function_call_arguments.done` for all tool types, or only for streaming argument builds? If multi-turn tool calls happen (tool → another tool), the existing state machine (`setState('working')` → `setState('ready')` on `response.done`) may produce multiple flickers.

### Feature 2

- **Known**: `generateAndStoreSummary` is called in a `.then()` chain after `endSession` with no timeout or retry. If `gpt-4o-mini` is slow or fails, `insertSummary` never runs and no summary exists. The client would poll and get nothing.
- **Known**: `listSessions` left-joins `session_summaries` so sessions with no summary show `topics: null`. This is already handled (`s.topics && s.topics.length > 0` in `SessionSidebar.tsx:54`).
- **Unknown-unknown**: The summary prompt (`summary.ts:6-16`) uses `gpt-4o-mini` with `temperature: 0`. If the transcript is very short (one turn), the model may still produce valid JSON but with sparse arrays. This is fine.

### Feature 3

- **Real risk**: The `systemPrompt` constant is at module scope (`session.ts:15`). `buildToolDefs`, `systemPrompt`, `tools` are all computed once at `sessionRoutes` call time (`session.ts:105-109`). Date/time injected at module load would be the server startup time, not the session request time. The fix requires moving prompt construction inside the route handler function.
- **Low risk otherwise**: The model handles natural language timestamps well.

### Feature 4

- **Real risk**: `evidence_records` has no FK to `sessions`. This is a schema migration. Migrations must be coordinated with Railway deployment (the project uses Railway-hosted Postgres per `.claude/rules/stack.md`). Need to confirm migration strategy.
- **Real risk**: `tryPersistEvidence` (`session.ts:58-74`) does not pass `sessionId`. Threading `dbSessionId` through requires changing the closure in the sideband route handler and the `tryPersistEvidence` function signature.
- **Real risk**: `insertToolCall` is called with `turnId: null` — tool calls are not linked to turns either. Retrieving "which evidence belongs to which response turn" requires either fixing this or accepting that evidence is session-granular, not turn-granular.
- **Unknown-unknown**: `recall` tool currently returns no `evidence` field (confirmed in `recall.ts:55-87` — result has `found`, `turns`, `summaries` but no `evidence`). Capabilities returns `evidence: null`. So evidence only exists for weather and GitHub today. The feature would be sparse.

### Feature 5

- **Real risk**: `currentRoundTripTime` on a STUN/TURN candidate pair is available only if STUN consent check responses are flowing. If OpenAI uses TURN relay (likely behind NAT), the stat may report relay RTT, not user→OpenAI RTT. Still useful but should be labeled "connection RTT" not "latency to AI."
- **Real risk**: `pcRef.current` is null before `connect()` and after `cleanup()`. The stats hook must guard against this.
- **Low risk**: `RTCPeerConnection.getStats()` is well-supported. The `candidate-pair` stat type is broadly available.

---

## Sources of Truth

| Area                       | Canonical source                                                        | Verification method                                        | Drift risk                                    |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| WebRTC data channel events | `useSession.ts:80-140`                                                  | Read the switch statement; any new event type needs a case | Low — stable                                  |
| Sideband event handling    | `sideband.ts:115-155`                                                   | Full file — only 3 event types handled today               | Low — stable                                  |
| Transcript entry type      | `useSession.ts:6-10`                                                    | Interface definition                                       | Low — no DB backing                           |
| DB schema                  | `schema.ts:1-48`                                                        | Drizzle schema file is authoritative                       | Medium — migrations happen                    |
| Persistence queries        | `persistence.ts`                                                        | Full file                                                  | Medium — query shapes change with schema      |
| Session route              | `session.ts:105-235`                                                    | Full file                                                  | Medium — feature work targets this            |
| Summary trigger            | `session.ts:210-219`                                                    | The `sideband.onClose` handler                             | Low — stable                                  |
| System prompt              | `session.ts:15-28`                                                      | Module-level constant                                      | Low — but see Feature 3 risk                  |
| Client type definitions    | `client/src/types.ts`                                                   | Full file (31 lines)                                       | Low — stable                                  |
| OpenAI realtime API events | `https://platform.openai.com/docs/api-reference/realtime-server-events` | Check docs for any new event types when building           | High — OpenAI is actively developing this API |

---

## Swift App Compatibility Checklist

All 5 features can be designed to avoid new protocol surface:

- **Feature 1**: Read `name` from data channel `response.function_call_arguments.done` — same event a Swift WebRTC client receives. No new server API.
- **Feature 2**: REST polling `GET /api/sessions/:id/summary` — standard REST, trivially implemented in Swift.
- **Feature 3**: Server-only change. No protocol impact.
- **Feature 4**: REST `GET /api/sessions/:id/evidence` — standard REST.
- **Feature 5**: Client-only `getStats()` — Swift `WebRTC` framework exposes equivalent `RTCPeerConnection.statistics()` API.

The one thing that would create Swift debt: adding SSE for live tool events or live evidence push. If that's deferred until proper SSE infrastructure is designed (with versioned endpoints), it stays clean.

---

## Feature 6: GitHub Digest Mode

### 1. Current State

#### Full tool call trace

1. User speaks a GitHub URL. OpenAI recognizes it and emits `response.function_call_arguments.done` on both the WebRTC data channel and the sideband WebSocket.
2. Data channel side: `useSession.ts:104-106` receives the event and sets state to `'working'`. The `name` and `arguments` fields are discarded.
3. Sideband side: `sideband.ts:119-139` receives the same event, parses args, calls `toolHandler('github', { url })`.
4. `buildToolHandler` (`session.ts:93-96`) routes to `handleGitHub(octokit, args)`.
5. `handleGitHub` (`tool.ts:22-53`) calls `parseGitHubUrl` → `fetchGitHubEntity` → one of four fetchers.
6. The fetcher returns `{ data: Record<string, unknown>, evidence: Evidence }`.
7. `handleGitHub` spreads `result.data` and adds an `evidence` sub-object → returns the combined flat record.
8. `tryPersistEvidence` (`session.ts:58-74`) extracts `evidence` and fire-and-forgets to `evidence_records`.
9. `onToolCall` (`session.ts:194-204`) persists the raw args and full result JSON to `tool_calls` with `turnId: null`.
10. `sendToolResult` (`sideband.ts:29-41`) sends `conversation.item.create` (function_call_output) + `response.create` back to OpenAI over the sideband WebSocket.
11. OpenAI synthesizes a spoken response from the structured JSON. The client receives this as `response.output_audio_transcript.delta` events on the data channel → spoken aloud + shown in transcript as plain text.

**The client never receives the GitHub data directly.** It only sees the assistant's verbal summary of it.

#### What data the tool currently returns

**Repo** (`fetchers.ts:16-55`):

```
{ name, description, language, stars, forks, openIssues, defaultBranch, topics[], readme (up to 4000 chars), evidence }
```

**Issue** (`fetchers.ts:104-139`):

```
{ title, state, author, body (up to 4000 chars), labels[], commentCount, comments[{ author, body (up to 1000 chars), createdAt }], evidence }
```

**Pull Request** (`fetchers.ts:141-194`):

```
{ title, state, merged, author, body (up to 4000 chars), baseBranch, headBranch, additions, deletions, changedFiles, commentCount, comments[], reviewCommentCount, reviewComments[{ author, body (up to 500 chars), path, createdAt }], evidence }
```

**File** (`fetchers.ts:57-102`):

```
{ path, size, content (up to 4000 chars), evidence }
```

The data is already richly structured as individual named fields — it is not a text blob. This is a critical finding: **the digest data already exists on the server.** No new GitHub API calls are needed.

What is missing for a "digest" presentation:

- For repo: no issue list, no recent PR list, no contributor data (would require additional API calls).
- For issues: all needed fields are already fetched (status, labels, comments).
- For PRs: all needed fields are already fetched (additions/deletions, changed files, review comments).
- "Notable comments" — the tool already fetches up to 50 comments per issue/PR; the LLM currently decides which to highlight verbally.

#### Current Transcript component

`Transcript.tsx:8-36`: completely flat. `TranscriptEntry` has only `{ role: 'user' | 'assistant', text: string, final: boolean }`. Every entry renders as a line of text. There is no slot for structured card data, no component for rendering JSON, no card/panel patterns anywhere in the client.

The overall App layout (`App.tsx:48-87`) is a centered column with max-w-xl. There is no side panel, no popout, no grid. The transcript lives in a fixed `h-64 w-full max-w-xl` div.

---

### 2. Where "Digest Mode" Would Live

Three architectural positions are possible:

**Position A — Server-side only (formatting change to tool output)**
The server changes what JSON it sends back to OpenAI. The client sees only the verbal summary OpenAI generates. No UI change. This is already partially done — the data is structured JSON. The model's verbal output is the "digest."

**Position B — Parallel structured payload to the client**
When a GitHub tool call completes on the sideband, the server also pushes structured data to the client via a new mechanism (SSE or a separate HTTP endpoint the client polls after `response.done`). The client renders a visual card in addition to the spoken response.

**Position C — Client reads tool result from data channel**
The client currently receives `response.function_call_arguments.done` (tool invocation) but not the function call _output_. OpenAI does send `conversation.item.created` for function_call_output items — but the client does not currently listen for this event. If OpenAI sends the tool result back on the data channel, the client could intercept it.

Verification needed on Option C: the OpenAI Realtime API spec defines `conversation.item.created` which fires when any new conversation item is added, including function_call_output. If the function_call_output item appears on the data channel, this is zero-server-change — the client just needs to listen for `conversation.item.created` where `item.type === 'function_call_output'`.

---

### 3. Impact Analysis Across Layers

**API (tool function signature)**: No change needed. The `github` tool already takes `{ url: string }`. A "digest mode" parameter could be added (`{ url: string, mode?: 'digest' | 'raw' }`) but is not necessary — the data returned is already digest-suitable.

**Server — sideband handler**: Only needs change if Option B (push to client) is chosen. For Options A and C, sideband is untouched.

**Server — tool output format**: If "digest" means a re-structured subset of the existing data (e.g., dropping the raw README and instead surfacing a `summary` object), that is a pure `fetchers.ts` / `tool.ts` change. No schema changes. No new API calls.

**DB**: No schema changes needed for any option. The `tool_calls` table already persists the full result as JSONB (`schema.ts:38`). The `evidence_records` table is already populated. No new tables, no migrations.

**Deployment**: No risk for any option. No infrastructure changes.

**Frontend**: This is the main variable. The `Transcript` component currently has no rendering path for structured data. `App.tsx` has no layout slots for a side panel or popout. Any visual digest card requires new components and a layout change.

---

### 4. The "Structured Summary" Question

The feature description asks for: repo overview, issue status, PR risk summary, notable comments.

**What the tool already fetches:**

- Repo overview: `name`, `description`, `language`, `stars`, `forks`, `openIssues`, `topics` — yes, all present (`fetchers.ts:38-46`).
- Issue status: `title`, `state`, `labels`, `commentCount` — yes, all present (`fetchers.ts:120-128`).
- PR risk summary: `additions`, `deletions`, `changedFiles`, `state`, `merged`, `reviewCommentCount` — yes, all present (`fetchers.ts:162-176`). "Risk" is a judgment derived from these numbers, not raw data — the LLM makes that judgment today.
- Notable comments: fetched (up to 50), all bodies available — yes, present for both issues and PRs.

**What is not fetched and would need new API calls:**

- For a repo "digest": open issue list (titles, labels) — requires `octokit.rest.issues.list`.
- For a repo "digest": recent PR list — requires `octokit.rest.pulls.list`.
- Contributor list — `octokit.rest.repos.listContributors`.
- Recent commits — `octokit.rest.repos.listCommits`.

**Conclusion**: The current fetchers cover the single-resource case (one issue, one PR) completely. A "repo digest" that surfaces aggregate status (open issues list + PR list) would need 2–3 additional GitHub API calls. Whether those are worth adding depends on the demo use case.

---

### 5. UI Presentation Options

Given the current state of `App.tsx` and `Transcript.tsx`, there are three realistic approaches:

**Option A — Inline card in transcript (no layout change)**
Add a new discriminated entry type to `TranscriptEntry`: e.g., `{ role: 'tool', kind: 'github_digest', data: GitHubDigestPayload, final: boolean }`. `Transcript.tsx` renders this variant as a small structured card inline in the scroll area. The scroll container is already `overflow-y-auto`. This requires: (1) type change in `useSession.ts`, (2) new render branch in `Transcript.tsx`, (3) a new `GitHubDigestCard` component.

Layout risk: the transcript is in a `max-h-64` container. A rich card inside it will fill the scroll area quickly and push verbal entries out of view. Manageable with compact card design.

**Option B — Below-transcript panel (new layout slot in App.tsx)**
Add a `githubDigest: GitHubDigestPayload | null` to `useSession` state. `App.tsx` renders a separate `<GitHubDigestPanel>` below the transcript when data is available. This separates the card from the voice flow entirely. The user sees a visual card appear below the conversation when GitHub is queried.

Layout risk: App.tsx is a centered column. Adding a full-width panel below is straightforward. No side-panel infrastructure needed.

**Option C — Side panel / popout (new layout pattern)**
Requires adding a two-column layout (or modal/popout logic) to `App.tsx`. This is the most flexible for display but the most disruptive to the current layout. It is a proper UI architecture decision, not just a new component.

The user's concern — "we don't want to harm how this can be shown in the UI. It may want to be below or above or to the side or in a popout" — maps directly to this choice.

**The clean answer for Swift compatibility**: If the structured digest payload is sent to the client as a typed JSON event, the _React_ app can render it however it wants, and a _Swift_ app can render it in a native card/sheet. The contract is the payload schema, not the rendering. This argues for defining the payload schema first and treating React rendering as pluggable.

---

### 6. How the Structured Payload Would Reach the Client

This is the key architectural question. Three paths:

**Path 1 — `conversation.item.created` on the data channel (zero server change)**
OpenAI fires `conversation.item.created` when it processes the function_call_output item. The event has an `item` field containing `{ type: 'function_call_output', call_id, output (JSON string) }`. The client currently has no handler for this event type (`useSession.ts:80-140` has no case for it). If OpenAI does send this event on the data channel, the client could parse `item.output` and extract GitHub data — no server changes at all.

Risk: needs verification against the OpenAI Realtime API event spec. If `conversation.item.created` with function_call_output is sent to the browser data channel, this is the cleanest path by far. If it's only sent on the sideband, this path is unavailable.

**Path 2 — Server push via SSE**
The server opens a GET SSE endpoint (e.g., `GET /api/session/:callId/events`). After a tool call completes on the sideband, the server pushes `{ type: 'github.digest', payload: GitHubDigestPayload }`. The client connects SSE alongside WebRTC and listens for this event type.

This requires: new Fastify SSE route, an event bus (or Map of callId → SSE response object), pushing from within the sideband tool callback. This is the same infrastructure that Feature 4 (live evidence) would need.

**Path 3 — Client polls after `response.done`**
After `response.done` fires on the data channel, the client calls `GET /api/session/:callId/latest-tool-result`. The server returns the last tool result for that call ID. This avoids SSE but introduces latency (round-trip after `response.done`) and state management complexity on the server (caching the last result per callId).

---

### 7. Swift Compatibility

If the structured payload schema is defined as a typed interface (e.g., `GitHubDigestPayload` with discriminated `type: 'repo' | 'issue' | 'pull' | 'file'`), then:

- A React app renders it as cards.
- A Swift app renders it as a native `List` / `Sheet` / side panel — whatever is appropriate for iOS.
- Neither app is coupled to the other's rendering.

The worst outcome is if the "digest" is baked into the LLM's spoken response (i.e., the model is prompted to say "here's your digest: stars: 1200, forks: 300..."). This is already somewhat true today. If digest = spoken summary, then Swift automatically inherits it because it hears the same audio. But the user cannot scroll, copy, or interact with it.

**Recommendation for Swift compatibility**: the payload schema should be a first-class typed export, not embedded in transcript text. Swift reads JSON — it does not parse natural language.

---

### 8. Risk Assessment

**Honest risk inventory:**

1. **`conversation.item.created` on data channel — unverified**: If OpenAI does not send function_call_output items to the browser on the data channel, Path 1 is dead. This should be verified with a one-line log in `useSession.ts` before any build work.

2. **No server→client push infrastructure exists**: The sideband result never reaches the client today. Building Option B (SSE) or Option C (polling) requires new infrastructure. This is not trivial — SSE on Fastify requires careful handling of keep-alive, connection cleanup, and mapping callId to response objects.

3. **UI layout is undecided**: The user explicitly flagged this. Building a "below-transcript panel" approach now and then wanting a popout later means rewriting the layout logic. The cleanest decoupling is: define the payload type, write a placeholder component, and make the layout decision separately.

4. **"Repo digest" needs new API calls**: If the demo use case is showing a repo overview (not just one issue/PR), 2–3 additional Octokit calls are needed. Rate limit implications: the GitHub API allows 5000 requests/hour with a token. For a demo, this is negligible.

5. **README truncation**: The repo fetcher truncates README at 4000 characters (`fetchers.ts:28-29`). For a visual digest card, the full README is rarely needed — a summary or the first 200 characters would be more useful. The current truncation serves the LLM; for a card it's too much.

6. **Demo impression vs. actual value**: Currently, the assistant verbally describes GitHub data — this already works. A visual card adds: (a) persistence (stays on screen), (b) scannability (user can read while listening), (c) linkability (click through to GitHub). For a demo, (a) and (b) are the compelling points. The voice + card pattern is visually impressive in ways that voice-only is not.

---

### 9. Value Assessment

**What exists today**: User gives a GitHub URL → Jarvis fetches it → Jarvis speaks a summary. The summary is accurate, grounded in real data, and conversational. It works.

**What digest mode adds**: A visual card that appears while or after Jarvis speaks. The card shows: repo name, description, stars/forks, language, open issue count (repo case); or title, state, labels, comment count (issue case); or title, diff stats, review count, risk indicators (PR case).

**Demo value**: High, specifically because it pairs audio + visual. The moment a structured card pops up while Jarvis is still speaking is immediately recognizable as something more than a chatbot. It demonstrates that the system produces structured, machine-readable data — not just speech. This directly supports the "voice + knowledge" demo story.

**Comparison to features 1–5**: Feature 6 is higher demo value than Features 2, 4, and 5 but similar to Feature 1 (tool activity in transcript). The key difference: Feature 1 shows _that_ a tool was called; Feature 6 shows _what_ came back. Feature 6 without Feature 1 still looks good. Feature 1 without Feature 6 is more useful for diagnostics than demo impact.

---

### Options

**Option A — Prompt engineering only (no new code)**

Change the `SYSTEM_PROMPT` to instruct the LLM to verbally summarize in a specific structured order: "overview first, then issue count, then PR risk." No code changes. No client changes. The spoken output is the "digest."

Trade-offs: zero engineering effort, but zero visual benefit. User concern about UI presentation is moot — there is no UI. Swift compatibility is perfect — it hears the same audio. Demo value is low; this is just better prompting, not a feature.

**Option B — Inline transcript card (server push via SSE, or polling)**

Define a `GitHubDigestPayload` type. Add a `kind: 'github_digest'` variant to `TranscriptEntry`. Server pushes or client polls structured data after tool completion. Client renders a `GitHubDigestCard` component inline in the transcript.

Trade-offs:

- Moderate complexity — needs either SSE infrastructure or a polling endpoint.
- Layout impact is contained (card inside existing scroll container).
- UI positioning is baked into the transcript — not easy to move to side/above/popout later without refactoring.
- Swift: if the payload is a well-typed schema, Swift can render it independently.
- If Path 1 (`conversation.item.created` on data channel) works, complexity drops significantly.

**Option C — Separate digest panel, decoupled from transcript**

Define `GitHubDigestPayload`. Add `githubDigest: GitHubDigestPayload | null` to `useSession` state. Render a `<GitHubDigestPanel>` in `App.tsx` below/beside the transcript, independent of the transcript scroll area. Server push or polling delivers the payload.

Trade-offs:

- Layout is flexible — the panel can later become a popout or side drawer without touching transcript code.
- More `App.tsx` layout work upfront.
- Transcript stays clean — no structural change to `TranscriptEntry`.
- Highest Swift compatibility: the payload schema is the only protocol contract; the panel is purely a React concern.
- Same server-side complexity as Option B.

---

### Recommendation

**Option C, staged in two steps.**

Step 1 (low risk, immediate): verify whether `conversation.item.created` with `function_call_output` appears on the browser data channel by adding a single `console.log` for unhandled event types in `useSession.ts`. If it does, the structured payload reaches the client with zero server changes.

Step 2 (conditional on step 1): if Path 1 works, add `GitHubDigestPayload` type, parse it from `conversation.item.created` in `useSession.ts`, expose `githubDigest` from `useSession`, and render a `<GitHubDigestPanel>` in `App.tsx` below the transcript. If Path 1 fails, build a lightweight SSE mechanism for sideband→client event push (which Feature 4 live evidence would also use).

The panel-below-transcript layout satisfies the user's concern: it is visually separate from the transcript, it can be repositioned or promoted to a popout in a future sprint without changing the transcript or useSession logic, and the payload schema is the same for a future Swift app.

**Why not Option B**: Mixing card types into `TranscriptEntry` creates a heterogeneous list that is harder to reposition and harder for Swift to ignore. The transcript is a voice artifact; the digest is a data artifact. They belong in separate state.

**Why not Option A**: Zero UI value. The user's concern was specifically about UI presentation — Option A has none.

---

### Sources of Truth

| Area                                    | Canonical source                                                                                  | Verification method                                        | Drift risk                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| GitHub fetcher data shapes              | `src/server/tools/github/fetchers.ts:16-194`                                                      | Full file — each fetcher's return `data` object            | Low — stable                            |
| Tool handler wiring                     | `src/server/routes/session.ts:76-103`                                                             | `buildToolHandler` function                                | Low — stable                            |
| Sideband tool result flow               | `src/server/realtime/sideband.ts:119-139`                                                         | `response.function_call_arguments.done` handler            | Low — stable                            |
| `TranscriptEntry` type                  | `client/src/hooks/useSession.ts:6-10`                                                             | Interface definition                                       | Low — no DB backing                     |
| Data channel event handler              | `client/src/hooks/useSession.ts:80-140`                                                           | `handleServerEvent` switch                                 | Medium — new events need cases          |
| OpenAI `conversation.item.created` spec | `https://platform.openai.com/docs/api-reference/realtime-server-events/conversation/item/created` | Check whether function_call_output appears on data channel | High — OpenAI API in active development |
| App layout                              | `client/src/App.tsx:48-87`                                                                        | Full file (87 lines)                                       | Medium — features 1–6 all touch layout  |
| Evidence persistence                    | `src/server/routes/session.ts:58-74`                                                              | `tryPersistEvidence` function                              | Low — stable                            |
