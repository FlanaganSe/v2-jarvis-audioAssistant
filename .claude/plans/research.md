# API Research: OpenAI Realtime, @openai/agents-realtime, Fastify 5

Date: 2026-03-26
Scope: Concrete API shapes, code patterns, and version facts for M1 implementation

---

## 1. Current State

The project is empty scaffolding. No `package.json`, no `src/`. The plan (`plan.md`) references the architecture but no implementation exists. This research document replaces and supersedes prior loose research notes — it is written against GA APIs as of 2026-03-26.

---

## 2. Constraints

| Constraint                            | Source                   | Reason                                            |
| ------------------------------------- | ------------------------ | ------------------------------------------------- |
| Must use GA Realtime API, not beta    | `plan.md:70`             | Beta deprecated May 7 2026                        |
| Model must be `gpt-realtime-1.5`      | `plan.md:71`             | Best GA voice model, 20% cheaper than predecessor |
| TypeScript only, Node 22+             | `.claude/rules/stack.md` | Stack rule                                        |
| `@openai/agents-realtime` 0.8.1 exact | `plan.md:344-348`        | Pre-1.0 SDK, pin to avoid breaking changes        |
| Fastify 5.x                           | `plan.md:346`            | Server framework                                  |

---

## 3. Verified API Shapes

### 3.1 Ephemeral Client Secret — `POST /v1/realtime/client_secrets`

This is the GA endpoint. The earlier `/v1/realtime/sessions` endpoint also exists (creates a session without the SDP exchange) but the client_secrets endpoint is what the WebRTC flow uses.

**Server-side request (real API key):**

```ts
const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-realtime-1.5',
    voice: 'alloy',           // or any supported voice
    instructions: '...',      // system prompt
    tools: [...],             // optional, can be set later via sideband
    turn_detection: { type: 'server_vad' } | null,
  }),
});
const data = await response.json();
// data.value     → the ephemeral key, string starting with "ek_"
// data.expires_at → unix timestamp (1 minute TTL, non-configurable)
// data.session   → RealtimeSessionConfig object
```

**Response shape:**

```json
{
  "value": "ek_68af296e8e408191a1120ab6383263c2",
  "expires_at": 1756310470,
  "session": {
    "type": "realtime",
    "object": "realtime.session",
    "id": "...",
    "model": "gpt-realtime-1.5",
    "output_modalities": ["audio"],
    "instructions": "...",
    "tools": [],
    "tool_choice": "auto",
    "max_output_tokens": "inf"
  }
}
```

Key facts:

- TTL is always 1 minute, hardcoded by OpenAI
- `value` field (not `client_secret.value`) is the ephemeral key at the top level
- The `ek_` prefix identifies it as ephemeral in browser checks
- Source: [Create client secret | OpenAI API Reference](https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret)

---

### 3.2 WebRTC Browser Connection Flow

The browser exchanges SDP with OpenAI at `https://api.openai.com/v1/realtime/calls`.

**Browser-side (complete flow):**

```ts
// 1. Fetch ephemeral key from our server
const { ephemeralKey } = await fetch('/api/session').then((r) => r.json());

// 2. Create peer connection and audio output
const pc = new RTCPeerConnection();
const audioEl = document.createElement('audio');
audioEl.autoplay = true;
pc.ontrack = (e) => {
  audioEl.srcObject = e.streams[0];
};

// 3. Add microphone track
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

// 4. Create data channel for events (must be named 'oai-events')
const dc = pc.createDataChannel('oai-events');

// 5. SDP offer → POST to OpenAI → get answer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ephemeralKey}`,
    'Content-Type': 'application/sdp',
  },
  body: offer.sdp,
});

// 6. Extract call_id from Location header for sideband
const callId = sdpResponse.headers.get('Location')?.split('/').pop();
// callId looks like: "rtc_u1_9c6574da8b8a41a18da9308f4ad974ce"

// 7. Set remote description (SDP answer)
const answerSdp = await sdpResponse.text();
await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

// 8. Relay callId to our server for sideband connection
await fetch('/api/session/sideband', {
  method: 'POST',
  body: JSON.stringify({ callId }),
});

// 9. Send events via data channel when open
dc.addEventListener('open', () => {
  // Can now send/receive realtime events as JSON strings
});
dc.addEventListener('message', (e) => {
  const event = JSON.parse(e.data); // server events
});
```

Key facts:

- Endpoint is `/v1/realtime/calls`, NOT `/v1/realtime/sessions` for SDP exchange
- Content-Type must be `application/sdp` for the SDP POST
- `Location` response header contains the `call_id` needed for sideband
- Data channel MUST be named `'oai-events'` (SDK enforces this)
- Regular API key must NOT be used in browser (SDK throws unless `useInsecureApiKey: true`)
- Source: [Realtime API with WebRTC | OpenAI API](https://platform.openai.com/docs/guides/realtime-webrtc)

**Using `@openai/agents-realtime` WebRTC transport instead of raw WebRTC:**

The SDK `OpenAIRealtimeWebRTC` class does this entire flow internally. The browser only needs to:

```ts
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const agent = new RealtimeAgent({ name: 'Jarvis', instructions: '...' });
const session = new RealtimeSession(agent);

// connect() runs the full SDP exchange internally
// The ephemeral key must be provided; the SDK rejects plain API keys in browsers
await session.connect({ apiKey: ephemeralKey });
```

The `call_id` is extracted internally by the SDK from the `Location` header but is not currently exposed via a public API — see sideband section below.

---

### 3.3 Sideband WebSocket Architecture

A sideband is a second connection to the same Realtime session. The browser holds the WebRTC connection for audio; the server holds a WebSocket to the same session for tool execution and event monitoring.

**How it works:**

1. Browser does WebRTC SDP handshake → gets `call_id` from `Location` header
2. Browser sends `call_id` to the Fastify server (e.g., `POST /api/session/sideband`)
3. Server opens a WebSocket to `wss://api.openai.com/v1/realtime?call_id=<callId>` using the real API key (not ephemeral)
4. Server receives and sends Realtime API events exactly as in a normal WebSocket session

**Server-side sideband connection:**

```ts
import WebSocket from 'ws';

const callId = 'rtc_u1_9c6574da8b8a41a18da9308f4ad974ce'; // received from browser
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, {
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1', // may be required
  },
});

ws.on('message', (raw) => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'response.function_call_arguments.done') {
    // handle tool call
  }
});
```

**Using `@openai/agents-realtime` WebSocket transport for sideband:**

```ts
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebSocket } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Jarvis',
  instructions: '...',
  tools: [recallTool, weatherTool, githubTool],
});

// Pass the call_id to tell the WebSocket transport to join an existing session
const transport = new OpenAIRealtimeWebSocket({
  callId: callId, // join existing WebRTC session
});

const session = new RealtimeSession(agent, { transport });
await session.connect({ apiKey: process.env.OPENAI_API_KEY });
```

**Known gap:** The `call_id` is not easily accessible from the SDK when the browser uses `OpenAIRealtimeWebRTC`. The SDK extracts it from the `Location` header internally but does not expose a public property. Community workaround is to intercept `window.fetch` to capture the header before the SDK processes it, or to do the SDP exchange manually (raw WebRTC) and pass the `call_id` explicitly. This is a spike item (plan.md ADR-001).

Source: [Webhooks and server-side controls | OpenAI API](https://platform.openai.com/docs/guides/realtime-server-controls)
Source: [How to access the location header for Realtime API feature Sideband with Agents SDK](https://community.openai.com/t/how-to-access-the-location-header-for-realtime-api-feature-sideband-with-agents-sdk/1358612)

---

### 3.4 `@openai/agents-realtime` Package — Exports and Patterns

**Package:** `@openai/agents-realtime` v0.8.1 (install with `@openai/agents` which re-exports it)

**Import paths:**

```ts
// High-level (recommended)
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';

// Direct package
import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
  OpenAIRealtimeWebSocket,
} from '@openai/agents-realtime';
```

**Complete exports from `@openai/agents-realtime`:**

- Classes: `RealtimeAgent`, `RealtimeSession`, `OpenAIRealtimeWebRTC`, `OpenAIRealtimeWebSocket`, `OpenAIRealtimeSIP`, `OpenAIRealtimeBase`, `RealtimeOutputGuardrail`
- Types: `RealtimeAgentConfiguration`, `RealtimeSessionOptions`, `RealtimeSessionConnectOptions`, `RealtimeSessionEventTypes`, `RealtimeSessionConfig`, `RealtimeContextData`, `OpenAIRealtimeEventTypes`, `RealtimeTransportEventTypes`
- Items: `RealtimeItem`, `RealtimeToolCallItem`, `RealtimeMessageItem`, `RealtimeMcpCallItem`
- Constants: `DEFAULT_OPENAI_REALTIME_MODEL`, `DEFAULT_OPENAI_REALTIME_SESSION_CONFIG`
- Re-exported from `@openai/agents-core`: `FunctionTool`, `tool`, `backgroundResult`, `isBackgroundResult`, `ModelBehaviorError`, `OutputGuardrailTripwireTriggered`, `UserError`

**`RealtimeAgent` constructor:**

```ts
new RealtimeAgent({
  name: string,                    // required
  instructions?: string,           // system prompt for this agent
  tools?: FunctionTool[],          // tool() instances
  handoffs?: RealtimeAgent[],      // sub-agents for delegation
  voice?: string,                  // e.g. 'alloy', 'cedar' — can't change after first agent speaks
  // NOT supported: model, modelSettings, outputType, toolUseBehavior
  // model is configured at RealtimeSession level
})
```

**`RealtimeSession` constructor:**

```ts
new RealtimeSession(
  initialAgent: RealtimeAgent,
  options?: {
    transport?: RealtimeTransportLayer,   // defaults to WebRTC in browser, WebSocket on server
    model?: OpenAIRealtimeModels,         // default: 'gpt-realtime-1.5'
    outputGuardrails?: RealtimeOutputGuardrail[],
    context?: TBaseContext,
    // ...additional session config
  }
)

// connect
await session.connect({
  apiKey: string,          // ephemeral key for browser WebRTC, real API key for server WebSocket
  // additional transport-specific options
});
```

**Session events:**

```ts
session.on('agent_tool_start', ({ tool }) => {
  /* tool executing */
});
session.on('agent_tool_end', ({ tool, result }) => {
  /* tool done */
});
session.on('history_updated', (history) => {
  /* turns updated */
});
session.on('transport_event', (event) => {
  /* raw realtime event */
});
session.on('error', (err) => {
  /* handle error */
});
session.on('audio', (audioData) => {
  /* audio chunks */
});
session.on('audio_interrupted', () => {
  /* user interrupted */
});
```

---

### 3.5 Tool Definitions

```ts
import { tool } from '@openai/agents/realtime'; // or '@openai/agents-core'
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: z.object({
    location: z.string().describe('City name or coordinates'),
  }),
  execute: async (input, context) => {
    // input is typed from the Zod schema
    // context.context is the TBaseContext passed to RealtimeSession
    const weather = await fetchWeather(input.location);
    return JSON.stringify(weather); // return string
  },
});

const agent = new RealtimeAgent({
  name: 'Jarvis',
  tools: [weatherTool],
});
```

Tool facts:

- Zod v4 is required (SDK uses it internally)
- `execute` receives `(typedInput, { context })` — context is the session context object
- `backgroundResult(value)` wraps return value to suppress triggering a new model turn
- Tool execution runs server-side in the sideband `RealtimeSession`
- Tool args come from the model as JSON; the SDK validates them via Zod before calling `execute`
- Source: [Tools | OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/tools/)

---

### 3.6 Model Names (GA, 2026-03-26)

From `openaiRealtimeBase.ts` and official model docs:

```ts
type OpenAIRealtimeModels =
  | 'gpt-realtime'
  | 'gpt-realtime-1.5' // DEFAULT — best GA voice model
  | 'gpt-realtime-2025-08-28'
  | 'gpt-4o-realtime-preview' // DEPRECATED (Sep 2025, removed ~Mar 2026)
  | 'gpt-4o-realtime-preview-2024-10-01'
  | 'gpt-4o-realtime-preview-2024-12-17'
  | 'gpt-4o-realtime-preview-2025-06-03'
  | 'gpt-4o-mini-realtime-preview'
  | 'gpt-4o-mini-realtime-preview-2024-12-17'
  | 'gpt-realtime-mini'
  | 'gpt-realtime-mini-2025-10-06'
  | 'gpt-realtime-mini-2025-12-15';
```

`DEFAULT_OPENAI_REALTIME_MODEL = 'gpt-realtime-1.5'`

The `gpt-4o-realtime-preview` family was deprecated September 2025 with removal planned March 2026 — it may already be unavailable. Do not use it.

Source: [gpt-realtime Model | OpenAI API](https://platform.openai.com/docs/models/gpt-realtime), [Introducing gpt-realtime](https://openai.com/index/introducing-gpt-realtime/), `openaiRealtimeBase.ts`

---

### 3.7 `@openai/agents` Package (non-realtime)

Used for text-only features (session summarization, eval scripts).

```ts
import { Agent, run, tool } from '@openai/agents';
```

Version: 0.8.1 (same monorepo as `@openai/agents-realtime`)
Install: `npm install @openai/agents zod`

The `tool` export is shared between `@openai/agents` and `@openai/agents-realtime` — both re-export it from `@openai/agents-core`.

Source: [@openai/agents - npm](https://www.npmjs.com/package/@openai/agents)

---

### 3.8 `openai` npm Package

Version: 6.33.0 (as of 2026-03-26)

Used for: direct API calls where the agents SDK is overkill (e.g., session summarization, evidence fetching). The `@openai/agents-realtime` SDK uses this internally.

```ts
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

Source: [openai - npm](https://www.npmjs.com/package/openai)

---

### 3.9 Fastify 5 with Static Files and CORS

**Versions for Fastify 5.x:**

- `fastify`: 5.8.4
- `@fastify/cors`: 11.2.0 (Fastify 5 compatible)
- `@fastify/static`: 9.0.0 (Fastify 5 compatible)
- `@fastify/websocket`: 11.2.0

**Setup pattern:**

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? 'https://your-domain.railway.app' : true,
});

await app.register(staticFiles, {
  root: join(__dirname, '../../public'),
  prefix: '/',
});

app.get('/health', async () => ({ ok: true }));

// POST /api/session — mint ephemeral key
app.post('/api/session', async (req, reply) => {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-realtime-1.5' }),
  });
  const data = await res.json();
  return { ephemeralKey: data.value };
});
```

**Known issue:** When `@fastify/cors` and `@fastify/static` are both registered, CORS headers may not be set on static file responses. Fix: register CORS before static, or add an explicit `onSend` hook.

Source: [@fastify/cors - npm](https://www.npmjs.com/package/@fastify/cors), [@fastify/static - npm](https://www.npmjs.com/package/@fastify/static)

---

## 4. Options

### Option A: Raw WebRTC + raw WebSocket (no SDK)

Browser does RTCPeerConnection manually. Server connects raw `ws` to `wss://api.openai.com/v1/realtime?call_id=...`. Tool dispatch, audio handling, and event routing are all hand-rolled.

Pros: Full control, `call_id` is trivially available from SDP response headers, no pre-1.0 SDK dependency risk.
Cons: Significant boilerplate. Audio interrupt logic, tool execution sequencing, and turn management must be written from scratch. Higher bug surface.

### Option B: `@openai/agents-realtime` SDK (both browser and server)

Browser uses `RealtimeSession` with `OpenAIRealtimeWebRTC` transport. Server uses `RealtimeSession` with `OpenAIRealtimeWebSocket` transport and `callId` to join same session.

Pros: Tool dispatch, output guardrails, audio interruption, and event routing handled by SDK. Minimal boilerplate.
Cons: SDK is pre-1.0 (0.8.1). The `call_id` is not exposed via a public API when using the browser-side SDK — requires a fetch interceptor or raw WebRTC for SDP phase. SDK changes could break things.

### Option C: SDK on server, raw WebRTC on browser

Browser does raw SDP exchange (gets `call_id` trivially from `Location` header), relays `call_id` to server. Server uses `RealtimeSession` with `OpenAIRealtimeWebSocket` and the real API key.

Pros: `call_id` is trivially available without hacks. Server-side benefits of SDK (tool dispatch, guardrails) retained. Browser stays thin and stable.
Cons: More browser code than Option B. Browser must handle data channel events manually if it wants to display transcripts.

---

## 5. Recommendation

**Option C: Raw WebRTC on browser, `@openai/agents-realtime` SDK on server.**

Reasoning:

- The browser's job is audio I/O and PTT — it does not execute tools. Keeping it raw eliminates the biggest SDK friction point (the hidden `call_id`).
- The server uses the SDK where it pays off most: `tool()` registration, `RealtimeSession` event loop, output guardrails, and context management.
- The `call_id` extraction problem goes away entirely — the browser directly reads the `Location` header from its own SDP fetch.
- If the SDK breaks (pre-1.0), the server-side fallback is a raw WebSocket — the browser doesn't change at all.

This matches the plan's architecture sketch (`plan.md:84-89`) and the M1 spike criteria.

---

## 6. Sources of Truth

| Area                                                           | Canonical Source                                                                                                                       | Verification Method                                                            | Drift Risk                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `POST /v1/realtime/client_secrets` endpoint and response shape | [Create client secret reference](https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret)       | Hit the endpoint, verify `value` field starts with `ek_`                       | Low — GA, stable                                                                            |
| SDP exchange endpoint (`/v1/realtime/calls`)                   | [Realtime API with WebRTC guide](https://platform.openai.com/docs/guides/realtime-webrtc)                                              | Check `Location` header contains `rtc_` prefix call_id                         | Low — GA                                                                                    |
| Sideband WebSocket URL (`wss://...?call_id=`)                  | [Server-side controls guide](https://platform.openai.com/docs/guides/realtime-server-controls)                                         | Attempt connection with real API key after SDP exchange                        | Medium — feature is GA but sideband auth token (ephemeral vs real) unconfirmed in our stack |
| `@openai/agents-realtime` exports and types                    | [GitHub: openai/openai-agents-js](https://github.com/openai/openai-agents-js) `packages/agents-realtime/src/index.ts`                  | Read the source at pin (0.8.1 tag)                                             | High — pre-1.0, actively developed                                                          |
| `OpenAIRealtimeModels` type union                              | `openaiRealtimeBase.ts` in SDK source                                                                                                  | Check `DEFAULT_OPENAI_REALTIME_MODEL` export at pin                            | High — new models added frequently                                                          |
| `gpt-realtime-1.5` as default model                            | [Introducing gpt-realtime](https://openai.com/index/introducing-gpt-realtime/), SDK source                                             | Verify `DEFAULT_OPENAI_REALTIME_MODEL === 'gpt-realtime-1.5'` in pinned source | Medium — model aliases may shift                                                            |
| Fastify 5 plugin versions                                      | [@fastify/cors npm](https://www.npmjs.com/package/@fastify/cors), [@fastify/static npm](https://www.npmjs.com/package/@fastify/static) | `npm info @fastify/cors peerDependencies` at install time                      | Low — major versions change slowly                                                          |
| `openai` npm package version                                   | [openai npm](https://www.npmjs.com/package/openai)                                                                                     | `npm info openai version`                                                      | Low — used as direct client, not primary SDK                                                |
| Zod v4 requirement                                             | `@openai/agents-core` peer deps                                                                                                        | `npm info @openai/agents-core peerDependencies`                                | Medium — Zod v4 is recent; tooling ecosystem still catching up                              |

---

## 7. Open Spikes (not researchable without running code)

These cannot be resolved by documentation and must be validated in M1:

1. **Sideband auth token** — Does the sideband WebSocket accept the real (non-ephemeral) API key? The docs indicate yes, but this must be confirmed empirically. If it only accepts the ephemeral key (which expires in 1 minute), the architecture changes significantly.

2. **`call_id` with SDK browser transport** — If Option B is ever tried, confirming whether `callId` is accessible from `OpenAIRealtimeWebRTC` as a post-connect property (the fetch interceptor community workaround is fragile). Moot if Option C is used.

3. **Tool execution latency on Railway** — Does the round-trip sideband tool call (Railway → OpenAI → Railway → tool → OpenAI → browser) add perceptible latency vs. bare metal?

4. **`push_to_talk` vs `server_vad` turn detection** — Setting `turn_detection: null` on session config disables VAD and requires manual `input_audio_buffer.commit`. Must be confirmed to work correctly via sideband.

---

## 8. V1 Database Schema Research (M2 Reference)

Date: 2026-03-26
Scope: V1 schema, connection setup, migration config, and query patterns — for use in M2 design

---

### 8.1 Current State

V1 has a complete, production-used Drizzle + PostgreSQL layer at `/Users/seanflanagan/glt/frontierAudio/jarvis-audioAssistant/server/src/db/`.

**Files:**

| File                                | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `server/src/db/schema.ts`           | All table definitions                              |
| `server/src/db/index.ts`            | Connection factory and singleton accessor          |
| `server/drizzle.config.ts`          | drizzle-kit config (dialect, out dir, credentials) |
| `server/drizzle/0000_initial.sql`   | Single migration, applied once                     |
| `server/drizzle/meta/_journal.json` | Migration journal (drizzle-kit v7, single entry)   |

V1 used `drizzle-orm` 0.45.1 with the `postgres` (postgres.js) driver.

---

### 8.2 Full Schema Definitions

Source: `jarvis-audioAssistant/server/src/db/schema.ts:1-57`

```ts
import { customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// pgvector custom type (requires CREATE EXTENSION IF NOT EXISTS vector)
const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    const str = String(value);
    return str.replace(/[[\]]/g, '').split(',').map(Number);
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  preferences: jsonb('preferences').default('[]'), // string[] stored as JSONB
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id), // nullable (anonymous sessions)
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }), // null = still active
  metadata: jsonb('metadata').default('{}'),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id)
    .notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'), // raw OpenAI tool call objects
  toolName: text('tool_name'), // populated for tool result messages
  evidence: jsonb('evidence'), // structured Evidence object
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const sessionSummaries = pgTable('session_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id)
    .notNull(),
  topics: text('topics').array().notNull(), // text[]
  entities: jsonb('entities').notNull(), // { repos, prs, issues, locations }
  keyFacts: jsonb('key_facts').notNull(), // unknown[]
  unresolved: jsonb('unresolved').notNull(), // unknown[]
  embedding: vector('embedding'), // nullable vector(1536) — pgvector
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

**DDL:** `jarvis-audioAssistant/server/drizzle/0000_initial.sql:1-44`

- `CREATE EXTENSION IF NOT EXISTS vector` is the first statement
- All FK constraints use `ON DELETE no action ON UPDATE no action`
- `sessions.user_id` is nullable (no `NOT NULL` on the FK column)

---

### 8.3 Import Patterns

Source: `jarvis-audioAssistant/server/src/db/schema.ts:1`

```ts
// Schema: named exports from drizzle-orm/pg-core
import { customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
```

Source: `jarvis-audioAssistant/server/src/services/persistence.ts:1-3`

```ts
// Consumers: import table refs and drizzle operators separately
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { messages, sessions } from '../db/schema.js';
```

Source: `jarvis-audioAssistant/server/src/services/summary.ts:1-2`

```ts
import { eq } from 'drizzle-orm';
import { messages, sessionSummaries } from '../db/schema.js';
```

The `Db` type alias (`jarvis-audioAssistant/server/src/db/index.ts:5`) is passed explicitly to service functions rather than accessed via a module-level singleton:

```ts
export type Db = ReturnType<typeof drizzle<typeof schema>>;
```

---

### 8.4 Connection Setup Pattern

Source: `jarvis-audioAssistant/server/src/db/index.ts:1-28`

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sql: ReturnType<typeof postgres> | null = null;

export function connectDb(databaseUrl: string): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db; // singleton — safe to call multiple times
  sql = postgres(databaseUrl);
  db = drizzle(sql, { schema });
  return db;
}

export async function disconnectDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) throw new Error('Database not connected — call connectDb() first');
  return db;
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;
```

Called at startup in `server/src/index.ts:26`: `connectDb(config.databaseUrl)` — no `await` needed, connection is lazy.

---

### 8.5 Migration Setup

Source: `jarvis-audioAssistant/server/drizzle.config.ts:1-11`

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/jarvis' },
});
```

Scripts inferred from package.json patterns:

- `drizzle-kit generate` → produces `.sql` files in `./drizzle`
- `drizzle-kit migrate` → applies pending migrations
- `drizzle-kit studio` → opens Drizzle Studio

Only one migration exists (`0000_initial`), applied all at once. No incremental migrations in V1.

---

### 8.6 Query Patterns Used

**Insert and return id** (`persistence.ts:7-11`):

```ts
const [row] = await db
  .insert(sessions)
  .values(userId ? { userId } : {})
  .returning({ id: sessions.id });
```

**Update by id** (`persistence.ts:14-16`):

```ts
await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.id, sessionId));
```

**Select with join, filter, order, limit** (`memory.ts:48-63`):

```ts
const rows = await db
  .select({ sessionId: sessionSummaries.sessionId, startedAt: sessions.startedAt, ... })
  .from(sessionSummaries)
  .innerJoin(sessions, eq(sessionSummaries.sessionId, sessions.id))
  .where(and(...conditions))
  .orderBy(desc(sessions.startedAt))
  .limit(limit);
```

**Raw SQL for vector search** (`memory.ts:199-207`):

```ts
const rows = await db.execute(
  sql`SELECT ss.session_id, ... FROM session_summaries ss ...
      ORDER BY ss.embedding <=> ${embStr}::vector LIMIT 3`,
);
```

**Select with limit(1) pattern** (`preferences.ts:37-41`):

```ts
const [user] = await context.db
  .select({ preferences: users.preferences })
  .from(users)
  .where(eq(users.id, context.userId))
  .limit(1);
```

---

### 8.7 Constraints

| Constraint                                                     | Source            | Reason                                                                                                |
| -------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| V2 plan drops `users` table for MVP                            | `plan.md:67`      | Multi-user auth is a non-goal                                                                         |
| V2 renames `messages` to `turns`                               | `plan.md:191`     | Clearer domain language; same shape                                                                   |
| V2 adds `tool_calls` and `evidence_records` as separate tables | `plan.md:192-194` | Evidence and tool tracking are first-class in V2; in V1 they were JSONB columns on messages           |
| No pgvector in MVP                                             | `plan.md:205`     | `postgres:16` and Railway default template lack the extension; vector is an additive future migration |
| V2 omits `users.email` / auth entirely                         | `plan.md:67`      | Demo scope; single-user                                                                               |
| V2 drizzle-orm version is 0.45.1                               | `plan.md:374`     | Pinned same as V1 — stable, known                                                                     |

---

### 8.8 Options for V2 Schema

#### Option A: Direct port of V1 schema (minus users, minus vector)

Tables: `sessions`, `turns` (renamed from `messages`), `session_summaries`.
`turns.evidence` stays as JSONB column on the turn row.

Pros: Minimal delta from V1. Fast to implement. Less join complexity.
Cons: Evidence is buried in JSONB — no way to query "all tool calls that fetched GitHub data" without JSON operators. Tool call args/results are also buried. Hard to audit or replay.

#### Option B: V2 plan schema (4 tables)

Tables: `sessions`, `turns`, `session_summaries`, `tool_calls`, `evidence_records`.

`turns` — raw conversation turns (role, content)
`tool_calls` — one row per tool invocation (tool_name, args, result, turn_id FK)
`evidence_records` — one row per fetched artifact (source_url, snippet, retrieved_at, source_type)

Pros: Evidence and tool calls are queryable. Matches M3 eval scripts ("check evidence attachment rate"). Cleaner separation of concerns. Auditable.
Cons: More tables. More insert operations per turn. Slightly more complex queries.

#### Option C: Option A with a `tool_calls` JSONB column on `turns`

Tables: `sessions`, `turns`, `session_summaries`. `turns.tool_calls` is JSONB (as in V1 `messages.toolCalls`).

Pros: One fewer table than Option B. Still captures tool call data.
Cons: Evidence is still unstructured. Can't query evidence independently. Eval scripts for evidence rate are harder.

---

### 8.9 Recommendation

**Option B: the 4-table schema from `plan.md`.**

Reasoning:

- M3 explicitly plans eval scripts that check evidence attachment rate (`eval-evidence.ts`). Those scripts need `evidence_records` as a queryable table, not JSONB scanning.
- The refusal contract (R7) is core to the product — evidence-backed answers require evidence to be a first-class entity, not a field on a message.
- Option A would require a migration to split out evidence at M3 anyway. Starting with Option B avoids that.
- The extra insert complexity is low: at most 2–3 extra inserts per tool call (1 tool_call row + 1-2 evidence rows), all async and non-blocking.

The V1 connection pattern (`connectDb` / `getDb` / `disconnectDb` singleton with `Db` type alias) is clean and worth replicating exactly. The only change: use `DATABASE_URL` env var from `config.ts` (already in V2 config schema) rather than dotenv directly in `drizzle.config.ts`.

---

### 8.10 Sources of Truth

| Area                                   | Canonical Source                                                       | Verification Method                            | Drift Risk                                      |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| V1 schema definitions                  | `jarvis-audioAssistant/server/src/db/schema.ts:1-57`                   | Read file directly                             | Low — V1 is not being actively changed          |
| V1 DDL (what actually ran)             | `jarvis-audioAssistant/server/drizzle/0000_initial.sql`                | Read file directly                             | Low                                             |
| V1 connection pattern                  | `jarvis-audioAssistant/server/src/db/index.ts:1-28`                    | Read file directly                             | Low                                             |
| V2 target schema (M2)                  | `plan.md:189-194`                                                      | Read plan section                              | Medium — plan is the contract, could be revised |
| `drizzle-orm` 0.45.1 API               | [drizzle-orm docs](https://orm.drizzle.team/docs/overview)             | `npm info drizzle-orm version` at install time | Low — 0.45.x is stable                          |
| `drizzle-kit` migration journal format | `jarvis-audioAssistant/server/drizzle/meta/_journal.json` (v7 dialect) | Match format when generating V2 migrations     | Low                                             |
| `postgres` (postgres.js) driver        | [postgres npm](https://www.npmjs.com/package/postgres)                 | `npm info postgres version` at install time    | Low                                             |

---

## 9. M3 External APIs — Open-Meteo + Octokit + GitHub URL Parsing

Date: 2026-03-26
Scope: Concrete, verified API shapes for the weather tool, GitHub tool, and URL parser planned for M3.

---

### 9.1 Current State

M1 and M2 are complete. M3 needs three integrations:

1. **Open-Meteo** — free weather API (geocoding + forecast), no API key required for non-commercial use
2. **@octokit/rest** — GitHub REST client with throttling plugin
3. **GitHub URL parser** — route-level regex to dispatch to the correct Octokit call

No source files for any of these exist yet (`src/server/tools/` directory does not exist).

---

### 9.2 Constraints

| Constraint                                                            | Source                         | Reason                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Open-Meteo is free, no key required                                   | open-meteo.com/en/features     | Non-commercial use policy; key only needed for commercial/dedicated servers                                     |
| File content `>1 MB` not available via `repos.getContent`             | GitHub REST docs               | API returns empty `content` field with `encoding: "none"` for 1–100 MB files; entirely unsupported above 100 MB |
| `@octokit/rest` 22.0.1 — major version jump from v18/v19              | npm                            | v22 uses ESM-first, `octokit.rest.*` namespace (not `octokit.*` directly)                                       |
| `@octokit/plugin-throttling` 11.0.3 requires `@octokit/core` peer dep | npm                            | Plugin works with `Octokit.plugin()` factory pattern, not standalone                                            |
| TypeScript only, named exports, pure functions                        | `.claude/rules/conventions.md` | Project rules                                                                                                   |

---

### 9.3 Open-Meteo — Geocoding API

**Base URL:** `https://geocoding-api.open-meteo.com/v1/search`

**Query parameters:**

| Parameter     | Type    | Required | Default | Notes                                       |
| ------------- | ------- | -------- | ------- | ------------------------------------------- |
| `name`        | string  | yes      | —       | City name. 2+ chars for exact, 3+ for fuzzy |
| `count`       | integer | no       | 10      | Max 100 results                             |
| `language`    | string  | no       | `en`    | ISO language code                           |
| `format`      | string  | no       | `json`  | `json` or `protobuf`                        |
| `countryCode` | string  | no       | —       | ISO-3166-1 alpha2 filter                    |

**Response shape (TypeScript):**

```ts
interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  feature_code: string; // e.g. "PPLC" = capital city
  country_code: string; // ISO alpha2
  country: string;
  country_id: number;
  timezone: string; // IANA tz string e.g. "Europe/London"
  population: number;
  postcodes?: string[];
  admin1?: string;
  admin1_id?: number;
  admin2?: string;
  admin2_id?: number;
  admin3?: string;
  admin3_id?: number;
  admin4?: string;
  admin4_id?: number;
}

interface GeocodingResponse {
  results?: GeocodingResult[]; // absent (not empty array) when no match found
  generationtime_ms?: number;
}
```

**Example call:**

```ts
async function geocode(cityName: string): Promise<GeocodingResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', cityName);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data: GeocodingResponse = await res.json();
  return data.results?.[0] ?? null;
}
```

**Key fact:** `results` is absent (not `[]`) when no city matches — always use `?.` access.

Source: [Geocoding API | open-meteo.com](https://open-meteo.com/en/docs/geocoding-api)

---

### 9.4 Open-Meteo — Forecast API

**Base URL:** `https://api.open-meteo.com/v1/forecast`

**Required parameters:** `latitude`, `longitude`

**Key optional parameters for current weather:**

| Parameter          | Value for M3                                                      | Notes                                                    |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `current`          | `temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` | Comma-separated variable names                           |
| `temperature_unit` | `celsius` (default) or `fahrenheit`                               |                                                          |
| `wind_speed_unit`  | `kmh` (default), `mph`, `ms`, `kn`                                |                                                          |
| `timezone`         | `auto`                                                            | Infer from coordinates — required for correct local time |

**Response shape (TypeScript):**

```ts
interface ForecastCurrentUnits {
  time: string;
  temperature_2m: string; // e.g. "°C"
  relative_humidity_2m: string; // e.g. "%"
  weather_code: string; // e.g. "wmo code"
  wind_speed_10m: string; // e.g. "km/h"
}

interface ForecastCurrent {
  time: string; // ISO8601 local time, e.g. "2025-07-01T14:00"
  temperature_2m: number;
  relative_humidity_2m: number; // integer percent
  weather_code: number; // WMO weather code (see table below)
  wind_speed_10m: number;
}

interface ForecastResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  current_units: ForecastCurrentUnits;
  current: ForecastCurrent;
}
```

**WMO weather code mapping (key codes for voice output):**

```ts
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Slight showers',
  81: 'Moderate showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};
```

**Example call:**

```ts
async function fetchForecast(lat: number, lon: number): Promise<ForecastResponse> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
  );
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Forecast failed: ${res.status}`);
  return res.json() as Promise<ForecastResponse>;
}
```

**Rate limits:**

- Free tier has no published numeric rate limit for non-commercial use.
- A weighted-call system is in place (more days + variables = higher weight), but limits are "set at a reasonably high level" per maintainer guidance (GitHub issue #485).
- Recommendation: cache geocoding results aggressively (city→lat/lon mappings change rarely). Cache forecast results with a 10-minute TTL — the API updates models every 1–6 hours depending on model, but current-conditions responses are stable within minutes.

Source: [Forecast API docs | open-meteo.com](https://open-meteo.com/en/docs), [Rate limit discussion](https://github.com/open-meteo/open-meteo/issues/485)

---

### 9.5 @octokit/rest — Setup and Throttling

**Versions (verified 2026-03-26):**

- `@octokit/rest`: **22.0.1**
- `@octokit/plugin-throttling`: **11.0.3**
- `@octokit/plugin-paginate-rest`: **14.0.0** (plan.md:387)

**Installation:**

```bash
npm install @octokit/rest@22.0.1 @octokit/plugin-throttling@11.0.3 @octokit/plugin-paginate-rest@14.0.0
```

**Setup with throttling:**

```ts
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

// Create a throttled Octokit subclass once (module-level singleton factory)
const ThrottledOctokit = Octokit.plugin(throttling);

export function createOctokit(token: string): InstanceType<typeof ThrottledOctokit> {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(`Rate limit hit for ${options.method} ${options.url}`);
        if (retryCount < 1) {
          octokit.log.info(`Retrying after ${retryAfter}s`);
          return true; // retry once
        }
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(`Secondary rate limit for ${options.method} ${options.url}`);
        // do not retry secondary rate limits — return undefined (falsy)
      },
    },
  });
}
```

**Key fact:** Both `onRateLimit` and `onSecondaryRateLimit` handlers are required — the plugin will warn at construction if either is absent. Returning `true` from `onRateLimit` triggers automatic retry after `retryAfter` seconds.

**Key fact:** The `throttle` block is typed in `@octokit/plugin-throttling`'s TypeScript types — no need to cast.

**PAT rate limits:** 5,000 requests/hour for authenticated requests. Unauthenticated = 60/hour. Always pass the token.

Source: [plugin-throttling.js README](https://github.com/octokit/plugin-throttling.js/blob/main/README.md), [@octokit/plugin-throttling npm](https://www.npmjs.com/package/@octokit/plugin-throttling)

---

### 9.6 Octokit API Calls and Response Shapes

All methods live under `octokit.rest.*`. The response always has a `data` field containing the payload. HTTP status is in `status`.

#### Get repo metadata

```ts
const { data } = await octokit.rest.repos.get({ owner, repo });
```

**Response shape (`data`):**

```ts
interface RepoMetadata {
  id: number;
  node_id: string;
  name: string; // e.g. "my-repo"
  full_name: string; // e.g. "owner/my-repo"
  private: boolean;
  owner: { login: string; id: number; avatar_url: string; html_url: string; type: string };
  html_url: string;
  description: string | null;
  fork: boolean;
  homepage: string | null;
  language: string | null;
  default_branch: string;
  visibility: string; // "public" | "private" | "internal"
  topics: string[];
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  has_issues: boolean;
  has_wiki: boolean;
  archived: boolean;
  created_at: string; // ISO8601
  updated_at: string;
  pushed_at: string | null;
  size: number; // kilobytes
}
```

Source: [GitHub REST docs — Get a repository](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28)

#### Get repo README

```ts
const { data } = await octokit.rest.repos.getReadme({ owner, repo });
// data.content is base64-encoded text
const readme = Buffer.from(data.content, 'base64').toString('utf-8');
```

**Response shape (`data`):**

```ts
interface ContentFile {
  type: 'file';
  encoding: 'base64';
  content: string; // base64-encoded file content
  sha: string;
  size: number; // bytes
  name: string;
  path: string;
  html_url: string | null;
  download_url: string | null;
  url: string;
  git_url: string | null;
  _links: { git: string; html: string; self: string };
}
```

**Size limit:** README files rarely exceed 1 MB, but apply the same guard as `getContent` below.

#### Get file content

```ts
const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
// data is ContentFile when path is a file, ContentFile[] when path is a directory
```

**Response shape for a file:** Same `ContentFile` interface as README above.

**Content size handling:**

```ts
// MUST guard before decoding — large files return empty content
function decodeFileContent(file: ContentFile, maxBytes = 1_000_000): string | null {
  if (file.size > maxBytes) return null; // >1 MB: skip
  if (file.encoding !== 'base64') return null; // "none" encoding = file too large
  return Buffer.from(file.content, 'base64').toString('utf-8');
}
```

| File size | `content` field | `encoding` field | Action                              |
| --------- | --------------- | ---------------- | ----------------------------------- |
| ≤ 1 MB    | base64 string   | `"base64"`       | Decode normally                     |
| 1–100 MB  | empty string    | `"none"`         | Use `download_url` or Git Data API  |
| > 100 MB  | —               | —                | Endpoint returns 403; not supported |

Source: [GitHub REST docs — Repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28)

#### Get an issue + comments

```ts
const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number });
const { data: comments } = await octokit.rest.issues.listComments({
  owner,
  repo,
  issue_number,
  per_page: 100,
});
```

**Issue response shape (`data`):**

```ts
interface Issue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason: 'completed' | 'reopened' | 'not_planned' | 'duplicate' | null;
  user: { login: string; id: number; html_url: string } | null;
  labels: Array<{ id: number; name: string; color: string; description: string | null }>;
  assignees: Array<{ login: string; id: number }>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: {
    // PRESENT only if this issue is actually a PR
    diff_url: string;
    html_url: string;
    patch_url: string;
    url: string;
  };
}
```

**IssueComment response shape (each element of `data` array):**

```ts
interface IssueComment {
  id: number;
  body: string | null;
  user: { login: string; id: number; html_url: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}
```

**Key fact:** `issues.get` returns PRs too if you pass a PR number — the `pull_request` field distinguishes them. For a pure issue URL, `pull_request` will be absent.

Source: [GitHub REST docs — Get an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28)

#### Get a PR + review comments

```ts
const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
  owner,
  repo,
  pull_number,
  per_page: 100,
});
// PR-level discussion comments (not inline) use issues.listComments with the same number
const { data: issueComments } = await octokit.rest.issues.listComments({
  owner,
  repo,
  issue_number: pull_number, // PR numbers and issue numbers share the same namespace
  per_page: 100,
});
```

**PR response shape (`data`):**

```ts
interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: { login: string; id: number; html_url: string } | null;
  head: { label: string; ref: string; sha: string; repo: object | null };
  base: { label: string; ref: string; sha: string; repo: object };
  merged: boolean;
  merged_at: string | null;
  html_url: string;
  diff_url: string;
  patch_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  draft: boolean;
  comments: number; // count of issue-style comments
  review_comments: number; // count of inline review comments
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}
```

**Review comment response shape (each element of `data` array):**

```ts
interface ReviewComment {
  id: number;
  body: string;
  path: string; // file path the comment is on
  position: number | null; // line position in the diff
  diff_hunk: string; // surrounding diff context
  user: { login: string; id: number; html_url: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  in_reply_to_id?: number; // present if this is a reply
  pull_request_review_id: number | null;
}
```

Source: [GitHub REST docs — Pulls](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28), [GitHub REST docs — Pull request review comments](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28)

---

### 9.7 GitHub URL Parser

**URL patterns:**

| Type          | Pattern                                                               | Example                                                               |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Repo          | `https://github.com/{owner}/{repo}`                                   | `https://github.com/octokit/rest.js`                                  |
| File          | `https://github.com/{owner}/{repo}/blob/{ref}/{path}`                 | `https://github.com/octokit/rest.js/blob/main/src/index.ts`           |
| Issue         | `https://github.com/{owner}/{repo}/issues/{number}`                   | `https://github.com/octokit/rest.js/issues/42`                        |
| PR            | `https://github.com/{owner}/{repo}/pull/{number}`                     | `https://github.com/octokit/rest.js/pull/7`                           |
| Issue comment | `https://github.com/{owner}/{repo}/issues/{number}#issuecomment-{id}` | `https://github.com/octokit/rest.js/issues/42#issuecomment-123456789` |
| PR comment    | `https://github.com/{owner}/{repo}/pull/{number}#issuecomment-{id}`   | `https://github.com/octokit/rest.js/pull/7#issuecomment-987654321`    |

**Note:** PR discussion comments use `#issuecomment-{id}` (same as issues). Inline review comments use `#discussion_r{id}`. For MVP, parsing the URL to `pull_number` is sufficient — fetch the PR and both comment types.

**TypeScript parser:**

```ts
export type GitHubUrlType =
  | { kind: 'repo'; owner: string; repo: string }
  | { kind: 'file'; owner: string; repo: string; ref: string; path: string }
  | { kind: 'issue'; owner: string; repo: string; number: number }
  | { kind: 'pr'; owner: string; repo: string; number: number }
  | { kind: 'unknown' };

export function parseGitHubUrl(rawUrl: string): GitHubUrlType {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'unknown' };
  }

  if (url.hostname !== 'github.com') return { kind: 'unknown' };

  // Strip leading slash and split
  const segments = url.pathname.replace(/^\//, '').split('/');
  const [owner, repo, type, ...rest] = segments;

  if (!owner || !repo) return { kind: 'unknown' };

  if (!type) {
    return { kind: 'repo', owner, repo };
  }

  if (type === 'blob' && rest.length >= 2) {
    const ref = rest[0];
    const path = rest.slice(1).join('/');
    return { kind: 'file', owner, repo, ref, path };
  }

  if (type === 'issues' && rest[0] && /^\d+$/.test(rest[0])) {
    return { kind: 'issue', owner, repo, number: parseInt(rest[0], 10) };
  }

  if (type === 'pull' && rest[0] && /^\d+$/.test(rest[0])) {
    return { kind: 'pr', owner, repo, number: parseInt(rest[0], 10) };
  }

  return { kind: 'unknown' };
}
```

**Test cases for `parseGitHubUrl` (parameterized Vitest table):**

```ts
describe('parseGitHubUrl', () => {
  test.each([
    [
      'repo',
      'https://github.com/octokit/rest.js',
      { kind: 'repo', owner: 'octokit', repo: 'rest.js' },
    ],
    [
      'file',
      'https://github.com/octokit/rest.js/blob/main/src/index.ts',
      { kind: 'file', owner: 'octokit', repo: 'rest.js', ref: 'main', path: 'src/index.ts' },
    ],
    [
      'issue',
      'https://github.com/octokit/rest.js/issues/42',
      { kind: 'issue', owner: 'octokit', repo: 'rest.js', number: 42 },
    ],
    [
      'pr',
      'https://github.com/octokit/rest.js/pull/7',
      { kind: 'pr', owner: 'octokit', repo: 'rest.js', number: 7 },
    ],
    [
      'comment',
      'https://github.com/octokit/rest.js/issues/42#issuecomment-123456789',
      { kind: 'issue', owner: 'octokit', repo: 'rest.js', number: 42 },
    ],
    [
      'pr-cmt',
      'https://github.com/octokit/rest.js/pull/7#issuecomment-987654321',
      { kind: 'pr', owner: 'octokit', repo: 'rest.js', number: 7 },
    ],
    ['invalid', 'https://example.com/foo', { kind: 'unknown' }],
    ['bad-url', 'not a url', { kind: 'unknown' }],
  ])('%s: parseGitHubUrl(%s)', (_label, url, expected) => {
    expect(parseGitHubUrl(url)).toEqual(expected);
  });
});
```

**Key fact:** The URL hash (`#issuecomment-123456789`) is parsed by `new URL()` into `url.hash` — it does NOT appear in `url.pathname`. The parser above correctly ignores it, which means issue/PR comment URLs resolve to the parent issue or PR (the right behavior — fetch the issue/PR and all its comments).

---

### 9.8 Options (M3 Tool Architecture)

#### Option A: Inline fetch in tool `execute` functions

All fetch logic lives directly in each tool's `execute` callback. No abstraction layer.

Pros: Simple, no indirection.
Cons: Hard to unit-test (can't inject clients). Tool functions become large. Octokit instance creation mixed with business logic.

#### Option B: Pure fetcher modules + thin tool wrappers

`src/server/tools/github/fetchers.ts` — pure async functions accepting an Octokit instance.
`src/server/tools/github/tool.ts` — calls fetchers, wraps result in Evidence, returns string.
`src/server/tools/weather/fetchers.ts` — pure async functions for geocode + forecast.
`src/server/tools/weather/tool.ts` — composes fetchers, evidence, return string.

Pros: Fetchers are pure functions (easy to unit test with mocked/injected clients). Follows project conventions (pure function composition, modular code). Evidence creation is co-located with fetching.
Cons: One more layer of indirection.

#### Option C: Single `github.ts` and `weather.ts` modules (no sub-folders)

Single file per tool, all logic inside. Still uses injected Octokit.

Pros: Less file navigation for small codebases.
Cons: Files grow large as edge cases accumulate (file size guards, pagination, evidence creation). Harder to test individual fetch operations in isolation.

---

### 9.9 Recommendation

**Option B: Pure fetcher modules + thin tool wrappers.**

Reasoning:

- The URL parser is already a testable pure function — the fetcher pattern extends this naturally.
- M3 eval scripts (`eval-evidence.ts`) need to verify evidence attachment rate. That's easier when fetchers return structured `{ data, evidence }` objects rather than side-effecting inside tools.
- File size guarding and base64 decoding for `getContent` are non-trivial — isolating them in a `decodedContent` helper makes them independently testable.
- Aligns with `.claude/rules/immutable.md` (pure function composition) and `.claude/rules/conventions.md` (small focused modules).

**Proposed file structure for M3:**

```
src/server/tools/
├── github/
│   ├── client.ts          # createOctokit() factory — ThrottledOctokit setup
│   ├── parser.ts          # parseGitHubUrl() pure function
│   ├── fetchers.ts        # fetchRepo, fetchFile, fetchIssue, fetchPr — accept Octokit instance
│   └── tool.ts            # RealtimeAgent tool() definition — composes parser + fetchers + evidence
├── weather/
│   ├── fetchers.ts        # geocode(), fetchForecast() — pure fetch functions
│   └── tool.ts            # RealtimeAgent tool() definition — composes fetchers + evidence
└── capabilities/
    └── tool.ts            # Static capabilities description tool
```

---

### 9.10 Sources of Truth

| Area                                                      | Canonical Source                                                                                          | Verification Method                                                                                   | Drift Risk                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Open-Meteo geocoding URL + params                         | [Geocoding API docs](https://open-meteo.com/en/docs/geocoding-api)                                        | Hit `https://geocoding-api.open-meteo.com/v1/search?name=London&count=1` and check `results[0]` shape | Low — free, stable, no versioned endpoint            |
| Open-Meteo forecast URL + params                          | [Forecast API docs](https://open-meteo.com/en/docs)                                                       | Hit `https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&current=temperature_2m`      | Low — stable                                         |
| Open-Meteo WMO code table                                 | [WMO weather codes section of forecast docs](https://open-meteo.com/en/docs)                              | Cross-reference `weather_code` values from live response                                              | Low                                                  |
| `@octokit/rest` version and method signatures             | [npm: @octokit/rest](https://www.npmjs.com/package/@octokit/rest)                                         | `npm info @octokit/rest version` at install time; confirmed 22.0.1                                    | Medium — major versions bump when GitHub API changes |
| `@octokit/plugin-throttling` version and handler contract | [plugin-throttling README on GitHub](https://github.com/octokit/plugin-throttling.js/blob/main/README.md) | `npm info @octokit/plugin-throttling version`; confirmed 11.0.3                                       | Medium — major bumps with `@octokit/core` peer dep   |
| GitHub REST content size limits                           | [GitHub REST docs — contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28)       | Check `encoding` field in response for files 1–100 MB                                                 | Low — documented hard limits                         |
| GitHub URL path structure                                 | [GitHub.com URL conventions](https://github.com) — derived from observed URLs                             | Manual inspection of known repo/issue/PR URLs                                                         | Low — GitHub URL structure is extremely stable       |
| `octokit.rest.issues.get` — `pull_request` field presence | [GitHub REST docs — issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28)          | Fetch a known PR via `issues.get` and verify `pull_request` field is present                          | Low — documented behavior                            |
