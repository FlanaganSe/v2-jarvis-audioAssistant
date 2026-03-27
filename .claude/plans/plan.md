# Plan: Fix VAD

## Contract

### Problem

VAD toggle appears to do nothing. Four root causes identified (research):

1. `npm run dev` serves stale `client/dist` or legacy `public/`, not the live Vite client
2. `setVadMode` silently drops the `session.update` if the data channel isn't open yet (race with `ready` state)
3. No `session.updated` or `speech_stopped` listener — no way to confirm VAD is working or diagnose failure
4. Reconnect doesn't re-apply VAD mode to the new session

### Requirements

- P0-1: `npm run dev` always serves the live React client during development
- P0-2: `session.update` for VAD is never silently dropped
- P0-3: `session.updated` confirms VAD was accepted (logged to console)
- P1-1: `speech_stopped` event is handled (state transitions correctly in VAD mode)
- P1-2: VAD mode is re-applied after reconnect
- P1-3: PTT button is hidden in VAD mode, mic stays live (already done in App.tsx:76)

### Acceptance criteria

- Given `npm run dev`, when I open `localhost:3000`, then I see the live Vite-proxied React client (not stale build or legacy)
- Given a connected session, when I toggle VAD on, then the console shows `[VAD] session.updated` with `turn_detection.type === 'semantic_vad'`
- Given VAD is on and I speak, then the app transitions through `listening` → `processing`/`speaking` without pressing any button
- Given VAD is on and I reconnect, then the new session has VAD re-applied automatically
- Given VAD is on and I toggle it off, then the console shows `session.updated` with `turn_detection: null` and the mic mutes

### Non-goals

- Wake word ("Jarvis" activation) — separate milestone, bonus requirement
- User-side transcript display in VAD mode — nice-to-have, not blocking
- Removing `public/` directory — separate cleanup task
- Automated test coverage for WebRTC paths (cannot unit-test WebRTC without heavy mocking)

### Constraints

- No reconnect to switch modes (ADR-002)
- No SDK (ADR-001)
- GA event names only (ADR-010)
- `session.update` over data channel uses flat `session.turn_detection` (not nested under `audio.input`)
- PTT flow must not regress

---

## Implementation Plan

### Summary

Three small changes to one file (`useSession.ts`) plus a dev-workflow fix. The core issue is that the data channel is not guaranteed open when the UI allows VAD toggle, and there's no feedback loop to confirm the `session.update` was accepted. We fix this by (a) gating `ready` state on data channel open, (b) adding `session.updated` and `speech_stopped` handlers, and (c) re-applying VAD mode when the DC opens. The dev-workflow fix ensures we're testing live source during development.

### Current state

- `useSession.ts:215` — sets `ready` after `setRemoteDescription`, before DC is open
- `useSession.ts:266-298` — `setVadMode` silently exits if DC not open
- `useSession.ts:79-123` — `handleServerEvent` doesn't handle `session.updated` or `speech_stopped`
- `src/server/app.ts:12-16` — `resolveStaticRoot` serves `client/dist` if it exists, else `public/`
- `package.json:6` — `npm run dev` starts only the server

### Files to change

1. **`client/src/hooks/useSession.ts`** — All VAD fixes live here:
   - Move `setState('ready')` into a `dc.addEventListener('open', ...)` handler
   - In that same handler, re-apply VAD mode if `vadMode === 'vad'`
   - Add `session.updated` case to `handleServerEvent` (console.log the effective turn_detection)
   - Add `input_audio_buffer.speech_stopped` case to `handleServerEvent` (finalize user transcript, set state to `processing`)

2. **`src/server/app.ts`** — Skip `client/dist` in dev mode so Vite always serves live source:
   - `resolveStaticRoot` should only return `client/dist` in production (or when Vite is not running)
   - Simplest: check `config.NODE_ENV !== 'production'` → return `public/` (Vite proxy handles the React client in dev). In production, `client/dist` is always freshly built by the Dockerfile.

### Files to create

None.

### Milestone outline

- [x] M1: Dev workflow — make `npm run dev` + `dev:all` always test live React source
- [ ] M2: Data channel readiness — gate `ready` on DC open, re-apply VAD on open
- [ ] M3: VAD observability — handle `session.updated` and `speech_stopped` events
- [ ] M4: Manual verification — connect, toggle VAD, speak, confirm full event cycle in DevTools

### Testing strategy

- M1: Manual — run `npm run dev:all`, open `localhost:5173`, confirm React UI loads with VAD toggle
- M2: `npm run typecheck:all` to confirm type safety. Manual test: connect, immediately toggle VAD, confirm `session.update` is sent (visible in M3 logging)
- M3: `npm run typecheck:all` + `npm run lint`. Manual test: toggle VAD, speak, confirm `[VAD] session.updated` and state transitions in console
- M4: Full end-to-end manual test of PTT (regression) and VAD (new behavior)

No new unit tests — WebRTC and data channel cannot be meaningfully unit-tested without mocking the entire browser API surface. The manual verification in M4 is the honest test.

### Risks

| Risk                                                    | Mitigation                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `semantic_vad` silently ignored by model                | M3 logging reveals this immediately; fall back to `server_vad` if needed                          |
| DC `open` event never fires (broken connection)         | Existing `onconnectionstatechange` handler catches `failed`/`disconnected`                        |
| PTT regression from moving `ready` into DC open handler | M4 explicitly tests PTT flow; PTT also guards on `dc.readyState === 'open'` so no behavior change |
| Stale `client/dist` continues to be served              | M1 changes `resolveStaticRoot` to skip it in dev; `.gitignore` already excludes it from commits   |

### Open questions

None — all four fixes are well-understood from research. Ready to implement.
