---
name: Jarvis project context
description: Core facts about the Jarvis voice assistant project — use case, requirements, and constraints
type: project
---

Jarvis is a real-time voice assistant for frontline workers built on TypeScript/Node.js 22+. The product lives in `/Users/seanflanagan/glt/frontierAudio/v2-jarvis-audio`.

Key requirements (docs/requirements.md):
- Sub-second latency — frontline environment, zero tolerance for lag
- Interruptibility ("Quiet, Jarvis" must work reliably)
- Conversation memory across sessions
- Zero hallucinations — say "I don't know" rather than fabricate
- GitHub integration (PRs, issues, comments, merges from any public repo)
- Custom API data handling (refreshes every 3 minutes, always use latest)
- Tool/function calling is non-negotiable

Bonus: mobile (Kotlin/Swift), passive/wake-word mode, 10+ concurrent users, end-to-end agent (auto-open PRs).

**Why:** Frontline workers make decisions in seconds — latency and accuracy failures have direct operational impact.

**How to apply:** Every architectural and provider decision must be weighed against latency, reliability, and tool-use fidelity first. Voice quality and cost are secondary.
