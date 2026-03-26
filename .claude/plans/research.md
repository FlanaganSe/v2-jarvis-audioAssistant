# API Research: OpenAI Realtime, @openai/agents-realtime, Fastify 5

Date: 2026-03-26
Scope: Concrete API shapes, code patterns, and version facts for M1 implementation

---

## 1. Current State

The project is empty scaffolding. No `package.json`, no `src/`. The plan (`plan.md`) references the architecture but no implementation exists. This research document replaces and supersedes prior loose research notes — it is written against GA APIs as of 2026-03-26.

---

## 2. Constraints

| Constraint | Source | Reason |
|-----------|--------|--------|
| Must use GA Realtime API, not beta | `plan.md:70` | Beta deprecated May 7 2026 |
| Model must be `gpt-realtime-1.5` | `plan.md:71` | Best GA voice model, 20% cheaper than predecessor |
| TypeScript only, Node 22+ | `.claude/rules/stack.md` | Stack rule |
| `@openai/agents-realtime` 0.8.1 exact | `plan.md:344-348` | Pre-1.0 SDK, pin to avoid breaking changes |
| Fastify 5.x | `plan.md:346` | Server framework |

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
const { ephemeralKey } = await fetch('/api/session').then(r => r.json());

// 2. Create peer connection and audio output
const pc = new RTCPeerConnection();
const audioEl = document.createElement('audio');
audioEl.autoplay = true;
pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

// 3. Add microphone track
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

// 4. Create data channel for events (must be named 'oai-events')
const dc = pc.createDataChannel('oai-events');

// 5. SDP offer → POST to OpenAI → get answer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ephemeralKey}`,
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
const ws = new WebSocket(
  `wss://api.openai.com/v1/realtime?call_id=${callId}`,
  {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',          // may be required
    },
  }
);

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
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, OpenAIRealtimeWebSocket } from '@openai/agents-realtime';
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
session.on('agent_tool_start', ({ tool }) => { /* tool executing */ });
session.on('agent_tool_end', ({ tool, result }) => { /* tool done */ });
session.on('history_updated', (history) => { /* turns updated */ });
session.on('transport_event', (event) => { /* raw realtime event */ });
session.on('error', (err) => { /* handle error */ });
session.on('audio', (audioData) => { /* audio chunks */ });
session.on('audio_interrupted', () => { /* user interrupted */ });
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
  | 'gpt-realtime-1.5'                          // DEFAULT — best GA voice model
  | 'gpt-realtime-2025-08-28'
  | 'gpt-4o-realtime-preview'                   // DEPRECATED (Sep 2025, removed ~Mar 2026)
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
  origin: process.env.NODE_ENV === 'production'
    ? 'https://your-domain.railway.app'
    : true,
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
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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

| Area | Canonical Source | Verification Method | Drift Risk |
|------|-----------------|---------------------|------------|
| `POST /v1/realtime/client_secrets` endpoint and response shape | [Create client secret reference](https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret) | Hit the endpoint, verify `value` field starts with `ek_` | Low — GA, stable |
| SDP exchange endpoint (`/v1/realtime/calls`) | [Realtime API with WebRTC guide](https://platform.openai.com/docs/guides/realtime-webrtc) | Check `Location` header contains `rtc_` prefix call_id | Low — GA |
| Sideband WebSocket URL (`wss://...?call_id=`) | [Server-side controls guide](https://platform.openai.com/docs/guides/realtime-server-controls) | Attempt connection with real API key after SDP exchange | Medium — feature is GA but sideband auth token (ephemeral vs real) unconfirmed in our stack |
| `@openai/agents-realtime` exports and types | [GitHub: openai/openai-agents-js](https://github.com/openai/openai-agents-js) `packages/agents-realtime/src/index.ts` | Read the source at pin (0.8.1 tag) | High — pre-1.0, actively developed |
| `OpenAIRealtimeModels` type union | `openaiRealtimeBase.ts` in SDK source | Check `DEFAULT_OPENAI_REALTIME_MODEL` export at pin | High — new models added frequently |
| `gpt-realtime-1.5` as default model | [Introducing gpt-realtime](https://openai.com/index/introducing-gpt-realtime/), SDK source | Verify `DEFAULT_OPENAI_REALTIME_MODEL === 'gpt-realtime-1.5'` in pinned source | Medium — model aliases may shift |
| Fastify 5 plugin versions | [@fastify/cors npm](https://www.npmjs.com/package/@fastify/cors), [@fastify/static npm](https://www.npmjs.com/package/@fastify/static) | `npm info @fastify/cors peerDependencies` at install time | Low — major versions change slowly |
| `openai` npm package version | [openai npm](https://www.npmjs.com/package/openai) | `npm info openai version` | Low — used as direct client, not primary SDK |
| Zod v4 requirement | `@openai/agents-core` peer deps | `npm info @openai/agents-core peerDependencies` | Medium — Zod v4 is recent; tooling ecosystem still catching up |

---

## 7. Open Spikes (not researchable without running code)

These cannot be resolved by documentation and must be validated in M1:

1. **Sideband auth token** — Does the sideband WebSocket accept the real (non-ephemeral) API key? The docs indicate yes, but this must be confirmed empirically. If it only accepts the ephemeral key (which expires in 1 minute), the architecture changes significantly.

2. **`call_id` with SDK browser transport** — If Option B is ever tried, confirming whether `callId` is accessible from `OpenAIRealtimeWebRTC` as a post-connect property (the fetch interceptor community workaround is fragile). Moot if Option C is used.

3. **Tool execution latency on Railway** — Does the round-trip sideband tool call (Railway → OpenAI → Railway → tool → OpenAI → browser) add perceptible latency vs. bare metal?

4. **`push_to_talk` vs `server_vad` turn detection** — Setting `turn_detection: null` on session config disables VAD and requires manual `input_audio_buffer.commit`. Must be confirmed to work correctly via sideband.
