# Agent Instructions

VTCDashboard: web dashboard for one ETS2/ATS virtual trucking company (RU/EN, responsive). pnpm monorepo: Fastify API (`apps/api`), React/Vite SPA (`apps/web`), shared `packages/`; MySQL 8.4, Node.js 24.22.0, pnpm 12.14.0.

- Idea and features: [CONCEPT.MD](CONCEPT.MD); detailed rules: [policies](docs/product/mvp-policies.md), read only relevant sections. Cards: [Trello](https://trello.com/b/NwhwurSM/vtcdashboard).
- Commands: [CONTRIBUTING.md](CONTRIBUTING.md). For code changes run `pnpm check` and `pnpm build`.
- Security, architecture, review and delivery rules: [agent rules](docs/development/agent-rules.md). Read the matching section before such work.
- Public repo: never commit or post secrets, real member data or private hosting details.
- Docs and comments in English; reply in the user's language.
- Edit CONCEPT.MD only when a feature is added or changed; keep it brief.
- Don't create docs, reports or status notes the task doesn't require. Put change summaries and verification evidence in the PR description.
- Keep this file under 1200 characters (checked by `pnpm test:scaffold`). Add details to linked docs, not here.
