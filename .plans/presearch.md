# MVP Presearch

Date: 2026-03-26
Scope: lightweight build-direction notes, not formal research

## Working recommendation

Build the MVP around a TypeScript monorepo with a small browser companion app, a Fastify backend, server-side tool execution, PostgreSQL-backed memory, and a voice path that can start with OpenAI's current realtime stack while preserving a clean fallback path to a more provider-composed pipeline later.

There are two viable shapes:

1. Browser voice first with the OpenAI Agents SDK / Realtime path, plus server-side tools and memory.
2. A tighter server relay like v1, which is usually easier to debug and enforce trust boundaries.

The best next step before planning is a short spike to compare those two shapes on Railway for interruption, latency, and tool orchestration complexity.

## Tools

- `npm` workspaces or `pnpm` workspaces; v1 used `pnpm` cleanly
- TypeScript 5.x, Node.js 22+
- Vitest for unit and integration tests
- Railway for deployment
- Drizzle for schema and query ergonomics
- `jose` for JWTs
- `zod` for tool and route contracts
- OpenTelemetry from the start if you want latency and tool-trace visibility early

Note: v1 used Biome successfully, while the current v2 stack doc names ESLint + Prettier. Pick one formatter/lint path early and avoid carrying both.

## Technologies and frameworks

- Fastify for the backend: strong TypeScript ergonomics, WebSocket support, low overhead
- React + Vite for a lightweight companion UI
- PostgreSQL for sessions, messages, and memory summaries
- `pgvector` later if semantic memory becomes necessary; not required on day one
- Redis as optional cache only if freshness or session-state pressure appears
- Railway as the single-service MVP deployment target

## Libraries and projects of interest

- OpenAI Realtime API and Agents SDK for TypeScript
- OpenAI `openai` SDK
- LiveKit Agents for Node.js as the strongest portability/scaling fallback if the MVP outgrows the OpenAI-native voice path
- Octokit for GitHub read operations
- Deepgram Flux or Nova if you later move to a cascaded STT -> LLM -> TTS architecture
- Cartesia Sonic Turbo if you later need lower-level streaming TTS control

## Techniques that matter

- Push-to-talk first, not wake-word first
- Evidence-gated answering for all operational facts
- Audible progress cues when work exceeds a short threshold
- Server-side tool execution only
- Capability registry so Jarvis can explain what it can and cannot do
- Session summaries first; semantic recall second
- Adapter boundaries around voice, GitHub, memory, and external API integrations
- Read-only GitHub analysis in MVP; proposals before mutations

## Suggested MVP assembly

- `shared/`: wire types, evidence types, capability types, session constants
- `server/`: Fastify app, auth, tool registry, GitHub adapter, external API adapter, memory store, observability
- `client/`: push-to-talk UI, transcript, evidence/freshness display, status/progress indicators

### Suggested build order

1. Real-time conversation loop with interruption and audible progress cue
2. Tool registry and evidence threading
3. GitHub URL ingestion and read-only Q&A
4. External API adapter with strict freshness checks
5. Session persistence and simple recall
6. Capability self-description
7. Railway deployment hardening

## What to reuse from v1

- The TypeScript monorepo split between shared, server, and client
- The read-only GitHub-first product shape
- Evidence objects and citation/freshness threading
- PostgreSQL-backed session persistence
- The policy idea that unsupported facts must produce refusal

## What not to inherit blindly from v1

- Any provider choice that was only "best at the time"
- Any premature infrastructure added for features outside MVP
- Any assumption that the relay architecture is still the best first choice now that OpenAI's current voice guidance favors the TypeScript Agents SDK for browser voice agents

## Unknown unknowns worth validating early

- The exact external API contract: auth, quotas, freshness semantics, and failure modes
- Whether the preferred voice transport behaves well on Railway under real network conditions
- How much control is needed over interruption and server-side policy in the first iteration
- GitHub API rate-limit behavior for comment-heavy repo questions
- Whether simple summary-based memory is enough before vector search
- How to measure and enforce "no unsourced operational claims" in tests and demos
- If bonus Swift work becomes real, how background audio and passive activation constraints change the design

## Short recommendation

If speed and clarity matter most, the most defensible MVP is:

- web-first
- push-to-talk
- read-only GitHub
- one external API
- server-side tools
- PostgreSQL memory
- OpenAI realtime voice path first
- provider abstraction kept thin and honest, not over-engineered

## Sources

- Current requirements: `docs/requirements.md`
- V1 product and research notes:
  - `/Users/seanflanagan/glt/frontierAudio/jarvis-audioAssistant/docs/research.md`
  - `/Users/seanflanagan/glt/frontierAudio/jarvis-audioAssistant/docs/research-providers.md`
  - `/Users/seanflanagan/glt/frontierAudio/jarvis-audioAssistant/docs/architecture.md`
  - `/Users/seanflanagan/glt/frontierAudio/jarvis-audioAssistant/docs/product-overview.md`
- OpenAI Realtime API docs: https://developers.openai.com/api/docs/guides/realtime/
- OpenAI voice agents guidance: https://developers.openai.com/api/docs/guides/realtime/#voice-agents
- OpenAI GPT-5 docs note: https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_new_params_and_tools/
- LiveKit voice AI quickstart: https://docs.livekit.io/agents/start/voice-ai/
- Deepgram live streaming audio docs: https://developers.deepgram.com/docs/live-streaming-audio
- Cartesia docs: https://docs.cartesia.ai/get-started/overview
