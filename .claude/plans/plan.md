# V2 Jarvis Audio — MVP Implementation Plan

Date: 2026-03-26
Based on: `.plans/research.md` (canonical research baseline)

---

## Contract

### 1. Problem

Jarvis V1 was built all-at-once, making it hard to debug, reason about, or extend. V2 is a ground-up rebuild of a real-time voice assistant that demonstrates: low-latency natural conversation, cross-session memory, read-only GitHub knowledge, evidence-backed factual answers, and graceful refusal. It must deploy to Railway as a working demo.

### 2. Requirements

| ID  | Requirement                                                        | Priority |
| --- | ------------------------------------------------------------------ | -------- |
| R1  | Low-latency, natural voice conversation via push-to-talk           | P0       |
| R2  | Cross-session recall ("What were we talking about yesterday?")     | P0       |
| R3  | Answer questions about GitHub repos/issues/PRs/comments from URLs  | P0       |
| R4  | Audible indication when Jarvis is working (tool execution)         | P0       |
| R5  | Interruption support (pause when user starts talking)              | P0       |
| R6  | Jarvis communicates its capabilities and limitations               | P0       |
| R7  | Never fabricate — say "I don't know" when facts are unsupported    | P0       |
| R8  | At least one API-backed factual capability (weather)               | P0       |
| R9  | Deploy to Railway                                                  | P1       |
| R10 | GitHub Actions CI/CD                                               | P1       |
| R11 | Session rollover before 60-minute expiry                           | P0       |
| R12 | Audible status differentiation (working vs. thinking vs. speaking) | P2       |

### 3. Acceptance criteria

**Voice loop (R1, R5):**

- Given a user presses push-to-talk → When they speak and release → Then Jarvis responds with audio within a conversational delay
- Given Jarvis is speaking → When the user presses push-to-talk → Then Jarvis stops speaking immediately

**Memory (R2):**

- Given a user had a conversation yesterday → When they ask "What did we talk about yesterday?" → Then Jarvis recalls topics from that session with correct attribution

**GitHub (R3):**

- Given a user provides a GitHub repo URL → When they ask "What does this repo do?" → Then Jarvis answers using fetched repo content with evidence
- Given a user provides a GitHub issue URL → When they ask about it → Then Jarvis summarizes the issue and its comments

**Evidence & refusal (R7):**

- Given a question with no supporting evidence → When Jarvis responds → Then it says a variant of "I don't know" instead of guessing
- Given a tool-backed answer → When stored → Then an `Evidence` record is persisted with source URL and timestamp

**Working indicator (R4):**

- Given Jarvis invokes a tool → When the tool is executing → Then the user hears/sees a working indication before the answer

**Deploy (R9):**

- Given the app is deployed to Railway → When a user visits the URL → Then they can have a voice conversation with all features working

### 4. Non-goals

- Swift / native client
- Passive wake word / background listening
- Open-mic VAD-first UX (push-to-talk only for MVP)
- GitHub write actions (creating issues, opening PRs)
- Multi-user auth and session isolation
- Vector-first memory retrieval (SQL-first for MVP; vector columns are a future additive migration)
- Full-repo indexing (fetch only requested artifacts)
- Multi-region or multi-replica scaling
- Private GitHub repository support (unless scope changes)

### 5. Constraints

| Constraint                                                                                            | Reason                                                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Must target OpenAI Realtime GA, not Beta                                                              | Beta deprecated May 7 2026 (~6 weeks)                                            |
| Model: `gpt-realtime-1.5`                                                                             | Best GA voice model, same pricing as predecessor                                 |
| Railway Hobby plan minimum ($5/mo)                                                                    | Free plan forces serverless, incompatible with voice                             |
| 60-minute max session duration                                                                        | OpenAI hard limit; rollover required                                             |
| 32K context window; 16K cap on instructions + tool defs; ~12K for conversation history; 4K max output | Instructions + tools must stay lean; conversation context is the flexible budget |
| No structured outputs on Realtime models                                                              | Tool args must be validated server-side                                          |
| TypeScript only                                                                                       | Per requirements + stack rules                                                   |
| Sideband auth: docs indicate server API key                                                           | M1 spike validates this works in practice                                        |

---

## Implementation Plan

### 1. Summary

V2 uses a **sideband architecture**: the browser connects WebRTC directly to OpenAI Realtime for low-latency audio, while the Fastify server connects a sideband WebSocket to the same Realtime session for tool execution, memory, and policy control. This keeps audio latency minimal while keeping all sensitive logic (tools, persistence, evidence) server-side.

The core SDK is `@openai/agents-realtime` which provides `RealtimeAgent` and `RealtimeSession` abstractions. Tools are defined with `tool()` using Zod schemas. The server's `RealtimeSession` (websocket transport) connects to the same OpenAI session the browser's WebRTC is connected to, tied together by `call_id`. PostgreSQL via Drizzle ORM stores sessions, turns, summaries, tool calls, and evidence records. SQL-first retrieval (full-text search + recency) handles memory recall; the schema is designed so vector columns can be added as a future additive migration.

**Why this architecture:** It's the pattern OpenAI recommends for browser voice apps. Audio goes directly browser↔OpenAI (lowest latency). Tools run on the server (security, persistence). The SDK handles tool dispatch, audio relay, and interruption automatically.

### 2. Current state

The project is empty scaffolding: `CLAUDE.md`, `docs/requirements.md`, `.plans/research.md`, rule files, and a `.gitignore`. No source code, no `package.json`, no configuration. V1 exists at `../jarvis-audioAssistant/` as architectural reference (Fastify + React monorepo, manual WebSocket relay, Drizzle + pgvector).

### 3. Milestone outline

Four milestones. M1 is the architecture validation gate — if it fails, we know immediately. M2-M4 build on a validated foundation.

- [x] **M1: Foundation + Voice Spike** — Validate the entire voice architecture end-to-end
  - [x] Step 1 — Project scaffolding (package.json, tsconfig, eslint, prettier, vitest) → verify: `npm run lint && npm run typecheck && npm test`
  - [x] Step 2 — Config + Fastify server core (config.ts, app.ts, server.ts, health endpoint) → verify: `npm run typecheck`
  - [x] Step 3 — Session endpoint + sideband manager (POST /api/session, POST /api/session/sideband, echo tool via raw WS) → verify: `npm run typecheck`
  - [x] Step 4 — Browser client (index.html, app.js, ui.js with raw WebRTC, PTT, data channel) → verify: manual browser test
  - [x] Step 5 — Unit tests (config validation, session route with mocked fetch) → verify: `npm test && npm run lint && npm run typecheck`
        Commit: "feat: M1 foundation + voice spike"
        Note: Using Option C from research — raw WebRTC on browser, raw WS sideband on server. SDK deferred to M2.
- [ ] **M2: Persistence + Memory** — Add durable storage, cross-session recall, and session rollover
  - [ ] Step 1 — Install deps (drizzle-orm, postgres, drizzle-kit) + add DATABASE_URL to config + drizzle.config.ts + npm scripts → verify: `npm run typecheck`
  - [ ] Step 2 — DB schema (sessions, turns, session_summaries, tool_calls, evidence_records) + connection module + generate initial migration → verify: `npm run typecheck`
  - [ ] Step 3 — Session lifecycle + turn capture (create session on connect, persist turns from sideband, end on disconnect) → verify: `npm run typecheck && npm test`
  - [ ] Step 4 — Summary generation (OpenAI text API after session end) + recall tool (SQL: recency, date, keyword via tsvector) + register in sideband → verify: `npm test && npm run lint && npm run typecheck`
        Commit: "feat: M2 persistence + memory"
        Note: Session rollover runtime deferred to M3 per plan — schema supports it from M2.
- [ ] **M3: Tools + Evidence** — Add GitHub, weather, capabilities, and the evidence/refusal contract
- [ ] **M4: Deploy + Polish + CI** — Railway deployment, client polish, GitHub Actions, evals

### 4. Milestone detail

#### M1: Foundation + Voice Spike

**Goal:** Prove the architecture works. Get a voice round-trip with server-side tool execution working in a browser.

**What gets built:**

```
project root
├── package.json                    # dependencies, scripts
├── tsconfig.json                   # strict mode, node16 module resolution
├── .eslintrc.cjs / .prettierrc    # linting + formatting
├── vitest.config.ts
├── src/
│   ├── config.ts                  # env config with Zod validation
│   ├── server/
│   │   ├── app.ts                 # Fastify app factory
│   │   ├── server.ts              # entry point (listen on PORT)
│   │   ├── routes/
│   │   │   └── session.ts         # POST /api/session → calls OpenAI /v1/realtime/client_secrets, returns ephemeral key
│   │   └── realtime/
│   │       └── sideband.ts        # sideband WebSocket manager
│   └── client/
│       ├── index.html             # minimal PTT UI
│       ├── app.ts                 # WebRTC connection, PTT logic
│       └── ui.ts                  # status display (idle/listening/processing/speaking)
```

- npm scripts: `dev`, `test`, `lint`, `typecheck`, `build`
- Fastify server with CORS, static file serving, health check
- `POST /api/session` — server calls OpenAI `POST /v1/realtime/client_secrets` (GA endpoint) to create ephemeral key, returns it to browser
- Minimal static HTML client: push-to-talk button, status display, basic transcript
- Client-side WebRTC connection to OpenAI Realtime using `@openai/agents-realtime` browser SDK
- Server-side `RealtimeSession` (websocket transport) connecting sideband to same session
- One trivial echo tool to prove server-side tool execution works through sideband
- `call_id` relay: browser posts SDP to `/v1/realtime/calls` with ephemeral key, gets `call_id` from Location header, sends it back to server (e.g., `POST /api/session/:id/sideband`) so server can connect sideband WS

**Spike exit criteria (must pass before proceeding):**

- [ ] Voice round-trip: user speaks → Jarvis responds with audio
- [ ] Push-to-talk: manual commit on release, no VAD
- [ ] Interruption: Jarvis stops speaking when user presses PTT
- [ ] Sideband: server receives tool call events, executes tool, result reaches Jarvis
- [ ] Auth token: which token (ephemeral vs API key) works for sideband WebSocket — document finding
- [ ] Latency: first audio response feels conversational (subjective check)
- [ ] Sideband stability: stays connected for 5+ minutes without drop
- [ ] Railway smoke test: deploy M1 to Railway, verify WebSocket keepalive and voice round-trip work through Railway's proxy
- [ ] Working indicator: does the model emit any unprompted audio when a tool fires? Document finding.

**If the spike fails:**

| Failure                                           | Pivot                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sideband auth doesn't work (ephemeral or API key) | Fall back to full server relay (server mediates all audio). Latency changes but M2–M4 design is unaffected — persistence layer is transport-agnostic. |
| WebRTC latency is unacceptable                    | Try WebSocket transport instead. More implementation complexity but more control.                                                                     |
| Interruption is broken                            | Investigate client-side truncation. If WebRTC interruption is fundamentally broken, WebSocket gives more control.                                     |
| `@openai/agents-realtime` SDK too unstable        | Drop to raw `openai` SDK + manual WebRTC/WebSocket setup. More code but fewer moving parts.                                                           |

**Testing:**

- Unit: config validation, ephemeral key generation logic
- Manual: voice round-trip, interruption, tool execution, latency feel
- Spike results documented in `docs/decisions.md` as ADRs

#### M2: Persistence + Memory

**Goal:** Store conversation history durably and enable cross-session recall.

**What gets built:**

- PostgreSQL connection via Drizzle ORM
- Database schema:
  - `sessions` (id, started_at, ended_at, metadata)
  - `turns` (id, session_id, role, content, created_at) — immutable raw turns
  - `session_summaries` (id, session_id, topics, entities, key_facts, unresolved, created_at)
  - `tool_calls` (id, turn_id, tool_name, args, result, evidence, created_at)
  - `evidence_records` (id, source_id, source_type, source_url, snippet, retrieved_at)
- Drizzle migration setup (`drizzle-kit`): adds `db:generate`, `db:migrate`, `db:studio` scripts
- Turn capture: hook into sideband events → persist turns as they happen (async, non-blocking)
- Session lifecycle: create on connect, end on disconnect, summarize on end
- Summary generation: use `@openai/agents` streaming text to generate session summaries asynchronously after session ends
- Cross-session recall tool: SQL queries — recency, date-based, keyword (PostgreSQL full-text search)
- Session rollover: detect approaching 60-min limit → summarize current state → open new session → inject summary + recent turns into new session's context. **Scope note:** rollover depends on summary generation and recall working first. If M2 runs long, rollover runtime logic can slip to M3 — the schema supports it from M2, and the tools in M3 generate the context worth rolling over.
- Seeding script for dev/demo data

**Schema design notes:**

- No vector columns in MVP — adding an embedding column to `session_summaries` later is a single additive migration. This avoids requiring pgvector extension on vanilla PostgreSQL (both `postgres:16` Docker image and Railway default template lack it).
- All timestamps with timezone
- Foreign keys for referential integrity
- JSONB for flexible metadata, entities, key_facts

**Testing:**

- Unit: recall query construction, summary extraction, date parsing for "yesterday"/"last week"
- Integration: DB round-trip (insert turns → query recall → verify results) — real PostgreSQL
- Manual: multi-session recall scenario, rollover continuity

#### M3: Tools + Evidence

**Goal:** Add the real capabilities — GitHub, weather, self-description — with the evidence and refusal contract.

**What gets built:**

- Evidence framework:
  - `Evidence` interface (matches research spec: sourceId, sourceType, sourceUrl, snippet, retrievedAt)
  - Helper to create, validate, and persist evidence
  - System prompt instructions: every factual claim must cite evidence; refuse if none
- Weather tool (Open-Meteo):
  - Geocoding → forecast fetch
  - Returns structured weather data with evidence (source URL, timestamp)
  - Caching with freshness check (avoid redundant fetches)
- GitHub tool (Octokit):
  - URL parser: detect repo, file, issue, PR, comment URLs
  - Fetchers for each entity type (repo metadata + README, file content, issue + comments, PR + review comments)
  - `@octokit/plugin-throttling` + `@octokit/plugin-paginate-rest` from day one
  - Content size guards (1MB file limit, truncation for large responses)
  - Evidence creation for every fetched artifact
  - `getGitHubToken()` abstraction (PAT now, GitHub App later)
- Capabilities tool: Jarvis describes what it can do and what it can't
- Refusal contract enforcement:
  - System prompt: "If you cannot ground your answer in evidence from tools, say you don't know"
  - Every tool result includes evidence or explicit null
  - Eval script to test refusal on unsupported questions
- Audible working indicator:
  - If M1 spike showed model emits audio on tool call → use it
  - If not → add client-side audio cue (short tone) + system prompt instruction for Jarvis to announce ("Let me check...")
- System prompt engineering: bring all capabilities, limitations, and behavior rules together

**Testing:**

- Unit: URL parser (parameterized: repo, file, issue, PR, comment, invalid), weather response mapping, evidence creation, capabilities text
- Integration: GitHub fetch → evidence → DB pipeline (mock GitHub API responses via MSW or similar)
- Manual: ask about a real repo, ask for weather, ask unsupported question, verify refusal
- Eval script: `scripts/eval-refusal.ts` — batch of unsupported questions, check for refusal rate
- Eval script: `scripts/eval-evidence.ts` — batch of supported questions, check evidence attachment rate

#### M4: Deploy + Polish + CI

**Goal:** Ship it. Working demo on Railway with CI and polished UX.

**What gets built:**

- Client UI polish:
  - Visual status states: idle, listening, processing, speaking (CSS state machine)
  - Live transcript display
  - Citation/evidence display (link, snippet, timestamp) for grounded answers
  - Error handling UI (connection lost, session expired, tool failure)
- Railway deployment:
  - `Dockerfile` or `nixpacks` config
  - Fastify listens on `::` per Railway Fastify guide
  - PostgreSQL service on Railway
  - Environment variables configured in Railway dashboard
  - Serverless mode explicitly disabled
  - Health check endpoint at `/health`
  - Keepalive ping (25s interval) to prevent Railway's 60s TCP timeout
  - `railway.toml` if needed
- GitHub Actions CI:
  - Lint (`eslint`)
  - Type check (`tsc --noEmit`)
  - Unit tests (`vitest run`)
  - Integration tests (with test PostgreSQL)
  - Build verification
- Production hardening:
  - Structured logging (pino, Fastify default)
  - Graceful shutdown (close DB, close sideband WS)
  - Error boundaries (tool failures don't crash the session)
  - Rate limiting on public endpoints
- End-to-end validation on Railway
- Eval suite: recall, refusal, evidence — runnable via `npm run eval`

**Testing:**

- CI runs all unit + integration tests on every push
- Manual: full voice session on deployed Railway instance
- Eval suite validates recall accuracy, refusal rate, evidence attachment rate

### 5. Testing strategy

**Framework:** Vitest (already in stack rules)
**Convention:** Co-located tests (`foo.ts` → `foo.test.ts`)

| Layer       | What                                                                         | How                                                          | When                                |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| Unit        | Config validation, URL parsing, evidence helpers, query builders, date logic | Vitest, pure functions, no mocks where possible              | Every milestone                     |
| Integration | DB operations, tool→evidence→DB pipeline, session lifecycle                  | Vitest, real PostgreSQL (Docker or Railway dev DB)           | M2, M3, M4                          |
| Spike       | Voice latency, interruption, sideband, working indicator                     | Manual with documented results → ADRs in `docs/decisions.md` | M1                                  |
| Eval        | Recall accuracy, refusal rate, evidence rate                                 | Scripts in `scripts/eval-*.ts`, runnable via `npm run eval`  | M3, M4                              |
| E2E         | Full voice session with all features                                         | Manual on local + Railway                                    | M4                                  |
| CI          | Lint + typecheck + unit + integration                                        | GitHub Actions                                               | M4 (runs on every push after setup) |

**Scripts:**

- `npm test` — unit tests
- `npm run test:integration` — integration tests (requires PostgreSQL)
- `npm run eval` — evaluation scripts (requires running server + API keys)
- `npm run lint` — ESLint + Prettier check
- `npm run typecheck` — `tsc --noEmit`

### 6. Migration & rollback

**Database:** Drizzle Kit manages migrations. Schema is additive across milestones (new tables, new columns). No destructive migrations in MVP. Rollback = drop tables (demo, not production).

**Session rollover:** Not a migration, but a runtime state transfer. If rollover logic fails, the session simply ends and the user starts fresh — degraded but not broken. Summary from the ended session is still persisted.

### 7. Manual setup tasks

| Task                       | Description                                                                                                                                                               | Depends on |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **OpenAI API key**         | Create/locate API key with Realtime API access. Set as `OPENAI_API_KEY` env var.                                                                                          | M1         |
| **Local PostgreSQL**       | Run PostgreSQL locally (Docker recommended: `docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`). Or use a Railway dev database.                               | M2         |
| **GitHub PAT**             | Create fine-grained PAT with read-only access to target repos. Set as `GITHUB_TOKEN` env var. Wrap behind `getGitHubToken()` abstraction for future GitHub App migration. | M3         |
| **Railway Hobby plan**     | Sign up for Railway Hobby plan ($5/mo). Create project.                                                                                                                   | M4         |
| **Railway PostgreSQL**     | Provision PostgreSQL service in Railway project. Note connection string.                                                                                                  | M4         |
| **Railway service config** | Deploy service, disable serverless mode, set env vars (OPENAI_API_KEY, GITHUB_TOKEN, DATABASE_URL).                                                                       | M4         |
| **Railway domain**         | Generate public domain for the service.                                                                                                                                   | M4         |
| **GitHub repo setup**      | Push to GitHub, enable Actions. Add Railway deploy token as secret if using CD.                                                                                           | M4         |

### 8. Risks

| Risk                                                                                                                               | Severity | Mitigation                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sideband auth token** — docs indicate server API key for sideband WebSocket, but untested in our stack                           | Medium   | M1 spike validates. If it doesn't work as documented: fall back to full relay (server mediates audio). Document finding as ADR.                                   |
| **Sideband instability on Railway** — WebSocket keepalive, proxy behavior                                                          | High     | M1 spike runs on Railway early. 25s keepalive ping. If unstable: full relay fallback.                                                                             |
| **Interruption quality** — may not feel immediate enough                                                                           | Medium   | M1 spike evaluates subjectively. If poor: tune VAD settings, add client-side audio stop, or accept degraded UX for demo.                                          |
| **Tool latency damages voice UX** — GitHub/weather calls take seconds                                                              | Medium   | M3 adds audible working indicator + system prompt "announce before calling tools." Async tool execution keeps session alive during wait.                          |
| **60-minute session rollover** — state transfer is tricky                                                                          | Medium   | M2 implements proactive rollover at ~55 min. Summary + recent turns + active context carried forward. If rollover fails: session ends cleanly, user starts fresh. |
| **OpenAI Realtime API changes** — pre-1.0 SDK, evolving API                                                                        | Medium   | Pin exact versions of `@openai/agents` and `@openai/agents-realtime`. Recheck at each milestone start.                                                            |
| **Railway host binding** — `::` vs `0.0.0.0` inconsistency in docs                                                                 | Low      | Try `::` (Fastify guide). If fails, try `0.0.0.0`. Document in deployment config.                                                                                 |
| **Context window pressure** — 16K cap on instructions + tools is tight; ~12K conversation budget is more generous but still finite | Medium   | Keep tool definitions lean. Monitor token usage in M2; compress conversation context only when approaching limits.                                                |
| **GitHub API rate limits** — 5000 req/hr for PAT, less for unauthenticated                                                         | Low      | `@octokit/plugin-throttling` from day one. Cache fetched artifacts.                                                                                               |

### 9. Open questions

These need human input before or during implementation:

| Question                                                                                                                                                                     | Affects                               | Default if no answer                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------- |
| **What latency threshold defines "good enough"?**                                                                                                                            | M1 spike exit criteria                | 500ms to first audio feels conversational                                                       | LOW AS POSSIBLE |
| **What should the audible working cue be?** Tone, spoken phrase, model placeholder, or combination?                                                                          | M3 working indicator                  | Whatever seems best practice / highest quality / polished                                       |
| **Is private GitHub support in MVP?**                                                                                                                                        | M3 GitHub tool scope, auth complexity | No — public repos only via PAT                                                                  |
| **Data retention duration for demo?**                                                                                                                                        | M2 schema, cleanup scripts            | Keep everything (demo, not production)                                                          |
| **What degraded behavior when GitHub/weather/memory fails?**                                                                                                                 | M3 error handling                     | Jarvis says "I'm having trouble reaching [service] right now" — graceful degradation, not crash |
| **Monorepo or single package?** V1 used pnpm workspaces (server/client/shared). V2 client is much thinner — a single package with `public/` for static files may be simpler. | M1 project structure                  | Single package. Client is static HTML/JS in `public/`. Server is `src/`.                        |

### 10. Package baseline

From research, verified 2026-03-26. Recheck at implementation time.

**Core:**

- `typescript` 5.x, `node` 22+
- `fastify` 5.8.4, `@fastify/cors` 11.2.0, `@fastify/static` 9.x, `@fastify/websocket` 11.2.0
- `@openai/agents` 0.8.1 (pin exact), `@openai/agents-realtime` 0.8.1 (pin exact)
- `openai` 6.33.0, `zod` 4.3.6, `ws` 8.x

**Database:**

- `drizzle-orm` 0.45.1, `drizzle-kit`, `drizzle-zod` 0.8.3
- `postgres` (pg driver) or `@neondatabase/serverless`

**GitHub:**

- `@octokit/rest` 22.0.1, `@octokit/plugin-throttling` 11.0.3, `@octokit/plugin-paginate-rest` 14.0.0

**Dev:**

- `vitest`, `eslint`, `prettier`, `tsx` (for dev server)

### 11. Architecture diagram (text)

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  [Push-to-Talk]  [Status]  [Transcript]  [Citations]        │
│       │                                                      │
│       ▼                                                      │
│  WebRTC (audio) ──────────────────────┐                     │
│       │                                │                     │
│  fetch /api/session ──┐                │                     │
└───────────────────────┼────────────────┼─────────────────────┘
                        │                │
                        ▼                ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│     Fastify Server       │   │   OpenAI Realtime API    │
│                          │   │                          │
│  POST /api/session       │   │  gpt-realtime-1.5       │
│    → ephemeral key       │   │  WebRTC (browser audio)  │
│                          │   │  WebSocket (sideband)    │
│  RealtimeSession ────────┼──►│                          │
│    (sideband WS)         │   │  Tool calls ──────────►  │
│    tools:                │   │  ◄────── Tool results    │
│      - recall            │   │                          │
│      - weather           │   └──────────────────────────┘
│      - github            │
│      - capabilities      │
│                          │
│  PostgreSQL ◄────────────┤
│    sessions              │
│    turns                 │
│    summaries             │
│    tool_calls            │
│    evidence_records      │
└──────────────────────────┘
```

### 12. Key architectural decisions to record

After M1 spike, document these in `docs/decisions.md`:

- **ADR-001:** Sideband vs full relay — which works, which auth token
- **ADR-002:** Push-to-talk implementation — VAD disabled, manual commit
- **ADR-003:** Working indicator approach — model placeholder vs client-side cue
- **ADR-004:** Single package vs monorepo

After M2:

- **ADR-005:** Session rollover strategy — timing, state carried forward
- **ADR-006:** Memory retrieval approach — SQL-first, what queries

---

**This plan is ready for review. No implementation will begin until you confirm.**
