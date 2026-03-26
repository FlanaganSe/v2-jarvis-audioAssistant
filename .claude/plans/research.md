# FINAL_RESEARCH_2

Date: 2026-03-26
Purpose: canonical pre-planning research baseline for `v2-jarvis-audio`

## What this document is

This is the cleaned research baseline that planning should use.

It consolidates:

- `docs/requirements.md`
- `docs/research/chat_research.md`
- `docs/research/COMBINED_RESEARCH.md`
- `docs/research/COMBINED_RESEARCH_2.md`

It removes duplication, downgrades weak claims, and separates:

- stable planning facts
- spike-gated risks
- open product decisions
- volatile facts that must be rechecked at implementation time

## Source quality notes

- The repo currently contains three research documents under `docs/research/`.
- `docs/research/COMBINED_RESEARCH.md` contains a duplicated full document and should not be treated as the canonical source.
- `docs/research/COMBINED_RESEARCH.md` also references source files that are not present in this repo snapshot, so only claims preserved in the available documents or verified externally were kept.
- When sources conflicted, this document favored official vendor docs, current package metadata, and direct repo requirements over community reports or copied snapshots.

## Bottom line

This project is feasible as a focused web-first demo.

The strongest planning baseline is:

- browser voice over OpenAI Realtime `WebRTC`
- server-owned tools, trust policy, persistence, and observability
- Fastify backend on Railway
- PostgreSQL as the durable system of record
- raw turns plus summaries for memory
- SQL-first retrieval now, vector-ready later
- read-only GitHub ingestion scoped to explicit URLs and artifacts
- one factual external API capability, with weather as the cleanest default
- evidence-backed factual answers or explicit refusal

The MVP should not be shaped around:

- passive wake word or background listening
- GitHub write actions such as issue creation or PR creation
- Swift-first or native-first architecture

## Locked product requirements

From `docs/requirements.md`, the hard requirements are:

- low-latency, natural voice conversation
- cross-session recall
- answer questions about GitHub repos, issues, PRs, and comments from GitHub URLs
- audible indication that Jarvis is working
- interruption support
- clear communication of capabilities and limitations
- refusal instead of fabrication when facts are unsupported
- at least one API-backed factual capability

Deferred unless product scope changes:

- Swift client
- passive background wake word
- multi-user auth and isolation
- GitHub issue creation, PR creation, or repo-fixing workflows

## Canonical MVP architecture

### Recommended default

1. Browser captures microphone input and connects to OpenAI Realtime over `WebRTC`.
2. Browser provides a thin UI: push-to-talk, status, transcript, and citations.
3. Backend initializes the session and owns all sensitive logic.
4. Backend opens a sideband control connection to the same Realtime call for tool execution, policy updates, and tracing.
5. Postgres stores sessions, turns, summaries, tool calls, and evidence.
6. GitHub and external API fetches run only on the server.

### Why this is the right default

- It matches OpenAI's current browser guidance: `WebRTC` for client-side realtime apps.
- It preserves low-latency audio without moving tool logic into the browser.
- It lets the product keep memory and trust boundaries in application-owned storage instead of transient Realtime state.
- It leaves room to pivot later to a relay or LiveKit without invalidating the persistence and evidence layers.

### Default operating posture

- Web-first, not native-first
- Push-to-talk first, not open-mic first
- Read-only GitHub first
- Single-user demo assumptions unless auth is explicitly promoted
- Smallest useful voice loop before adding scope

## Trust, evidence, and refusal contract

The most durable cross-document conclusion is that "never hallucinate" must be implemented as a system contract, not as a prompt aspiration.

Rules:

- factual answers require evidence
- unsupported claims require refusal
- GitHub content, user content, and model tool arguments are untrusted inputs
- tool execution and argument validation stay server-side
- evidence must be durable enough to audit later

Canonical evidence object v1:

```ts
export interface Evidence {
  sourceId: string;
  sourceType:
    | "github_file"
    | "github_issue"
    | "github_pr"
    | "github_comment"
    | "api_response"
    | "conversation_turn"
    | "session_summary";
  sourceUrl?: string;
  snippet?: string;
  retrievedAt: string;
}
```

Behavioral implications:

- Voice should use short natural attributions, not raw URLs.
- The UI should show link, snippet, and retrieval timestamp.
- If evidence is missing, stale, or partial, Jarvis should say some version of "I don't know" or "I can't verify that."

## GitHub integration contract

### MVP scope

Support these entity types first:

- repository root
- file or blob URL
- issue
- pull request
- issue comment
- pull request review comment

### Fetching rules

- Do not clone or index an entire repo by default.
- Parse the user-provided URL and fetch only the required artifact set.
- For repo-root questions, start with repository metadata plus a small high-signal artifact set such as `README`, `package.json`, and key config files, then expand on demand.
- Preserve `html_url` at fetch time for evidence.
- Treat repository text as untrusted content, never as instruction text.

### Durable facts worth planning around

- The Contents API has an upper limit of 1,000 files for a directory.
- For file size:
  - `<= 1 MB`: normal Contents API behavior
  - `1-100 MB`: use `raw` or `object` media types; `object` may return empty `content`
  - `> 100 MB`: Contents API is not supported
- The recursive Trees API caps at 100,000 entries or 7 MB and may return `truncated=true`.
- PR context requires both `pulls/{n}/comments` and `issues/{n}/comments`.
- Octokit pagination and throttling should be present from day one.

### Auth recommendation

Fastest MVP path:

- fine-grained PAT behind a `getGitHubToken()` abstraction

Longer-term path:

- GitHub App when private repo support, multi-user installs, or write actions become core

Why:

- GitHub docs still prefer GitHub Apps over OAuth apps because they use fine-grained permissions, give more repo-level control, and use short-lived tokens.
- For the current demo, PAT-behind-abstraction is the lowest-friction read-only path.

## Memory and retrieval contract

### What to store

- `sessions`
- `turns`
- `session_summaries`
- `tool_calls`
- `evidence_records`

### Baseline memory model

- store immutable raw turns for exact recall and auditability
- generate summaries asynchronously
- recall across sessions from durable storage, not from live Realtime context

### Retrieval now

Start with:

- recency and date queries
- keyword search
- PostgreSQL full-text search
- optional trigram search if fuzzy matching is needed

### Retrieval later

Keep the schema vector-ready, but do not make vector search a prerequisite.

Add embeddings only if evals show lexical retrieval is not good enough for:

- semantically phrased recall across many sessions
- broader semantic GitHub lookup over much larger artifact sets

### Planning conclusion

Provisioning a pgvector-capable Postgres early is reasonable.

Building vector retrieval into the first plan is not.

## Client orchestration notes that matter

These are small implementation facts that are worth carrying into planning because they affect the first voice loop.

- The minimal UI state machine is `idle -> listening -> processing -> speaking`.
- Browser audio playback requires a user gesture before audio can reliably start, which fits the push-to-talk-first posture.
- iOS in-app browsers are a bad target for early testing because microphone and playback behavior are less reliable than Safari proper.

## OpenAI realtime constraints that matter

These are high-value constraints because they shape architecture and planning directly.

- `WebRTC` is the recommended browser transport for Realtime.
- Sideband server controls are officially supported for `WebRTC`. However, sideband only works when the **server** initiates the call via `POST /v1/realtime/calls`. It does not work with client-secret-initiated sessions (community reports confirm 404 errors). This is a spike-gate precondition.
- Realtime sessions have a maximum duration of 60 minutes.
- Current Realtime planning baseline is `gpt-realtime-1.5` (updated 2026-03-26; was `gpt-realtime`). See "Realtime model family update" addendum for full findings.
- The current Realtime model family uses a 32k context window with 4,096 max output tokens. Effective input budget is ~16K tokens after system prompt and tool definitions. Plan to compress proactively around ~28K total.
- Sessions cannot be reconnected. A dropped or expired session starts completely fresh — all Realtime-side state is lost. This makes session rollover a design requirement, not an optimization.
- Interruption semantics differ by transport:
  - `WebRTC`: server manages interruption and truncation behavior
  - `WebSocket`: client must manage playback stop plus `conversation.item.truncate`
- Transcript truncation is approximate and should not be treated as perfectly aligned ground truth. In practice, "what the user heard" is the authoritative outcome.
- Realtime truncation drops older conversation items from the front when enabled.
- Realtime structured outputs are not supported on `gpt-realtime`.
- The voice cannot be changed after audio has already been emitted in a session.
- Realtime client secrets are short-lived and support configurable TTL; exact TTL behavior should be treated as implementation-time validation, not a planning constant.
- The GA model handles pending tool calls gracefully — if asked about results mid-wait, it responds with something like "I'm still waiting on that" instead of hallucinating. This is a **reactive** behavior triggered by user inquiry, not a proactive unprompted announcement at tool-call start. It does not guarantee an audible cue when a tool fires. A client-side working indicator must be planned. The spike must test explicitly whether any audio fires unprompted at tool-call start; if yes, that satisfies the requirement. See "Placeholder audio addendum" for full findings.
- For push-to-talk: disable VAD, manually call `input_audio_buffer.commit` + `response.create` on button release. This is the canonical PTT flow.
- Assistants API is deprecated and scheduled for removal on 2026-08-26, so non-realtime text flows should be built on Responses API and Conversations API.

Planning implications:

- durable memory must live outside the live Realtime session
- prompts and tool definitions should stay lean
- tool arguments must be validated server-side
- session rollover must be designed explicitly

Suggested rollover posture:

- start rollover before expiry rather than at expiry
- preserve a session summary plus a small set of recent verbatim turns
- preserve active artifact context such as the current GitHub URL and recent evidence objects

## Railway constraints that matter

These are the Railway facts that materially affect the plan.

- Public networking supports websockets over HTTP/1.1.
- Railway's public proxy keep-alive timeout is 60 seconds.
- HTTP request max duration is 15 minutes.
- Railway supports 10,000 concurrent public connections.
- Railway does not support sticky sessions.
- Railway's Fastify guide says Fastify should listen on host `::`.
- Railway's generic troubleshooting guide says apps should bind to `0.0.0.0` on the provided `PORT`.
- **Hobby plan ($5/mo) is the minimum viable plan for a persistent voice app.** The free plan forces serverless mode on all services; it cannot be disabled on that tier. See Railway sleeping addendum below.
- Serverless mode must be explicitly disabled on the deployed service — cold starts break voice latency.

Planning stance:

- Treat `::` versus `0.0.0.0` as a framework-specific deployment check, not a design blocker.
- For Fastify specifically, prefer the Fastify guide first and verify during deployment.
- Start with a single replica.
- Assume long-lived sockets need active keepalive behavior.
- Avoid any architecture that depends on sticky sessions.

## Railway sleeping addendum (verified 2026-03-26)

**The original research claim** (this doc line 277) stated:
> "Free tier sleeps between requests — breaks voice. Hobby plan ($5/mo) is the minimum for a persistent voice app."

**A counter-claim was raised** suggesting sleeping is an opt-in "Serverless" feature, not automatic free-tier behavior, and that the free plan merely provides $1/month credit until exhausted, then stops services (does not sleep them).

**Verdict: the original claim is correct in outcome. The counter-claim is partially correct about the mechanism, but wrong about the practical consequence.**

### What the evidence shows

Railway has two separate sleep-related behaviors:

1. **Serverless (App Sleeping)** — a per-service toggle at Service > Settings > Deploy > Serverless. When enabled, a service sleeps after it sends no outbound traffic for 10 minutes. The service wakes on the next inbound request with a cold-start delay.

2. **Free plan mandatory serverless** — the key finding from two independent Railway support sources:
   - Railway moderator (station.railway.com/questions/sleep-mode-9099392f): "On free plan, all your services have the 'serverless' option enabled by default." The Hobby plan gives users "the ability to disable that."
   - Error message observed by free plan users trying to deploy without the flag: "Free plan deployments must be serverless." (station.railway.com/questions/free-plan-deployments-must-be-serverless-56b1a528)

So the counter-claim is right that "sleeping" is a named feature with a toggle. But the practical outcome is the same as the original claim: the free plan forces that toggle on and does not allow you to disable it. Hobby plan users can disable it. Voice requires it to be disabled.

### What "sleep" means for voice specifically

- Sleeping triggers when the service sends no outbound traffic for 10 minutes. Outbound traffic includes database connections, telemetry, NTP, pings to other services — so a genuinely idle service will sleep.
- Cold-start latency on wake is incompatible with voice latency requirements. The first request queues while the service boots.
- Active keepalive pings can prevent sleep, but this is fragile operational mitigation, not a plan.

### What happens when the $1/month credit runs out

When credits are exhausted, Railway stops all workloads rather than sleeping them. This is a separate concern from the sleeping mechanism and does not affect the planning conclusion — on the free plan, services would sleep on inactivity long before the $1 credit runs out.

### Sources of truth for this claim

| Claim | Source | Verification method | Drift risk |
|---|---|---|---|
| Free plan forces serverless on, cannot be disabled | Railway Help Station moderator (station.railway.com/questions/sleep-mode-9099392f) | Deploy a free service and check Settings > Deploy > Serverless toggle state | Medium — Railway has changed free tier behavior before |
| "Free plan deployments must be serverless" error text | station.railway.com/questions/free-plan-deployments-must-be-serverless-56b1a528 | Attempt deploy on free plan with serverless disabled | Medium |
| Serverless sleeps after 10min of no outbound traffic | docs.railway.com/reference/app-sleeping | Re-read that page | Low — feature behavior is stable |
| Hobby plan can disable serverless | Same moderator thread | Check Settings on a live Hobby service | Low |
| Credits exhausted stops workloads (not sleeps) | docs.railway.com/reference/pricing/plans | Re-read pricing docs | Medium |

## External factual API recommendation

### Recommended MVP choice

Weather remains the cleanest external factual capability.

Why:

- simple tool contract
- easy user validation
- low product risk
- useful for demonstrating evidence-backed factual answers

### Provider guidance

- Open-Meteo is a strong default for a demo because it is easy to integrate and fast.
- Its free open-access tier is non-commercial and rate-limited, which is acceptable for this demo but should not be confused with a production commercial answer.
- If commercial usage or stronger public-sector provenance becomes important, evaluate alternatives such as NWS for US-only use cases or a paid provider.

## Current package baseline

Verified on 2026-03-26 from package metadata:

| Package | Recommended baseline | Planning note |
|---|---:|---|
| `node` | `22+` | aligns with repo rules and current package expectations |
| `typescript` | `5.x` | planning-safe baseline |
| `openai` | `6.33.0` | current official JS SDK |
| `@openai/agents` | `0.8.1` | pre-1.0, pin exact |
| `@openai/agents-realtime` | `0.8.1` | pre-1.0, pin exact |
| `ai` | `6.0.138` | use for non-realtime text/background work |
| `fastify` | `5.8.4` | stable |
| `@fastify/websocket` | `11.2.0` | Fastify 5 line |
| `@fastify/cors` | `11.2.0` | stable |
| `drizzle-orm` | `0.45.1` | current stable line |
| `drizzle-zod` | `0.8.3` | supports both Zod 3 and 4 |
| `zod` | `4.3.6` | current planned default |
| `ws` | `latest` | needed for server→OpenAI sideband WebSocket |
| `@octokit/rest` | `22.0.1` | current stable; requires `moduleResolution: "node16"` in tsconfig |
| `@octokit/plugin-throttling` | `11.0.3` | include from day one |
| `@octokit/plugin-paginate-rest` | `14.0.0` | include from day one |
| `@livekit/agents` | `1.2.1` | credible fallback, not MVP default — verified 2026-03-26 via registry.npmjs.org |

### Three capabilities, two SDKs

| Path | SDK | Purpose |
|---|---|---|
| Live voice | `@openai/agents` + `@openai/agents-realtime` | WebRTC, sideband, VAD, interruption |
| Text/background agent runs (streaming or not) | `@openai/agents` | `run(agent, input, { stream: true })` returns `StreamedRunResult` with `.toTextStream()` |
| Embeddings | `openai` SDK directly or `ai` (Vercel AI SDK) | Embedding generation only |

These are complementary, not redundant. Vercel AI SDK has no Realtime API support. `@openai/agents` does not support embeddings but does support streaming text output natively. Planning and implementation should use the right SDK for the right path.

**Correction (2026-03-26):** The prior claim that "`@openai/agents` has no streaming text support" was wrong and has been removed. See the addendum at the bottom of this document for full verification details.

### Version conflicts resolved

- The older "pin Zod 3" advice is no longer the best default for this repo snapshot.
- Current `@openai/agents` and `@openai/agents-realtime` publish `zod: ^4.0.0` peer dependencies.
- Current `drizzle-zod` supports both Zod 3 and 4.
- Keep exact pins for pre-1.0 OpenAI Agents packages and recheck versions again when implementation starts.

## Decisions ready for planning

These are stable enough to promote directly into a plan:

- web-first MVP
- push-to-talk first
- browser `WebRTC` as the default voice path
- server-side tools and policy only
- sideband server controls as the default server integration
- Postgres as the durable source of truth
- raw turns plus summaries first
- SQL-first retrieval first
- read-only GitHub scope first
- evidence-backed answers or refusal
- weather as the simplest first factual tool
- Responses API, not Assistants API, for non-realtime text workflows
- keep bonus scope off the critical path
- deploy on Railway Hobby plan minimum ($5/mo) — free plan mandates serverless/sleeping and it cannot be disabled on that tier

## Spike-gated risks

These risks are real enough to shape plan sequencing, but they should be validated by spike work rather than overdesigned up front.

### High

- interruption quality may fail to meet UX expectations in real use
- sideband orchestration may be less stable on Railway than the docs imply
- 60-minute session rollover is mandatory, not optional
- private GitHub support would meaningfully raise auth and isolation complexity

### Medium

- tool latency can damage voice UX if audible status and async handling are poor
- exact client-secret TTL behavior is too volatile to bake in as a constant
- Railway host-binding guidance is inconsistent across docs
- premature vector retrieval can add complexity without helping recall much

### Low

- package versions are stable enough for planning, but exact pins must be rechecked at implementation time
- external weather provider choice is unlikely to block the architecture if timestamps and freshness are exposed

## Suggested spike exit criteria

The source docs repeatedly say "spike this" without defining success. Planning should.

Use criteria in this range:

- interruption fidelity: assistant audio stops quickly enough to feel immediate on barge-in
- no-tool latency: first assistant audio starts fast enough to feel conversational after push-to-talk release
- tool-backed latency: user gets an immediate working cue and a grounded answer within a short, acceptable delay
- sideband stability: no control-channel drop during an extended session test
- session rollover: proactive handoff preserves continuity without user-visible failure
- refusal quality: unsupported factual prompts refuse cleanly
- evidence quality: every grounded answer emits at least one durable evidence object

Exact thresholds should be set in the plan, not guessed inside research.

## Open product decisions

Planning should explicitly assign owners for these:

- Is private GitHub support in MVP?
- Is user auth and session isolation in MVP?
- What concrete latency threshold defines "good enough"?
- What should the audible working cue be: tone, spoken cue, model placeholder audio, or a combination?
- How long should transcript, summary, and fetched artifact retention last?
- What degraded-mode behavior is required when GitHub, weather, or memory retrieval fails?

## What to defer

Do not let these shape the initial plan unless product scope changes:

- passive background wake word
- open-mic VAD-first UX
- GitHub write actions
- native Swift track
- vector-first memory
- full-repo indexing by default
- multi-region or multi-replica scaling work

## Superseded or downgraded claims

These appeared in the research corpus but should not be treated as planning facts:

- exact Realtime pricing snapshots copied into research docs
- hardcoded client-secret TTL values
- community-only operational claims presented as certainties
- older package-version advice that conflicts with current metadata
- claims that a full server relay is required to keep tools server-side
- the imprecise claim that "free tier sleeps between requests" as if sleeping were a standalone automatic mechanism — the accurate statement is that the free plan mandates the Serverless toggle on (and it cannot be disabled), which then causes sleeping on inactivity

## Sideband + Ephemeral Key Compatibility — Targeted Investigation (2026-03-26)

This section supersedes the claim at the bullet above ("sideband only works when the server initiates the call..."). That claim is incorrect.

### What the official docs actually say

The server-controls guide (`developers.openai.com/api/docs/guides/realtime-server-controls/`) shows:

```javascript
// CLIENT-SIDE SDP POST — authenticates with the EPHEMERAL KEY
const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
  method: "POST",
  body: offer.sdp,
  headers: {
    Authorization: `Bearer ${EPHEMERAL_KEY}`,
    "Content-Type": "application/sdp",
  },
});
// call_id is extracted from the Location response header
const callId = sdpResponse.headers.get("Location")?.split("/").pop();

// SERVER-SIDE sideband WebSocket — docs show OPENAI_API_KEY, but see caveat below
const ws = new WebSocket("wss://api.openai.com/v1/realtime?call_id=" + callId, {
  headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
});
```

The SDP POST always goes to `/v1/realtime/calls`. In the ephemeral-key flow, the browser posts with `Bearer ${EPHEMERAL_KEY}`. The `Location` header returns a `call_id` regardless of which auth method was used. The sideband WebSocket uses that `call_id`.

### What the community reports actually say

The thread "Realtime API: WebSocket connection with call_id returns 404 when listening to WebRTC session from server" (community.openai.com, September–October 2025) shows:

- **Error:** `HTTP 404` on the server WebSocket + `"call_id_not_found"` on the client
- **Root cause identified by community:** Using the standard `OPENAI_API_KEY` for the sideband WebSocket when the session was initiated via ephemeral key
- **Workaround:** Authenticate the server sideband WebSocket with the ephemeral key instead of the standard API key
- Multiple confirmations (Oct 17, Oct 28, 2025). No OpenAI staff response.

### Corrected claim

The research doc claim "sideband only works when the server initiates the call" is wrong. The actual constraint is narrower:

> Both connection flows (server-API-key and ephemeral-key) use `POST /v1/realtime/calls` and return a `call_id` via `Location` header. Sideband is technically possible in both flows. However, the server sideband WebSocket may require the ephemeral key (not the standard API key) when the session was initiated with an ephemeral key — the docs say standard API key, the community says use the ephemeral key. This is an authentication token mismatch risk, not a fundamental architectural incompatibility.

### Spike requirement (unchanged in priority, tightened in scope)

The spike must specifically validate: which auth token (ephemeral key or standard API key) is required for the sideband WebSocket when the session was initiated via ephemeral key. This must be resolved in the first working voice loop, not deferred.

### Sources of truth for this area

| Area | Source | Drift risk |
|---|---|---|
| Server-controls SDP + sideband flow | `developers.openai.com/api/docs/guides/realtime-server-controls/` | High |
| WebRTC SDP endpoint | `developers.openai.com/api/docs/guides/realtime-webrtc/` | Medium |
| Ephemeral key generation | `platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret` | Low |
| 404 workaround (community) | `community.openai.com/t/realtime-api-websocket-connection-with-call-id-returns-404-when-listening-to-webrtc-session-from-server/1360198` | High |

## Addendum: Placeholder audio during Realtime tool calls — targeted investigation

**Research date:** 2026-03-26

**Claim under examination (research.md:249):**
> "The GA model auto-generates placeholder audio ('Let me check on that...') during tool calls. This may partially or fully satisfy the audible working indicator requirement without extra work — validate in spike."

**Counter-claim:**
> "In OpenAI's Realtime function-calling flow, the model may emit a function_call output 'instead of immediately returning a text or audio response,' meaning immediate 'placeholder audio' is not guaranteed. OpenAI's 'placeholder responses' discussion is framed around mitigating function-call waiting in the Responses API, not a guaranteed behavior for Realtime audio."

---

### 1. Current state

#### What the official developer blog says

The primary source is `https://developers.openai.com/blog/realtime-api`, the GA launch developer notes published by OpenAI.

The document contains a section explicitly titled **"Asynchronous function calling"** with this feature table:

| Feature | GA model | Beta model |
|---|---|---|
| Async function calling | yes | no |

The relevant passage, quoted verbatim from the fetched page:

> "Whereas the Responses API forces a function response immediately after the function call, the Realtime API allows clients to continue a session while a function call is pending."
>
> "...the GA Responses API adds placeholder responses with content we've evaluated and tuned in experiments to ensure the model performs gracefully, even while awaiting a function response."
>
> "If you ask the model for the results of a function call, it'll say something like, 'I'm still waiting on that.' This feature is automatically enabled for new models—no changes necessary on your end."

**The naming confusion:** The passage uses the phrase "GA Responses API" but the section is about the **Realtime API's GA interface** specifically — the section contrasts Realtime (session continues, placeholder fires) against the Responses API (immediate function response required). The "GA" qualifier refers to the GA Realtime interface, not the Responses API product.

This is confirmed by context:
- The surrounding paragraphs contrast Realtime vs. Responses API behavior.
- The feature table in the same section shows "Async function calling: ✅ GA model | ❌ Beta model" — this is the Realtime model table.
- The `developers.openai.com/blog/realtime-api` URL is the Realtime API blog post, not a Responses API doc.

#### What the Responses API function-calling guide says

`https://developers.openai.com/api/docs/guides/function-calling` — fetched directly. **No mention of placeholder responses, placeholder audio, or "still waiting"** in this document. The Responses API function-calling guide does not describe this feature, which further confirms it belongs to the Realtime API.

#### What community threads reveal about _pre-GA_ behavior

Community threads from 2024 / early 2025 (`community.openai.com`) describe:
- Silence while waiting for tool results as the **default pre-GA behavior**.
- A race condition where the model responds prematurely before tool execution completes.
- Developers worked around this by prompting the model to announce tool calls in advance, or by playing client-side "thinking sounds."
- One thread: "A tool call to a function must be immediately paired with a 'tool' response returned back to the AI with matching ID" — suggesting there was no graceful async holding pattern in the beta model.

These threads predate the GA launch and are consistent with the GA developer notes: async function calling with placeholder responses is **a new GA-only feature, absent from the beta model**.

---

### 2. Constraints

- **GA-only:** Placeholder responses are only available in the GA interface with the `gpt-realtime` / `gpt-realtime-1.5` models. They are explicitly absent from the beta model (confirmed in feature table).
- **Reactive, not proactive:** The docs describe this as a response to a user _asking about_ pending results ("if you ask the model for the results of a function call, it'll say something like..."). This is **reactive** behavior triggered by user prompt, not a proactive automatic announcement the moment a tool call fires.
- **No mention of pre-tool utterance:** The docs describe no behavior analogous to "let me check on that" fired immediately when the function call event is emitted. The described behavior is a graceful fallback when the user inquires mid-wait.
- **No explicit guarantee on timing:** The language "say something like 'I'm still waiting on that'" describes one scenario (user asks; model deflects). It does not guarantee an unprompted spoken cue the instant a tool call starts.
- **Cannot change the existing line 249 claim arbitrarily:** The research doc is a planning baseline document; corrections must be made carefully in an addendum, not silently edited in place.

---

### 3. Options — how to treat the claim at line 249

**Option A: Keep the claim as-is, treat the spike as the resolution gate.**
The existing line says "validate in spike." Leave it unchanged. The spike will directly observe whether an immediate unprompted spoken cue fires on tool call start. Risk: the plan might be designed assuming this works proactively when it only works reactively.

**Option B: Narrow the claim to match what the docs actually say.**
Restate the claim to distinguish between (a) proactive pre-tool audio cue and (b) reactive graceful deflection when the user asks mid-wait. This is more accurate and avoids a planning assumption that may not hold.

**Option C: Treat placeholder audio as "not available" for the working-indicator requirement and design an explicit fallback.**
Adds client-side indicator work regardless. Safest from a UX guarantee standpoint, but may duplicate work if (b) above turns out to meet the requirement in practice.

---

### 4. Recommendation

**Option B,** with the spike still required to validate proactive behavior.

Rationale:

The documented behavior is: GA Realtime model will respond gracefully ("I'm still waiting on that") if the user asks about a pending function result. This is a meaningful UX improvement over silence or hallucination, but it is **reactive** — it fires when the user speaks during the wait, not unprompted at tool-call start.

The requirement at `docs/requirements.md:12` is: "Make it known to user audibly if Jarvis is working." This requires a **proactive** signal — the user should hear something when a tool fires, not only if they happen to ask.

The correct planning posture is:

1. Do **not** assume placeholder audio is a proactive cue that fires at tool-call start.
2. Do **not** assume it satisfies the audible working indicator requirement without custom work.
3. Do plan a client-side working indicator (UI + potentially a spoken phrase from the model) as the default.
4. In the spike: test whether the model emits any audio in the gap between tool-call start and result submission without any user prompt. If it does, that satisfies the requirement. If not, a custom cue is required.

The phrase "auto-generates" in line 249 is misleading. The more accurate phrasing is: "The GA model gracefully handles being asked about pending tool results without hallucinating — it will say something like 'I'm still waiting on that.' This is reactive, not proactive. It does not guarantee an unprompted spoken cue at tool-call start. The spike must test proactive behavior explicitly."

**The counter-claim is partially correct:** the placeholder response feature is documented in a context that discusses Realtime function calling, but the mechanism is reactive (user asks → model deflects), not proactive (tool fires → model announces). The original claim overread "auto-generates" to imply proactive behavior the docs do not guarantee.

---

### 5. Required update to research.md line 249

The bullet at line 249 should read:

> The GA model handles pending tool calls gracefully — if asked about results mid-wait, it responds with something like "I'm still waiting on that" instead of hallucinating. This is a **reactive** behavior, not a proactive unprompted announcement. It does not guarantee an audible cue at tool-call start. The spike must explicitly test whether any audio fires proactively on tool call start; if not, a client-side working indicator must be designed.

---

### 6. Sources of truth

| Claim | Canonical source | Verification method | Drift risk |
|---|---|---|---|
| Async function calling is GA-only, not beta | `developers.openai.com/blog/realtime-api` — feature table in "Asynchronous function calling" section | Fetch page, check feature table row | Medium — blog posts can be updated |
| Placeholder response = reactive deflection on user inquiry | Same blog post, quoted passage: "if you ask the model for the results..." | Read exact quote; confirm "if you ask" is the trigger | Medium |
| Responses API guide has no placeholder audio feature | `developers.openai.com/api/docs/guides/function-calling` | Fetch and search for "placeholder" | Low |
| Pre-GA behavior was silence / race condition | `community.openai.com/t/asynchronous-function-calling-events/1371442` and related threads | Community posts; low authority | High — community, not official |
| Realtime API allows session to continue during function call (async) | `developers.openai.com/blog/realtime-api` | Same page | Medium |
| Feature is "automatically enabled for new models" | Same blog post | Same fetch | Medium |

---

## Primary sources checked for volatile claims

OpenAI:

- `https://developers.openai.com/api/docs/guides/realtime-webrtc/`
- `https://developers.openai.com/api/docs/guides/realtime-server-controls/`
- `https://developers.openai.com/api/docs/guides/realtime-conversations/`
- `https://developers.openai.com/api/docs/guides/realtime-costs/`
- `https://developers.openai.com/api/docs/models/gpt-realtime`
- `https://api.openai.com/v1/realtime/client_secrets`
- `https://developers.openai.com/api/docs/deprecations/`
- `https://developers.openai.com/api/docs/guides/migrate-to-responses/`

GitHub:

- `https://docs.github.com/en/rest/repos/contents`
- `https://docs.github.com/en/rest/git/trees`
- `https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`
- `https://docs.github.com/en/enterprise-server@3.14/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps`

Railway:

- `https://docs.railway.com/guides/fastify`
- `https://docs.railway.com/networking/public-networking/specs-and-limits`
- `https://docs.railway.com/deployments/scaling`
- `https://docs.railway.com/networking/troubleshooting/application-failed-to-respond`
- `https://docs.railway.com/reference/pricing/plans` (verified 2026-03-26)
- `https://docs.railway.com/reference/app-sleeping` (verified 2026-03-26)
- `https://docs.railway.com/reference/pricing/free-trial` (verified 2026-03-26)
- `https://station.railway.com/questions/sleep-mode-9099392f` (moderator confirmed free plan forces serverless on, Hobby can disable)
- `https://station.railway.com/questions/free-plan-deployments-must-be-serverless-56b1a528` (error message confirms requirement; Railway staff member brody confirmed fix requires redeploy from source)

Weather:

- `https://open-meteo.com/en/pricing`

---

## Addendum: @openai/agents streaming text — correction and verification

**Date verified:** 2026-03-26
**Verdict:** The counter-claim is correct. `@openai/agents` v0.8.1 has explicit, first-class streaming text support.

### 1. Current state

**Package:** `@openai/agents` v0.8.1
Source: `https://registry.npmjs.org/@openai/agents/latest`

The top-level package re-exports everything from `@openai/agents-core` via `export * from '@openai/agents-core'` in `packages/agents/src/index.ts`.

### 2. Streaming overload on `run()`

Confirmed from `packages/agents-core/src/run.ts` in `github.com/openai/openai-agents-js`:

```typescript
// Non-streaming (default)
export async function run<TAgent extends Agent<any, any>, TContext = undefined>(
  agent: TAgent,
  input: string | AgentInputItem[] | RunState<TContext, TAgent>,
  options?: NonStreamRunOptions<TContext, TAgent>,
): Promise<RunResult<TContext, TAgent>>;

// Streaming
export async function run<TAgent extends Agent<any, any>, TContext = undefined>(
  agent: TAgent,
  input: string | AgentInputItem[] | RunState<TContext, TAgent>,
  options?: StreamRunOptions<TContext, TAgent>,
): Promise<StreamedRunResult<TContext, TAgent>>;
```

`StreamRunOptions` sets `stream: true`. TypeScript overloads return `RunResult` for non-streaming and `StreamedRunResult` for streaming.

### 3. `toTextStream()` on `StreamedRunResult`

Confirmed from `packages/agents-core/src/result.ts`:

```typescript
toTextStream(): ReadableStream<string>;
toTextStream(options?: { compatibleWithNodeStreams: true }): Readable;
toTextStream(options?: { compatibleWithNodeStreams?: false }): ReadableStream<string>;
```

JSDoc: "Returns a readable stream of the final text output of the agent run. Pass `{ compatibleWithNodeStreams: true }` to receive a Node.js compatible stream instance."

The method transforms run stream events, extracts text deltas from output events, and pipes them through a `TransformStream`.

On the Node.js backend, use `{ compatibleWithNodeStreams: true }` to get a Node.js `Readable`.

### 4. Confirmed by real-world issues in the repo

- `github.com/openai/openai-agents-js/issues/485` — ReadableStream locked on abort during streaming
- `github.com/openai/openai-agents-js/issues/995` — usage data zero on streaming abort via AbortSignal
- `github.com/openai/openai-agents-js/issues/570` — tracing timing issue with `streaming: true`
- `github.com/openai/openai-agents-js/issues/705` — feature request for `streamAgentTools` to unify streaming across agent-as-tool calls

### 5. What remains correct about the embedding claim

`@openai/agents` does not support embeddings. That part of the original claim was accurate. Use the `openai` SDK directly (`client.embeddings.create(...)`) or Vercel AI SDK for embedding generation.

### 6. Sources of truth for this addendum

| Claim | Canonical Source | Verification Method | Drift Risk |
|---|---|---|---|
| `run()` streaming overload | `packages/agents-core/src/run.ts` in openai-agents-js | Read source file | Medium — pre-1.0 |
| `toTextStream()` on `StreamedRunResult` | `packages/agents-core/src/result.ts` in openai-agents-js | Read source file | Medium — pre-1.0 |
| `@openai/agents` re-exports `agents-core` | `packages/agents/src/index.ts` | Check `export *` | Low — structural |
| Current package version is 0.8.1 | `https://registry.npmjs.org/@openai/agents/latest` | `npm view @openai/agents version` | High — pre-1.0 releases frequently |
| Official streaming guide exists | `https://openai.github.io/openai-agents-js/guides/streaming/` | Direct URL fetch | Low |

---

## Addendum: Realtime model family update

Research date: 2026-03-26

### Current state

The `gpt-realtime` model listed as the original planning baseline (now updated inline in the "OpenAI realtime constraints" section) is the prior GA model, not the current best option.

`gpt-realtime-1.5` exists, is confirmed by OpenAI's own model docs, and was released 2026-02-23.

| Attribute | gpt-realtime | gpt-realtime-1.5 | gpt-realtime-mini |
|---|---|---|---|
| Description | "first GA realtime model" | "The best voice model for audio in, audio out" | "A cost-efficient version of GPT Realtime" |
| Context window | 32,000 tokens | 32,000 tokens | 32,000 tokens |
| Max output tokens | 4,096 | 4,096 | 4,096 |
| Knowledge cutoff | Oct 1 2023 | Sep 30 2024 | Oct 1 2023 |
| Text input | $4.00/1M | $4.00/1M | $0.60/1M |
| Cached text input | $0.40/1M | $0.40/1M | $0.06/1M |
| Text output | $16.00/1M | $16.00/1M | $2.40/1M |
| Audio input | $32.00/1M | $32.00/1M | not published on model page |
| Audio output | $64.00/1M | $64.00/1M | not published on model page |
| Function calling | yes | yes | yes |
| Structured outputs | no | no | no |
| Fine-tuning | no | no | no |

Sources:
- `https://developers.openai.com/api/docs/models/gpt-realtime`
- `https://developers.openai.com/api/docs/models/gpt-realtime-1.5`
- `https://developers.openai.com/api/docs/models/gpt-realtime-mini`

Release date: `gpt-realtime-1.5` released 2026-02-23 per OpenAI changelog.

Stated improvements in `gpt-realtime-1.5` (from OpenAI blog and external reporting):
- Up to 5% better audio reasoning
- 10% sharper transcription accuracy
- +7% instruction compliance
- Stronger tool calling
- Knowledge cutoff advanced 11 months, from Oct 2023 to Sep 2024

`gpt-realtime-mini` is the cost-efficient tier: 85% cheaper text pricing, but audio pricing is not published on the model spec page, and the model is positioned for cost/latency-sensitive workloads, not capability-first demos.

### Realtime API Beta deprecation

Confirmed. Per `https://developers.openai.com/api/docs/deprecations/`:

> "The Realtime API Beta will be deprecated and removed from the API on May 7, 2026."

This is approximately 6 weeks from today (2026-03-26). The migration target is the released Realtime API GA version. All code for this project should target GA endpoints only; Beta endpoints should not be used.

### Constraints

- Pricing for `gpt-realtime-1.5` is identical to `gpt-realtime` — no budget impact from this baseline change.
- Context window and output token limits are identical across all three models — no architectural impact.
- Knowledge cutoff for `gpt-realtime-1.5` is 11 months newer — better factual answer quality out of the box.
- Structured outputs remain unsupported on all three models — this constraint does not change.
- The Realtime API Beta removal deadline of May 7 2026 confirms urgency but does not change architecture; the plan already targets GA.

### Options

**Option A: Update planning baseline to `gpt-realtime-1.5`.** Swaps the model string. No architectural or pricing impact. Gets improved knowledge cutoff, transcription, and instruction following. Lowest risk.

**Option B: Keep `gpt-realtime` as baseline, validate `gpt-realtime-1.5` in spike first.** Conservative, but no practical upside — specs are identical except knowledge cutoff, and the model is GA.

**Option C: Use `gpt-realtime-mini` as baseline.** Lower text cost, but audio pricing unpublished and capability ceiling is lower. Wrong tradeoff for a capability-first demo.

### Recommendation

**Option A.** The planning baseline in this document has been updated inline to `gpt-realtime-1.5`.

Rationale:
- GA, not beta or preview.
- Pricing identical — no budget impact.
- Architecture identical — no plan disruption.
- Knowledge cutoff improvement directly helps factual question quality, a hard requirement.
- OpenAI explicitly calls it "the best voice model for audio in, audio out."
- No reason to plan against the prior model when the successor is GA, identically priced, and better on every stated metric.

`gpt-realtime-mini` should be noted as a future cost-optimization option after the demo is working.

### Sources of truth

| Area | Canonical source | Verification method | Drift risk |
|---|---|---|---|
| gpt-realtime-1.5 spec | `developers.openai.com/api/docs/models/gpt-realtime-1.5` | Direct fetch; confirm model ID, description, context window | Medium — new model, may receive snapshot updates |
| gpt-realtime-mini spec | `developers.openai.com/api/docs/models/gpt-realtime-mini` | Direct fetch | Medium — audio pricing not yet published |
| Realtime API Beta deprecation | `developers.openai.com/api/docs/deprecations/` | Check for May 7 2026 entry under "Realtime API Beta" | Low — deprecation dates rarely move later |
| gpt-realtime-1.5 changelog entry | `developers.openai.com/api/docs/changelog` | Search for 2026-02-23 entry | Low — historical fact |
| Pricing | `developers.openai.com/api/docs/models/gpt-realtime-1.5` | Cross-check at implementation time | High — pricing changes without notice |
