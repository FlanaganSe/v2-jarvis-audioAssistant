# Jarvis — Real-Time Voice Assistant

A voice assistant demo that can check weather, look up GitHub repos/issues/PRs, and recall past conversations. Audio streams directly between the client and OpenAI via WebRTC — the server never touches audio. It only mints sessions, executes tools via a sideband WebSocket, and persists conversations.

Two clients: a **React web app** and a **native SwiftUI iOS app**.

## Architecture

```
Browser / iOS ──WebRTC──▶ OpenAI Realtime API ──WebRTC──▶ Browser / iOS
                               │
                          sideband WS
                               │
                         Server (Fastify)
                         ├─ tool dispatch (weather, GitHub, recall)
                         ├─ persistence (PostgreSQL via Drizzle)
                         └─ post-session summaries (gpt-4o-mini)
```

1. Client requests an ephemeral key → opens WebRTC directly to OpenAI
2. Server opens a sideband WebSocket to the same OpenAI session for tool execution
3. Audio flows client ↔ OpenAI. The server only handles tools and persistence.

## Features

| Feature            | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| Voice conversation | Push-to-talk (default) or hands-free VAD mode               |
| Weather            | Current conditions via Open-Meteo (no API key)              |
| GitHub             | Read-only lookup of repos, files, issues, PRs from URLs     |
| Memory             | Recall past conversations using PostgreSQL full-text search |
| Evidence grounding | Tool results include citations; refuses to fabricate        |
| Session history    | Browse past sessions with summaries and transcripts         |
| iOS app            | Native SwiftUI client with the same feature set             |
| Audio-reactive orb | CSS animation driven by Web Audio API amplitude             |

## Quick Start

**Prerequisites:** Node.js 22+, PostgreSQL, [OpenAI API key](https://platform.openai.com/api-keys) with Realtime API access

```bash
git clone <repo-url> && cd v2-jarvis-audio
npm install                # postinstall handles client deps

cp .env.example .env       # set OPENAI_API_KEY at minimum
npm run db:migrate         # requires DATABASE_URL
npm run dev:all            # server (3000) + client (5173)
```

Without `DATABASE_URL`, the server runs in echo-only mode — voice works but tools are limited to echo.

## Environment

| Variable         | Required | Notes                                              |
| ---------------- | -------- | -------------------------------------------------- |
| `OPENAI_API_KEY` | Yes      | Realtime API access                                |
| `DATABASE_URL`   | No       | PostgreSQL. Without it: echo-only mode             |
| `GITHUB_TOKEN`   | No       | Fine-grained PAT. Without it: GitHub tool disabled |
| `PORT`           | No       | Default 3000, Railway sets automatically           |

## Stack

**Server:** Fastify 5, TypeScript 5, Node 22 · **Web:** React 19, Vite 6, Tailwind v4 · **iOS:** SwiftUI + WebRTC · **DB:** PostgreSQL via Drizzle · **AI:** gpt-realtime-1.5 (voice), gpt-4o-mini (summaries) · **CI/CD:** GitHub Actions → Railway

## Scripts

```bash
npm run dev:all          # Server + client concurrently
npm test                 # 63 unit tests (Vitest)
npm run lint             # ESLint + Prettier
npm run typecheck:all    # Server + client TypeScript
npm run build            # Production build
npm run db:studio        # Drizzle Studio (DB browser)
```

## Deployment

Deploys to Railway via a 3-stage Dockerfile (client build → server build → runtime). Set `OPENAI_API_KEY`, `DATABASE_URL`, and optionally `GITHUB_TOKEN` as Railway service variables.

## Docs

| Document                                     | Contents                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- |
| [Product Overview](docs/product-overview.md) | Architecture deep-dive, data model, API surface, state machine, tools |
| [Decisions](docs/decisions.md)               | Architecture decision records (ADRs)                                  |
| [Testing](docs/TESTING.md)                   | Manual QA runbook and test coverage                                   |
| [Requirements](docs/requirements.md)         | Original project requirements                                         |
