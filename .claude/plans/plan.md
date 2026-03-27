# Plan: Demo Polish — Transparency & Observability Features

## Contract

### Problem

The assistant works but is opaque. Tool calls execute invisibly, the assistant doesn't know today's date, session summaries are generated but hidden, and there's no way to see connection quality. For a demo, this makes the AI feel like a black box when it should feel like a transparent, intelligent system.

### Requirements

- **P0-1**: Inject current date/time/day-of-week into the system prompt per session
- **P0-2**: Show tool call activity in the transcript (e.g., "Searching memory...")
- **P1-1**: Show session summary (topics, key facts, unresolved) in the sidebar for past sessions
- **P1-2**: Show WebRTC round-trip time in a small stats badge
- **P2-1**: Verify whether `conversation.item.created` with function_call_output appears on the browser data channel (gates GitHub digest feature)
- **P2-2**: If verified, render GitHub tool results as a structured panel below the transcript

### Acceptance criteria

- **P0-1**: Given a new session, when the assistant is asked "what day is it?", then it answers correctly
- **P0-2**: Given a tool call, when the user sees the transcript, then a "Searching memory..." or "Checking weather..." entry appears before the assistant speaks the result
- **P1-1**: Given a past session with a summary, when the user expands it in the sidebar, then topics, key facts, and unresolved items are visible
- **P1-2**: Given an active connection, then a badge shows RTT in milliseconds
- **P2-1**: Logged to console: either "conversation.item.created appears on DC" or "it does not"
- **P2-2**: Given a GitHub URL spoken to the assistant, then a structured card appears below the transcript with repo/issue/PR data

### Non-goals

- No SSE or server→client push infrastructure
- No schema migrations (evidence_records FK, tool_calls turnId fix)
- No live inline citations (Feature 4 — deferred, requires migration)
- No current-session summary display (requires returning dbSessionId + polling — separate effort)
- No repo-level aggregate digest (issue list, PR list — requires new GitHub API calls)

### Constraints

- **No server→client push channel exists** and we are not adding one. All client-visible data must come from: (a) OpenAI data channel events, or (b) REST API calls.
- **Data channel is client↔OpenAI only**. The server cannot inject messages into it.
- **`pcRef` is internal to `useSession`**. Any stats must be exposed through the hook's return interface.
- **Swift compatibility**: every feature must use a protocol a native iOS client could also consume. No React-specific data paths.

---

## Implementation Plan

### Summary

Four independent, low-risk features (date/time, tool activity, sidebar summaries, latency badge) plus one gated feature (GitHub digest) that depends on a single verification step. The core architectural decision: **we only use data already flowing through the system** — OpenAI data channel events the client already receives, DB data the sidebar already queries, and `RTCPeerConnection.getStats()` the browser already provides. No new server infrastructure. No new protocols. The GitHub digest is the one stretch — it depends on whether OpenAI sends `conversation.item.created` on the browser data channel.

### Current state

| Area                     | Current behavior                                                                             | File                                 |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| System prompt            | Module-level constant, evaluated once at server startup                                      | `session.ts:15-28`, used at line 108 |
| Tool call on client      | `response.function_call_arguments.done` received, sets state to `'working'`, discards `name` | `useSession.ts:104-106`              |
| TranscriptEntry type     | `{ role: 'user' \| 'assistant', text: string, final: boolean }`                              | `useSession.ts:6-10`                 |
| Session detail (sidebar) | `getSessionDetail` returns turns only, no summary data                                       | `persistence.ts:115-143`             |
| SessionSidebar           | Shows date + topics in collapsed view; turns in expanded view                                | `SessionSidebar.tsx:44-77`           |
| RTCPeerConnection        | Created in `useSession`, stored in `pcRef`, not exposed                                      | `useSession.ts:32, 152`              |
| Unhandled DC events      | Silently ignored (no default/catch-all in switch)                                            | `useSession.ts:87-137`               |

### Files to change

| File                                       | Change                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/server/routes/session.ts`             | Move `systemPrompt` construction inside route handler; template date/time                                                                                                                                                                                                                                                                                                                 | Feature 3 — prompt must be per-request, not per-boot  |
| `client/src/hooks/useSession.ts`           | (1) Add `'tool'` variant to `TranscriptEntry` with `toolName` field. (2) Handle `response.function_call_arguments.done` — read `event.name`, append tool transcript entry. (3) Add `rttMs` state + polling interval on `pcRef.current.getStats()`. (4) Add catch-all `default:` case that logs unhandled events (needed for P2-1 verification). (5) Expose `rttMs` in `UseSessionReturn`. | Features 1, 5, P2-1 verification                      |
| `client/src/components/Transcript.tsx`     | Add render branch for `role === 'tool'` entries (italic, gray, tool icon)                                                                                                                                                                                                                                                                                                                 | Feature 1 — display tool activity                     |
| `src/db/persistence.ts`                    | Extend `getSessionDetail` to left-join `session_summaries` and return `keyFacts`, `unresolved`, `entities` alongside turns                                                                                                                                                                                                                                                                | Feature 2 — surface hidden summary data               |
| `src/server/routes/history.ts`             | No change needed — already calls `getSessionDetail`                                                                                                                                                                                                                                                                                                                                       | —                                                     |
| `client/src/types.ts`                      | Add `SummaryData` fields to `SessionDetail` type                                                                                                                                                                                                                                                                                                                                          | Feature 2 — client type must match new response shape |
| `client/src/components/SessionSidebar.tsx` | Render `keyFacts`, `unresolved` in the expanded session view                                                                                                                                                                                                                                                                                                                              | Feature 2 — display summary data                      |
| `client/src/App.tsx`                       | (1) Receive `rttMs` from `useSession`. (2) Render latency badge. (3) Conditionally render `<GitHubDigestPanel>` if digest data exists.                                                                                                                                                                                                                                                    | Features 5, 6                                         |

### Files to create

| File                                          | Purpose                                                                                    | Pattern to follow                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `client/src/components/LatencyBadge.tsx`      | Small badge showing RTT ms, colored by quality                                             | Follows `StatusBadge.tsx` pattern — stateless, receives props     |
| `client/src/components/GitHubDigestPanel.tsx` | Structured card for GitHub data (repo/issue/PR) — only created if P2-1 verification passes | New component, follows Tailwind patterns from existing components |

### Milestone outline

- [ ] **M1: Date/time in system prompt** — Move prompt construction inside route handler, inject formatted date. Verify with `npm test`.
  - [ ] Step 1 — Add `buildSystemPrompt(base)` function that prepends current date/time; use it inside route handler → verify: `npm test`
  - [ ] Step 2 — Add test asserting request body includes date string → verify: `npm test`
        Commit: "feat: inject current date/time into system prompt per session"
- [ ] **M2: Tool call activity in transcript** — Add tool transcript entry type, handle `event.name` on DC, render in Transcript component. Verify visually: connect, trigger a tool, see "Checking weather..." appear.
- [ ] **M3: Past session summary in sidebar** — Extend `getSessionDetail` query, update client types, render in SessionSidebar. Verify: open sidebar, expand a past session with a summary, see key facts.
- [ ] **M4: Latency badge** — Add `getStats()` polling hook, expose `rttMs`, render LatencyBadge. Verify: connect, see RTT value update.
- [ ] **M5: DC event verification** — Add `default:` log for unhandled data channel events. Connect, trigger a GitHub tool call, check console for `conversation.item.created`. **STOP and report findings before proceeding.**
- [ ] **M6: GitHub digest panel** — (Only if M5 confirms DC receives function_call_output.) Parse tool result from `conversation.item.created`, store as `githubDigest` state, render `<GitHubDigestPanel>` below transcript. If M5 is negative, skip M6 — it requires SSE infra which is out of scope.

### Testing strategy

| Milestone | Tests                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1        | Update `session.test.ts` — verify prompt includes a date string (mock `Date`). Existing test pattern: `session.test.ts` already tests route responses.                                                 |
| M2        | No unit test needed — this is a client-side event handler change. Manual verification: connect → trigger tool → see entry.                                                                             |
| M3        | Update `history.test.ts` — verify `getSessionDetail` response includes summary fields. Or add a test in `persistence` if that pattern exists. Existing test: `history.test.ts` tests the GET endpoint. |
| M4        | No unit test — browser API (`getStats`) can't be meaningfully mocked in Vitest. Manual verification.                                                                                                   |
| M5        | No test — this IS the test (console.log verification).                                                                                                                                                 |
| M6        | Manual verification — connect, speak a GitHub URL, see card.                                                                                                                                           |

### Migration & rollback

No database migrations. No schema changes. All changes are additive code. Rollback = revert commit.

### Manual setup tasks

None. All features use existing infrastructure (OpenAI API, existing DB schema, browser APIs).

### Risks

| Risk                                                                                                                   | Likelihood | Impact                           | Mitigation                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYSTEM_PROMPT` is used in a test that expects exact string match                                                      | Medium     | Blocks M1                        | Read `session.test.ts` before changing — adjust test expectation                                                                                         |
| `response.function_call_arguments.done` doesn't carry `name` on the data channel (different event shape than sideband) | Low        | Blocks M2                        | The research confirmed `name` is in the event spec. Add a console.log in M2 to verify before rendering.                                                  |
| `getStats()` returns `undefined` for `currentRoundTripTime` behind TURN relay                                          | Medium     | M4 shows "—" instead of a number | Guard with nullish check, display "—" when unavailable. Label as "Connection RTT" not "latency."                                                         |
| `conversation.item.created` does NOT appear on browser data channel                                                    | Medium     | Blocks M6                        | M5 exists specifically to verify this. If negative, M6 is cleanly skipped — no wasted work.                                                              |
| `getSessionDetail` left-join returns null summary fields for sessions without summaries                                | Low        | UI renders empty section         | Guard with `summary && summary.keyFacts?.length > 0` before rendering. Already handled for `topics` in existing code.                                    |
| Multiple tool calls in a single turn (tool chain) cause rapid state flickers                                           | Low        | UX jank in M2                    | The tool entry stays in transcript; state transitions are already `working` → `ready`. No new flicker risk — tool entry is additive, not a state change. |

### Open questions

1. **M6 viability** — Does `conversation.item.created` appear on the browser data channel? M5 answers this. If no, do we want to build SSE infrastructure (out of scope for this plan) or defer the GitHub digest entirely?

2. **Tool name display mapping** — The internal tool names are `recall`, `get_weather`, `github`, `capabilities`. For the transcript, do we want friendly names ("Searching memory...", "Checking weather...", "Looking up GitHub...") or raw names? Recommendation: friendly names via a simple map.

3. **Latency badge position** — Next to `StatusBadge`? Inside it? Separate component below? Recommendation: separate small component, positioned near StatusBadge in App.tsx.
