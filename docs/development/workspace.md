# VTC-006 workspace baseline

**Scope:** repository scaffold and reproducible local development. [CONTRIBUTING.md](../../CONTRIBUTING.md) is the command reference. The owner selected Docker for local development; production remains portable Node.js with final Hostland verification in VTC-041.

## Implementation and ownership

| Path | Responsibility |
| --- | --- |
| `apps/api/src/app.ts` | Fastify construction without listening; health routes, safe error boundary, schema compilers and optional built SPA |
| `apps/api/src/server.ts` | Validated startup, listening and signal shutdown |
| `apps/api/src/jobs.ts` | Explicit bounded placeholder; durable jobs belong to VTC-021 |
| `apps/api/src/modules/`, `use-cases/`, `platform/` | Domain ownership, cross-module coordination and infrastructure boundaries |
| `apps/web/src/app/`, `features/`, `shared/` | React router/providers, future feature UI and localization/styles |
| `packages/contracts/` | Generated OpenAPI browser types, reference-preserving JSON Schema 2020-12 and shared health DTO |
| `packages/db/` | Small authenticated readiness pool; no domain/auth schema or migrations yet |
| `config/runtime.json`, `deploy/local/mysql.cnf` | Common runtime/database target for local, later CI and deployment integration |
| `compose.yaml`, `Dockerfile` | Docker local app/database with Compose Watch and optional production artifact |
| `test/scaffold/` | Narrow configuration, HTTP and runtime schema bridge checks |

## Concrete dependency decision

Core Node/Fastify/React/Vite/mysql2 versions follow VTC-005. The root compiler is **TypeScript 5.9.3**, replacing the research-only 7.0.2 CLI candidate: selected `openapi-typescript` 7.13.0 declares a `^5.x` peer. The root installs with strict peer checks rather than ignoring that conflict. VTC-005's isolated probe remains historical evidence and is not silently rewritten. VTC-012 still owns shadcn/ui, full form/chart/design integration; VTC-007 owns Drizzle schema/migrations and VTC-013 owns Better Auth integration.

pnpm **12.14.0** has a native executable. Normal npm installation needs its own lifecycle scripts enabled so Windows command shims point to that executable; blocking pnpm's installation scripts leaves the shell placeholder unsuitable for nested Windows scripts. Workspace dependency builds permit only the explicitly reviewed esbuild installer. pnpm's release-age exclusion is limited to the exact ADR-selected `react-i18next@17.0.21`; strict age policy prevents silently extending it to newly resolved packages. This is not a dependency vulnerability audit.

MySQL **8.4.11** is pinned by an available official image digest, alongside the Node image digest. MySQL's release-note index also mentions an unavailable 8.4.12 image; an index entry alone is not proof that a downloadable image exists. The local server uses utf8mb4/`utf8mb4_0900_ai_ci`, UTC, `REPEATABLE-READ` and the committed strict SQL modes. Readiness verifies authenticated execution and those settings, not merely an open socket. This baseline does not prove binary-ID schema comparison, transaction correctness or final Hostland configuration.

## Verification record

The initial host checks passed installation, browser contract generation, native production build, strict typechecking and seven scaffold tests. The runtime schema engine accepted all 160 reviewed structural browser fixtures. HTTP tests cover database-unavailable readiness, union/null/reference handling without coercion, rejection of extra private response fields and SPA fallback boundaries. These checks contain synthetic values and do not connect to a real database.

A fresh ignored source copy, without existing dependencies/build output/private configuration, passed frozen-lockfile installation and production build. Its real Node HTTP process served the SPA and module assets, returned 404 for unimplemented API routes and 503 for unavailable MySQL as expected. The clean-source smoke exposed and fixed the static directory/root route handling. The web build explicitly selects production mode even inside the development container, and Tailwind scanning is limited to frontend source so private working copies cannot change generated CSS. Production-only API packaging through `pnpm deploy --prod --legacy` also passed on the host; this is not a Linux container execution result.

Docker Compose configuration passed `docker compose config --quiet`. Docker Desktop was installed during this card, but its Linux engine requires an owner-completed system restart. Consequently image build, real MySQL readiness, source synchronization, persistence and production-container execution remain unverified; VTC-006 must stay In Progress. Resume these checks after the engine is available. Native clean-source installation/build and portable HTTP evidence are recorded in the PR/Trello when executed; a successful unavailable-database path is not real MySQL proof. No production/staging deployment, domain fixtures, CI workflow or independent review is supplied by this scaffold alone.

## Resume after Docker installation restart

1. Confirm Docker Desktop's Linux engine responds to `docker info`.
2. Keep the generated private `.env`; `node scripts/setup-local.mjs` is safe to repeat and does not overwrite it.
3. Run `docker compose up --build -d --wait`, then execute `pnpm check`, `pnpm db:check` and `pnpm smoke:local` inside the app container.
4. Exercise Compose Watch with a reversible source edit and verify the UI/API updates; confirm database readiness recovers after a database-container recreation with its existing volume.
5. Build the production image and verify its HTTP/assets/readiness with explicit production variables and the same local MySQL network; inspect production-only packaging and stop temporary probe containers.
6. Record actual outcomes, correct any Linux/Docker differences, then obtain independent final-head review before merge/Done. No independent review or merge is authorized merely by this scaffold request.

## Primary references

- [Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/): synchronize source and rebuild dependency/config changes without sharing platform-specific host dependencies.
- [Official MySQL downloads](https://dev.mysql.com/downloads/mysql/8.4.html) and [8.4 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/): distinguish released downloadable artifacts from advance documentation.
- [Fastify validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) and [Ajv schema dialects](https://ajv.js.org/guide/schema-language): use explicit draft-2020-12 compilation and test the response boundary.
- [Official npm registry](https://registry.npmjs.org/) and [pnpm settings](https://pnpm.io/settings): exact versions/peer constraints and explicit build policy. Resolved versions/integrities are in the root lockfile.
