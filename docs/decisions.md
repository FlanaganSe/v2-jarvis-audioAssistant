# Architecture Decision Records

### ADR-001: Sideband architecture with raw WebRTC + raw WebSocket

**Date:** 2026-03-26
**Status:** accepted
**Context:** Needed low-latency voice with server-side tool execution. SDK (`@openai/agents-realtime`) was considered but deferred due to instability risk.
**Decision:** Browser connects WebRTC directly to OpenAI for audio; server connects a raw WebSocket sideband to the same session for tool dispatch. No SDK — raw protocol on both sides.
**Consequences:** Lowest latency for audio. Tools run server-side with full DB/API access. More manual protocol handling but fewer dependencies.

### ADR-002: Push-to-talk default with VAD toggle

**Date:** 2026-03-26
**Status:** amended (2026-03-27)
**Context:** VAD adds complexity and false triggers. PTT is the reliable default, but hands-free mode is valuable for demos.
**Decision:** PTT is the default input mode. A VAD toggle sends `session.update` with `semantic_vad` (eagerness: auto, interrupt_response: true, create_response: true) over the data channel to switch mid-session. PTT uses the full GA sequence: `input_audio_buffer.clear` → `response.cancel` → `output_audio_buffer.clear` on push-down; `commit` + `response.create` on release. In VAD mode, barge-in is handled by pausing the local `<audio>` element on `input_audio_buffer.speech_started` and letting the server auto-cancel via `interrupt_response: true`.
**Consequences:** Reliable PTT baseline with natural hands-free conversation in VAD mode. No reconnect needed to switch modes.

### ADR-003: SQL-first memory retrieval (no vector search)

**Date:** 2026-03-26
**Status:** accepted
**Context:** Vector search (pgvector) requires an extension not present on vanilla PostgreSQL or Railway's default template. MVP recall needs are simple.
**Decision:** Cross-session recall uses PostgreSQL full-text search (`tsvector`) + recency + date filtering. Schema designed so a vector column can be added as an additive migration later.
**Consequences:** Works on any PostgreSQL instance. Good enough for keyword/date recall. Semantic similarity search deferred.

### ADR-004: Standalone client package (no workspaces)

**Date:** 2026-03-26
**Status:** amended (2026-03-26)
**Context:** Frontend grew beyond static HTML/JS. React + Vite + Tailwind v4 needed for demo-quality UI. TypeScript configs for server (Node16) and client (bundler) must not cross-contaminate.
**Decision:** `client/` has its own `package.json` and `tsconfig.json`. No npm workspaces — root scripts use `--prefix client`. `postinstall` auto-installs client deps. Fastify serves `client/dist/` in production via `@fastify/static`.
**Consequences:** Full type isolation. Two `node_modules` (slightly more disk). Dev uses `concurrently` for parallel server + Vite. Single Railway service still serves everything.

### ADR-005: Hybrid eval strategy (agent-eval-kit + Vitest)

**Date:** 2026-03-26
**Status:** accepted
**Context:** Need to test both deterministic behavior (DB queries, tool outputs) and non-deterministic LLM behavior (refusal, evidence citation).
**Decision:** Vitest for unit/integration tests (deterministic). `agent-eval-kit` for LLM behavioral evals with record-replay (zero-cost CI via committed fixtures). Two suites: `refusal-accuracy` and `evidence-attachment`.
**Consequences:** CI runs evals at zero API cost (replay mode). Recording fixtures requires a live server + API keys. Two eval systems to maintain.

### ADR-006: Three-stage Docker build for Railway

**Date:** 2026-03-26
**Status:** amended (2026-03-26)
**Context:** React client added in `client/`. Need to build both client and server, keep production image minimal.
**Decision:** Three-stage Dockerfile: `client-builder` (npm ci + vite build), `builder` (npm ci + tsc), runtime (prod deps + `dist/` + `client/dist/` + `drizzle/`). Each stage caches independently.
**Consequences:** Client and server build in parallel layers. Production image serves React from `client/dist/` via `@fastify/static` with SPA catch-all. `public/` no longer copied to production.

### ADR-007: React + Vite + Tailwind v4 frontend

**Date:** 2026-03-26
**Status:** accepted
**Context:** Demo needs visual polish (audio-reactive orb, session sidebar, transcript, VAD toggle) beyond what vanilla JS in `public/` can sustain. Research compared embedded static client vs React.
**Decision:** React 19 + Vite + Tailwind CSS v4 in `client/`. Tailwind v4 uses `@tailwindcss/vite` plugin (no config file). Vite proxies `/api` to Fastify in dev.
**Consequences:** Component model for UI complexity. Type-safe JSX. Tailwind utilities for rapid layout. ~200 KB JS bundle (acceptable for demo).

### ADR-008: CSS orb with Web Audio API amplitude (no WebGL)

**Date:** 2026-03-26
**Status:** accepted
**Context:** Audio-reactive orb is the highest-impact visual element. Options: CSS-only, Three.js/WebGL, or pre-built package.
**Decision:** CSS-only orb using `useAnalyser` hook (Web Audio `AnalyserNode` → RMS amplitude → `--amplitude` CSS custom property at 60fps via `requestAnimationFrame`). Glow via `::before` opacity (GPU-composited). No `setState` in rAF loop.
**Consequences:** Zero new dependencies. 60fps animation without React re-renders. Cannot match ChatGPT's fluid shader effects, but sufficient for demo polish. Upgrade path to WebGL preserved.

### ADR-009: Sideband auth uses ephemeral key, not standard API key

**Date:** 2026-03-26
**Status:** accepted
**Context:** Sideband WebSocket to `wss://api.openai.com/v1/realtime?call_id=...` returned 404 when authenticated with the standard API key (`sk-proj-...`). M1 logging confirmed the error; OpenAI's sideband endpoint requires the session-scoped ephemeral key.
**Decision:** Client sends `ephemeralKey` alongside `callId` in `POST /api/session/sideband`. Server uses it for the sideband WS `Authorization` header, falling back to `config.OPENAI_API_KEY` if absent. `generateAndStoreSummary` (called after session close) still uses the long-lived key since the ephemeral key expires after ~60s.
**Consequences:** Sideband connects successfully. All server-side tools (weather, GitHub, recall, capabilities) now work. The ephemeral key transits the wire twice (server→client→server) but is already browser-resident from the SDP exchange, adding no real exposure.

### ADR-010: OpenAI Realtime GA migration

**Date:** 2026-03-26
**Status:** accepted
**Context:** OpenAI Realtime API beta events deprecated April 30, 2026. Codebase used 3 deprecated event names and a deprecated header.
**Decision:** Migrated all event names to GA (`response.output_audio_transcript.delta/done`). Removed `OpenAI-Beta: realtime=v1` header. Added `input_audio_buffer.clear` + `output_audio_buffer.clear` to PTT sequence per GA docs.
**Consequences:** Protocol-compliant before deadline. PTT no longer bleeds stale audio on interrupt.
