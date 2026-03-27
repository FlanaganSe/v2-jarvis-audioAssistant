# Architecture Decision Records

### ADR-001: Sideband architecture with raw WebRTC + raw WebSocket

**Date:** 2026-03-26
**Status:** accepted
**Context:** Needed low-latency voice with server-side tool execution. SDK (`@openai/agents-realtime`) was considered but deferred due to instability risk.
**Decision:** Browser connects WebRTC directly to OpenAI for audio; server connects a raw WebSocket sideband to the same session for tool dispatch. No SDK — raw protocol on both sides.
**Consequences:** Lowest latency for audio. Tools run server-side with full DB/API access. More manual protocol handling but fewer dependencies.

### ADR-002: Push-to-talk with manual commit

**Date:** 2026-03-26
**Status:** accepted
**Context:** VAD (voice activity detection) adds complexity and false triggers. MVP needs reliable input.
**Decision:** Push-to-talk via pointer/space bar. `turn_detection: null` disables server-side VAD. Client sends `input_audio_buffer.commit` + `response.create` on release.
**Consequences:** No accidental activations. User must hold button to speak. Simpler than VAD but less natural.

### ADR-003: SQL-first memory retrieval (no vector search)

**Date:** 2026-03-26
**Status:** accepted
**Context:** Vector search (pgvector) requires an extension not present on vanilla PostgreSQL or Railway's default template. MVP recall needs are simple.
**Decision:** Cross-session recall uses PostgreSQL full-text search (`tsvector`) + recency + date filtering. Schema designed so a vector column can be added as an additive migration later.
**Consequences:** Works on any PostgreSQL instance. Good enough for keyword/date recall. Semantic similarity search deferred.

### ADR-004: Single package (no monorepo)

**Date:** 2026-03-26
**Status:** accepted
**Context:** V1 used pnpm workspaces (server/client/shared). V2 client is minimal static HTML/JS — no build step, no framework.
**Decision:** Single `package.json`. Server in `src/`, client in `public/` served by `@fastify/static`.
**Consequences:** Simpler tooling. No workspace overhead. Client changes don't need a build step.

### ADR-005: Hybrid eval strategy (agent-eval-kit + Vitest)

**Date:** 2026-03-26
**Status:** accepted
**Context:** Need to test both deterministic behavior (DB queries, tool outputs) and non-deterministic LLM behavior (refusal, evidence citation).
**Decision:** Vitest for unit/integration tests (deterministic). `agent-eval-kit` for LLM behavioral evals with record-replay (zero-cost CI via committed fixtures). Two suites: `refusal-accuracy` and `evidence-attachment`.
**Consequences:** CI runs evals at zero API cost (replay mode). Recording fixtures requires a live server + API keys. Two eval systems to maintain.

### ADR-006: Multi-stage Docker build for Railway

**Date:** 2026-03-26
**Status:** accepted
**Context:** Railway needs a deployable container. TypeScript must be compiled. Production image should be minimal.
**Decision:** Two-stage Dockerfile: builder stage compiles TS with full devDependencies, production stage copies `dist/` + `public/` + `drizzle/` with prod-only deps on Node 22 Alpine.
**Consequences:** Small production image. Drizzle migrations included for `db:migrate` on deploy. `NODE_ENV=production` set in image.
