# Stack

- **Language:** TypeScript (Node.js 22+, TypeScript 5.x)
- **Server:** Fastify 5 + Drizzle ORM
- **Frontend:** React 19 + Vite + Tailwind CSS v4 (standalone `client/` package)
- **Database:** PostgreSQL (Railway-hosted)
- **Package manager:** npm (no workspaces — `client/` has its own `package.json`)
- **Test framework:** Vitest
- **Linter/formatter:** ESLint + Prettier
- **Real-time:** WebRTC (browser → OpenAI direct) + WebSocket sideband (server → OpenAI)
- **Deployment:** Railway via Dockerfile (3-stage: client-builder → server-builder → runtime)
