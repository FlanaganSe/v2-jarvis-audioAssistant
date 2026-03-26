# Implementation Handoff

## How to build this project

Run `/milestone` to execute the next milestone. Run it once, wait for it to finish, review the output, then run it again for the next milestone. The skill reads `.claude/plans/plan.md`, finds the next unchecked milestone, details it, implements it, verifies it, and commits.

**Do not run multiple milestones in a single session.** Each `/milestone` invocation should be one clean unit of work.

---

## Before you start M1

### Manual steps (you must do these yourself)

1. **Copy `.env.example` to `.env`:**
   ```bash
   cp .env.example .env
   ```

2. **Add your OpenAI API key** to `.env`:
   ```
   OPENAI_API_KEY=sk-...
   ```
   The key must have Realtime API access enabled. Check at https://platform.openai.com/api-keys

3. **Verify Node.js 22+:**
   ```bash
   node --version   # must be v22.x or higher
   ```

### Then run:
```
/milestone
```

---

## Between milestones

After each `/milestone` completes, it will tell you:
- What was built
- What manual steps you need to do before the next milestone
- What's coming next

**Read the manual steps carefully.** They typically involve provisioning services or adding secrets to `.env`. The full list is in the plan (section 7), but the milestone output will remind you of exactly what's needed next.

### Expected manual steps per milestone:

| Before | You need to |
|--------|------------|
| **M1** | Add `OPENAI_API_KEY` to `.env`. Ensure Node 22+. |
| **M2** | Start local PostgreSQL: `docker run --name jarvis-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=jarvis -p 5432:5432 -d postgres:16`. Add `DATABASE_URL=postgresql://postgres:dev@localhost:5432/jarvis` to `.env`. Run `npm run db:migrate`. |
| **M3** | Create a fine-grained GitHub PAT (read-only repo access) at https://github.com/settings/tokens?type=beta. Add `GITHUB_TOKEN=github_pat_...` to `.env`. |
| **M4** | Sign up for Railway Hobby plan ($5/mo). Create project. Provision PostgreSQL service. Set env vars in Railway dashboard. Generate public domain. |

---

## How to test at each milestone

After each milestone, you should be able to run:

```bash
npm test             # unit tests (should always pass)
npm run lint         # eslint + prettier (should always pass)
npm run typecheck    # tsc --noEmit (should always pass)
```

After M1, you can also run the dev server and test voice manually:
```bash
npm run dev          # starts Fastify, serves client, open browser to http://localhost:3000
```

After M2, additional database commands:
```bash
npm run db:generate  # generate Drizzle migrations from schema changes
npm run db:migrate   # apply migrations
npm run db:studio    # open Drizzle Studio to inspect data
```

After M3, eval scripts:
```bash
npm run eval         # runs refusal + evidence eval scripts (requires running server + API keys)
```

---

## Rules for the implementing agent

These are directives for the Claude agent executing `/milestone`. They are loaded via CLAUDE.md and the skill definition, but are restated here for clarity:

### Quality gates
- `npm run lint`, `npm test`, and `npm run typecheck` must pass before every commit. No exceptions.
- If any of these fail 3 times after attempted fixes, **STOP and report what you've tried.** Do not keep going.

### Risk posture
- Follow the plan. Minor deviations are fine but **must be commented in the plan** if they affect future milestones.
- If a plan step is ambiguous, **ask before implementing** — do not guess.
- If you encounter a blocking issue that cannot be resolved (e.g., an API doesn't behave as documented, a package is broken), **STOP and report.** Do not work around it silently.
- If you need to research something (SDK API, package behavior, deployment config), use the researcher subagent. Do not guess at APIs.

### Code standards
- Prefer immutable patterns, functional style, pure function composition.
- Small focused modules over large files.
- Co-located tests: `foo.ts` → `foo.test.ts`.
- Named exports over default exports.
- Explicit return types on public functions.
- Do not add comments, docstrings, or type annotations to code you didn't write.
- External APIs (OpenAI, GitHub, Open-Meteo) mocked at the HTTP boundary in tests.

### Flexibility
- This project will grow in scope. Keep modules small, interfaces clean, and coupling low.
- Do not hardcode assumptions. Use config/env vars for anything that might change.
- If you create an abstraction, it should serve the current milestone — not hypothetical future ones.

### Commits
- One commit per milestone.
- Keep commit messages to 1 line.
- No "Co-Authored-By" lines.

### Communication
- Report every manual step the user must take. Be exact — include commands, URLs, and env var names.
- Report how to verify the milestone works (which commands to run, what to look for).
- If something didn't go as planned, say so and explain what changed and why.
