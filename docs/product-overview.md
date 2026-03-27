# Product Overview

## What this is

Jarvis is a real-time voice assistant. You talk to it, it talks back. It can check the weather, look up GitHub repos/issues/PRs, recall past conversations, and describe its own capabilities. Audio streams directly between the browser and OpenAI via WebRTC. The server participates only to mint sessions and execute tools via a sideband WebSocket to the same OpenAI session.

## Stack

- **Server:** Fastify 5, TypeScript, Node 22
- **Client:** React 19, Vite, Tailwind CSS v4 (standalone package in `client/`)
- **Database:** PostgreSQL via Drizzle ORM
- **Realtime:** WebRTC (browser-to-OpenAI direct) + WebSocket sideband (server-to-OpenAI)
- **AI models:** `gpt-realtime-1.5` for voice, `gpt-4o-mini-transcribe` for input transcription, `gpt-4o-mini` for post-session summaries
- **GitHub:** Octokit with throttle plugin
- **Weather:** Open-Meteo (free, no API key)
- **Package manager:** npm (no workspaces; `client/` has its own `package.json`)
- **Test:** Vitest
- **Deploy:** Railway via 3-stage Dockerfile

## Architecture

A request flows through two parallel paths:

```
Browser ──WebRTC──> OpenAI Realtime API ──WebRTC──> Browser
                         │
                    sideband WS
                         │
                      Server (tool execution, persistence)
```

1. **Session creation:** Client POSTs `/api/session`. Server calls OpenAI to mint an ephemeral key. Client uses it for the WebRTC SDP exchange with OpenAI directly.
2. **Sideband:** After WebRTC connects, client POSTs `/api/session/sideband` with the `callId` and `ephemeralKey`. Server opens a WebSocket to `wss://api.openai.com/v1/realtime?call_id=...` authenticated with the ephemeral key.
3. **Tool execution:** When OpenAI decides to call a tool, it sends `response.function_call_arguments.done` over both the data channel (client shows "working" state) and the sideband WS (server dispatches the handler). Server sends the result back over the sideband. OpenAI generates speech from the result.
4. **Persistence:** Turns, tool calls, and evidence are written to PostgreSQL as they happen. When the sideband closes, the server generates a summary via `gpt-4o-mini`.

The server never touches audio. It only handles session minting, tool dispatch, and persistence.

## Directory structure

```
src/
  config.ts                    # Zod env schema
  db/
    schema.ts                  # Drizzle table definitions
    index.ts                   # DB singleton
    persistence.ts             # Query builders
  server/
    server.ts                  # Entry point, startup logging
    app.ts                     # Fastify factory (cors, rate-limit, static, routes)
    routes/
      session.ts               # POST /api/session, POST /api/session/sideband
      history.ts               # GET /api/sessions, GET /api/sessions/:id/turns
    realtime/
      sideband.ts              # WebSocket to OpenAI, tool dispatch
      summary.ts               # Post-session summary generation
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
    api/session.ts             # Fetch wrappers for server endpoints
    hooks/
      useSession.ts            # WebRTC lifecycle, state machine, tool state
      useAnalyser.ts           # Web Audio RMS amplitude → CSS variable
    components/
      Orb.tsx                  # Audio-reactive animated sphere
      PttButton.tsx            # Push-to-talk (spacebar + mouse)
      VadToggle.tsx            # PTT ↔ semantic VAD toggle
      Transcript.tsx           # Chat-like scroll log
      SessionSidebar.tsx       # Past session history
      StatusBadge.tsx          # State label
    types.ts                   # VoiceState, Turn, SessionSummary, etc.
drizzle/                       # Generated SQL migrations
docs/                          # ADRs, requirements, this file
```

## Core concepts

**Session:** A voice conversation. Has a start/end time, metadata (including `callId`), turns, tool calls, and a post-session summary. Stored in `sessions` table.

**Turn:** A single user or assistant utterance within a session. Transcribed from audio. Stored in `turns` table with full-text search index.

**Tool call:** A function invocation triggered by OpenAI during conversation. Stores the tool name, arguments, and result as JSONB. Not always linked to a specific turn.

**Evidence:** A citation record for tool results. Captures source type (weather, github_repo, etc.), URL, and snippet. Used to ground AI responses in verifiable facts.

**Summary:** Post-session structured extraction via `gpt-4o-mini`. Contains topics, entities, key facts, and unresolved questions. Powers the recall tool's cross-session search.

**Sideband:** The WebSocket connection from server to OpenAI that runs parallel to the browser's WebRTC stream. This is how the server executes tools — it receives tool call events, runs handlers, and sends results back.

## Key patterns and conventions

- **Named exports only.** No default exports.
- **Co-located tests.** `foo.ts` → `foo.test.ts` in the same directory.
- **Immutable patterns, functional style.** Pure functions, `readonly` interfaces, no mutation.
- **Fastify structured logging.** `app.log.info/warn/error` with object-first args. Never `console.log` in server code.
- **Graceful degradation.** Missing `DATABASE_URL` → echo-only mode. Missing `GITHUB_TOKEN` → GitHub tool disabled. Logged at startup.
- **Evidence-grounded responses.** Tools return `evidence` alongside data. The system prompt instructs the AI to cite sources and refuse to fabricate.
- **Tool pluggability.** Each tool exports a `TOOL_DEF` (OpenAI function schema) and a `handle*` function. `buildToolDefs()` and `buildToolHandler()` in `session.ts` wire them together conditionally.

## Data layer

PostgreSQL with Drizzle ORM. Five tables:

| Table               | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `sessions`          | Session lifecycle (start/end time, metadata JSONB)                |
| `turns`             | Transcribed utterances (role, content, full-text index)           |
| `session_summaries` | AI-generated summaries (topics[], entities, keyFacts, unresolved) |
| `tool_calls`        | Tool invocation log (name, args JSONB, result JSONB)              |
| `evidence_records`  | Citation records (sourceType, sourceUrl, snippet)                 |

Recall uses PostgreSQL `to_tsvector` full-text search on turn content and `ILIKE` on summary topics. No vector search — schema is designed so a vector column can be added later.

Migrations live in `drizzle/` and are generated from schema via `npm run db:generate`. Applied via `npm run db:migrate`.

## API surface

| Endpoint                  | Method | Purpose                                             |
| ------------------------- | ------ | --------------------------------------------------- |
| `/api/session`            | POST   | Mint ephemeral key for WebRTC                       |
| `/api/session/sideband`   | POST   | Open sideband WS (body: `{ callId, ephemeralKey }`) |
| `/api/sessions`           | GET    | List recent sessions (limit 20)                     |
| `/api/sessions/:id/turns` | GET    | Get session detail with turns                       |
| `/health`                 | GET    | Health check (rate-limit exempt)                    |

Non-`/api` paths serve the React SPA via `@fastify/static` with an `index.html` catch-all.

Rate limit: 30 requests/minute globally.

## Environment and config

```
OPENAI_API_KEY    # Required. Standard API key for session minting + summaries.
DATABASE_URL      # Optional. PostgreSQL. Without it: echo-only mode, no persistence.
GITHUB_TOKEN      # Optional. Fine-grained PAT. Without it: GitHub tool disabled.
PORT              # Default: 3000
NODE_ENV          # development | production | test
```

Validated at startup via Zod. Server crashes immediately if `OPENAI_API_KEY` is missing.

## Testing

61 tests across 9 files. Run with `npm test`.

Well-covered: URL parsing, weather geocoding/forecast/WMO codes, recall timeframe resolution, GitHub fetchers, config validation, route contracts (session, history), summary JSON parsing.

Not covered by unit tests: WebRTC flow, sideband WebSocket lifecycle, React components. These are verified manually.

Pattern: mock `fetch` or Octokit at the boundary, test handler logic in isolation. Fastify `app.inject()` for route tests.

## Important decisions and tradeoffs

See `docs/decisions.md` for the full ADR log. Key ones:

- **Raw WebRTC + raw WebSocket, no SDK.** Lowest audio latency. More protocol handling but fewer dependencies and more control. (ADR-001)
- **Ephemeral key for sideband auth.** OpenAI's sideband endpoint requires the session-scoped ephemeral key, not the standard API key. Client sends it back to the server alongside `callId`. (ADR-009)
- **SQL full-text search, no vectors.** Works on vanilla PostgreSQL. Good enough for keyword/date recall. Vector search deferred. (ADR-003)
- **Separate client package, no workspaces.** Prevents TypeScript config cross-contamination between Node16 (server) and bundler (client) module resolution. (ADR-004)
- **CSS orb, no WebGL.** Zero dependencies, 60fps via `requestAnimationFrame` + CSS custom properties. Sufficient for demo polish. (ADR-008)
- **PTT default with VAD toggle.** PTT is reliable. VAD (semantic_vad) is available for hands-free demos but off by default. (ADR-002)

## Gotchas

- **The server never touches audio.** Audio goes browser → OpenAI → browser via WebRTC. If you're debugging audio issues, look at the client's RTCPeerConnection, not the server.
- **Ephemeral keys expire in ~60 seconds.** The sideband must connect within that window. In practice this happens in <1 second. `generateAndStoreSummary` uses the long-lived key because it runs after session close.
- **`useAnalyser` must not connect to `AudioContext.destination`.** Doing so breaks echo cancellation. It taps the stream read-only.
- **Tool availability is config-driven at startup.** `buildToolDefs()` runs once when the session route plugin registers. If you add a tool, it needs to be wired in `session.ts` in both `buildToolDefs` and `buildToolHandler`.
- **The `activeSidebands` map is in-memory.** If the server restarts, active sidebands are lost. This is acceptable for single-instance deployment but would need external state for horizontal scaling.
- **The GitHub tool only accepts URLs.** It cannot search for repos by name or list PRs. The system prompt tells the AI to use it "when the user provides a GitHub URL." This is a known design gap.
- **Tailwind v4 uses `@tailwindcss/vite` plugin.** There is no `tailwind.config.js`. Configuration is done via CSS `@theme` blocks in `index.css`.
