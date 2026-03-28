# Testing

## Automated Tests

63 unit tests across 9 files. All run in CI via GitHub Actions.

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run lint             # ESLint + Prettier
npm run typecheck:all    # Server + client TypeScript
```

### What's covered

- Config validation (Zod schema, defaults, error cases)
- Route contracts (session creation, sideband validation, health check, history endpoints)
- Tool handlers (weather geocoding/forecast/WMO codes, GitHub URL parsing/fetchers, recall timeframes, capabilities)
- Summary parsing (valid/invalid/partial JSON)

### What's not automated (and why)

- **WebRTC connection flow** — requires a real browser, mic, and OpenAI API
- **Sideband WebSocket lifecycle** — requires a live OpenAI session
- **Audio playback/recording** — hardware-dependent
- **React component rendering** — no component tests yet; UI is thin enough that manual verification is sufficient for a demo
- **iOS app** — requires Xcode + simulator/device

## Manual QA Runbook

Use this checklist to verify the demo works end-to-end before sharing or presenting.

### Prerequisites

- [ ] `.env` populated with at least `OPENAI_API_KEY`
- [ ] PostgreSQL running and `DATABASE_URL` set (for full tool testing)
- [ ] `npm run db:migrate` has been run
- [ ] `GITHUB_TOKEN` set (for GitHub tool testing)

### 1. Server Startup

```bash
npm run dev
```

- [ ] Server starts without errors
- [ ] Logs show `Server listening at http://[::]:3000`
- [ ] If `DATABASE_URL` missing: warning logged (`DATABASE_URL not set — tools limited to echo only`)
- [ ] If `GITHUB_TOKEN` missing: warning logged (`GITHUB_TOKEN not set — GitHub tool disabled`)
- [ ] `curl http://localhost:3000/health` returns `{"ok":true}`

### 2. Client Startup

```bash
npm run dev:client   # In a second terminal
```

- [ ] Vite starts on `http://localhost:5173`
- [ ] Browser shows "Jarvis" heading, Connect button, PTT/VAD toggle
- [ ] No console errors on load

### 3. Voice Connection (PTT mode)

- [ ] Click "Connect" — status changes to "Connecting..." then "Ready"
- [ ] Browser asks for microphone permission — grant it
- [ ] Orb appears in idle/breathing state
- [ ] Hold spacebar or hold the "Hold to Talk" button
- [ ] Status changes to "Listening..."
- [ ] Orb responds to mic amplitude
- [ ] Release spacebar — status changes to "Processing..."
- [ ] Jarvis responds — status changes to "Speaking...", orb animates
- [ ] Transcript shows both user `[speaking]` marker and Jarvis response
- [ ] Audio plays through speakers

### 4. Voice Connection (VAD mode)

- [ ] Toggle from PTT to VAD
- [ ] Mic activates automatically (no button press needed)
- [ ] Speak — Jarvis detects speech start, processes, responds
- [ ] Interrupt Jarvis while speaking — audio pauses, Jarvis listens
- [ ] Toggle back to PTT — mic deactivates, PTT button reappears

### 5. Weather Tool

- [ ] Ask "What's the weather in San Francisco?"
- [ ] Transcript shows "Checking weather..." tool indicator
- [ ] Orb changes to purple "working" state with spinner
- [ ] Jarvis responds with temperature, conditions, and location
- [ ] Response mentions the source (Open-Meteo)

### 6. GitHub Tool

- [ ] Ask "Tell me about github.com/anthropics/claude-code"
- [ ] Transcript shows "Looking up GitHub..." tool indicator
- [ ] Jarvis responds with repo description, stars, language
- [ ] GitHub digest card appears below transcript with structured data
- [ ] "View on GitHub" link in the card works

### 7. Recall / Memory

- [ ] Have at least one prior session with some conversation
- [ ] Ask "What did we talk about before?" or "What were we discussing yesterday?"
- [ ] Transcript shows "Searching memory..." tool indicator
- [ ] Jarvis responds with relevant past conversation context
- [ ] If no prior sessions: Jarvis says it doesn't find any past conversations

### 8. Capabilities

- [ ] Ask "What can you do?"
- [ ] Jarvis describes its tools (weather, GitHub, recall) and limitations

### 9. Evidence Grounding

- [ ] Ask a factual question without a tool (e.g., "What is the capital of France?")
- [ ] Jarvis should refuse or hedge ("I don't have a tool for that" / "I'm not sure")
- [ ] Jarvis should NOT fabricate an answer

### 10. Session History

- [ ] Click "History" button (top right)
- [ ] Past sessions appear with dates and topics
- [ ] Click a session — turns and summary expand inline
- [ ] Key facts and open questions shown if summary exists

### 11. Error / Degraded Modes

- [ ] **No database:** Start server without `DATABASE_URL` → should work in echo-only mode
- [ ] **Bad API key:** Set invalid `OPENAI_API_KEY` → Connect should fail gracefully with "Error" status
- [ ] **Disconnect:** Click "Disconnect" → status returns to "Disconnected", reconnect works
- [ ] **Sleep/wake:** Put laptop to sleep, wake up → auto-reconnect fires (web only)

### 12. Latency Badge

- [ ] While connected, RTT badge appears next to status
- [ ] Green (<150ms), yellow (<300ms), or red (>300ms)
- [ ] Updates every ~2 seconds

### 13. Production Build

```bash
npm run build && npm start
```

- [ ] Build completes without errors
- [ ] `http://localhost:3000` serves the React app (not the legacy `public/` page)
- [ ] All features work as above

### 14. iOS Smoke Test (if available)

- [ ] Open `ios/Jarvis/Jarvis.xcodeproj` in Xcode
- [ ] Build and run on simulator (or device on same network as server)
- [ ] App shows "Disconnected" status
- [ ] Tap "Connect" → status changes to "Ready"
- [ ] PTT and VAD modes work
- [ ] Weather and GitHub tools work
- [ ] Session history loads
- [ ] GitHub digest card renders

### Common Failure Symptoms

| Symptom                               | Likely cause                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- |
| "Failed to create session" on connect | Invalid or missing `OPENAI_API_KEY`                                       |
| Tools don't work (echo only)          | `DATABASE_URL` not set                                                    |
| GitHub tool never triggers            | `GITHUB_TOKEN` not set                                                    |
| No audio from Jarvis                  | Browser autoplay policy — click somewhere first                           |
| Sideband fails silently               | Ephemeral key expired (>60s between session create and sideband connect)  |
| iOS can't connect                     | Device not on same network as dev server, or `Config.swift` has wrong URL |
| "Searching memory..." returns nothing | No prior sessions in database, or `DATABASE_URL` changed                  |
