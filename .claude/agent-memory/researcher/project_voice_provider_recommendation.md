---
name: Voice provider recommendation (March 2026)
description: Researched recommendation on which voice AI provider stack to use for Jarvis — Deepgram Voice Agent API as primary recommendation
type: project
---

Research completed March 2026. Recommendation: **Deepgram Voice Agent API with BYO LLM** (Claude 3.5 Sonnet or GPT-4o).

**Why:** Best balance of latency (~500–800 ms), TypeScript SDK quality, deterministic function calling, built-in barge-in, LLM flexibility, and cost ($0.07–$0.08/min bundled). OpenAI Realtime API is simpler but has documented tool-calling reliability issues and locks to GPT-4o.

**Pricing correction (verified March 2026):** The prior $0.30–$0.50/min estimate for OpenAI Realtime was based on old `gpt-4o-realtime-preview` rates with heavy system prompts. Current `gpt-realtime-1.5` runs $0.10–$0.15/min; `gpt-realtime-mini` runs $0.03–$0.08/min. Cost gap between OpenAI Realtime and Deepgram is now 1.5–2x, not 4–6x. Non-cost reasons (LLM flexibility, function calling determinism) still favor Deepgram.

**Do not use Vapi** — breaking changes after platform updates are documented and disqualifying for production frontline tools.

**Quality-optimized variant:** Deepgram BYO TTS tier + ElevenLabs Flash v2.5 (~75 ms TTS first-byte, best voice quality). ElevenLabs Conversational AI itself is now $0.08–$0.10/min but LLM costs are not yet passed through — price will rise.

**Upgrade path:** Deepgram STT can feed directly into LiveKit Agents if more orchestration control is needed later without changing STT providers.

**How to apply:** When asked about voice provider choices, this is the standing recommendation unless requirements change. Revisit if Deepgram Voice Agent API GA stability proves insufficient in production testing.
