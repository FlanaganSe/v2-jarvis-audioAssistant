# v2-jarvis-audio

Real-time voice assistant with user memory and read-only repo knowledge.

## Commands
```bash
npm run dev              # Local dev server
npm test                 # Unit tests (Vitest)
npm run lint             # ESLint + Prettier check
npm run typecheck        # tsc --noEmit
```

## Rules
@.claude/rules/conventions.md
@.claude/rules/stack.md
@.claude/rules/immutable.md

## Workflow
`/discover` → `/research` → `/plan` → `/milestone` → `/complete`

## Escalation Policy
If a test, lint, or typecheck fails 3 times after attempted fixes, STOP and report what you've tried. If a plan step is ambiguous, ask before implementing.
