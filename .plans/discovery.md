# Discovery

Date: 2026-03-26
Status: draft for confirmation

## Problem statement

Build a clean TypeScript-first MVP of Jarvis for `v2-jarvis-audio`: a low-latency voice assistant that feels natural, supports interruption, remembers prior conversations, answers questions about public GitHub repositories, and answers questions from one external API using fresh data only. The core product challenge is not "make voice work"; it is combining fast conversation with strict evidence-based behavior so Jarvis either answers from current tool results or clearly says it does not know.

The current repo is greenfield. The v1 repo provides useful prior art, but it should be treated as a reference implementation rather than the required direction.

## Who's affected

- Frontline users who need fast spoken answers while hands and attention are occupied
- Technical reviewers or demo operators who care about trust, citations, freshness, and safe boundaries
- Stakeholders evaluating whether this is a credible MVP with a path to bonus features later

## Acceptance criteria

- A user can have a real-time spoken conversation with Jarvis with low perceived latency
- Jarvis gives audible feedback when work is taking perceptible time
- Jarvis can be interrupted and stop speaking promptly when the user speaks again
- Jarvis can recall relevant information from prior sessions
- Jarvis can ingest a public GitHub URL and answer read-only questions about repo state, issues, PRs, comments, and recent changes
- Jarvis can answer questions from one chosen API using fresh data only
- Jarvis can explain its own capabilities and limitations
- Jarvis refuses unsupported factual claims instead of fabricating
- The MVP remains simple enough to deploy on Railway and evolve toward bonus features without a rewrite

## Constraints

- Primary language: TypeScript
- Optional later expansion: Swift, Python
- Deployment target: Railway
- Favor efficiency, clarity, and maintainability over breadth
- Documentation should be minimal and directly useful for building
- Current project rules prefer modern TypeScript, immutable patterns, modular code, and tight pragmatic changes
- Do not assume the v1 architecture is automatically correct for v2

## Non-goals

- Full autonomous write actions against GitHub or external systems in MVP
- Passive wake-word mode in MVP unless explicitly prioritized
- Native mobile-first architecture unless product direction requires it
- Heavy workflow orchestration before the MVP interaction loop works
- Over-designed documentation or speculative infrastructure

## Resolved questions

- The MVP should be voice-first, but not voice-only; a light companion UI is likely valuable for citations, freshness, and state
- Push-to-talk is the safest default interaction for MVP; passive mode is better treated as bonus work
- "Zero hallucination" should be treated as an evidence-gating and refusal-policy problem, not a prompting problem
- GitHub integration should start read-only
- The external API integration should be built behind an adapter boundary so the eventual real API can replace an MVP placeholder cleanly
- V1 already proved a TypeScript monorepo shape can work well for this product space

## Open questions

- Should the MVP be explicitly web-first, or should a native Apple client shape the architecture from day one?
- Which external API should be used first for the MVP, and what are its auth, freshness, and quota constraints?
- Should v2 prefer the newer browser-oriented OpenAI voice stack first, or keep the stronger server-relay pattern from v1 for policy and debugging?
- Is multi-user auth/isolation part of MVP demo scope, or should it stay deferred with the other bonus requirements?

## Confirmation prompt

The main product framing appears to be: build a web-first, push-to-talk, evidence-gated Jarvis MVP on TypeScript/Railway first; keep native mobile, passive wake word, and write actions as later tracks. If that is wrong, the most important correction is whether MVP should be shaped around a native Apple client now.
