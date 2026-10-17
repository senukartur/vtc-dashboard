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

After the owner's Docker installation restart, the following checks passed on Linux containers. [PR #6](https://github.com/senukartur/vtc-dashboard/pull/6) and [VTC-006](https://trello.com/c/wIHfWAYm) record the delivery/review state; a successful unavailable-database path alone is not database proof.

| Check | Observed result |
| --- | --- |
| Development startup | `docker compose up --build -d --wait` built the pinned image and started healthy app/MySQL services |
| Linux quality/build | `pnpm check` and `pnpm build` passed in the app container, including seven scaffold checks and all 160 structural browser fixtures |
| Real MySQL | `pnpm db:check` passed on 8.4.11; an independent connection also verified global/session UTC, InnoDB, isolation and database charset/collation |
| Outage and volume recovery | Liveness stayed available and readiness returned 503 while MySQL was stopped; a synthetic marker survived container recreation on the existing named volume, then was removed; readiness recovered |
| Configuration regression | Restarting the local database with server timezone `SYSTEM` made both readiness and the baseline CLI fail despite session UTC; restoring the configured server timezone recovered both |
| Compose Watch | Reversible API/web edits reached served responses/modules and disappeared after restoration; a shared-package edit recompiled/reloaded into API readiness and also recovered after restoration; manifest edits triggered a rebuild |
| Clean Git checkout | A separate fresh branch clone, private generated environment, distinct project/loopback ports and empty MySQL volume built/started through Compose; its checks, database probe, build and internal/published HTTP smoke passed |
| Production image | The production target built with checks and production-only API packaging; a temporary container served the SPA/assets/API and reached the local database, ran without root, and contained neither `.env` nor the probed development tools |

Two container-specific defects were corrected during verification. MySQL ignored the world-writable Windows-mounted config, so Compose now supplies explicit server arguments and readiness also checks the global timezone/engine. Native Node watch missed transitive TypeScript edits, and filesystem replacement notifications also left a stale process during restoration; `tsx watch` with Chokidar polling passed both directions and shared-package propagation. Watch rules explicitly include test sources and root build/configuration changes. No probe route, modified fixture version or synthetic persistence table is part of the application.

The infrastructure probes are local verification, not feature-level MySQL transaction/authentication tests or browser E2E coverage. VTC-007/008/009/013/015 and feature cards retain those gates. No staging/production service, application quality CI or Hostland compatibility proof is supplied. [Advisory Claude review](review.md) was integrated from PR #7 and is separate from application CI and independent implementation review. Final review/merge and card completion are recorded in PR #6 and Trello; deployment remains a separate task.

## Review corrections

The independent reviewer reproduced an unbounded readiness query against a synthetic loopback MySQL protocol server. The [in-PR advisory review](https://github.com/senukartur/vtc-dashboard/pull/6#issuecomment-6236366282) independently identified that gap, strict parameter decoding, missing safe error diagnostics/status mapping and uncached fingerprinted assets. Corrections add one-second connection/query limits, fail-fast pool acquisition, destruction of failed query connections, separate coercing wire-parameter validators, fixed-field 5xx logs, safe framework status mapping and immutable caching only for versioned JS/CSS assets. New regressions cover stalled handshakes/each query phase, saturation/recovery/shutdown, valid/invalid numeric wire values, safe error records and caching boundaries. The current scaffold suite contains twelve tests plus the existing 160 structural browser examples.

A further independent half-open-peer probe found that pinned mysql2's public `destroy()` removes a pooled connection but calls only `stream.end()`: a peer that keeps its sending side open can retain a client socket after the probe rejects and pool shutdown resolves. A small pinned-driver adapter also destroys the underlying stream. Its child-process regression checks natural process exit after both query timeouts before forced fixture cleanup, so resolving a promise alone cannot hide a leaked socket. This adapter must be rechecked when upgrading mysql2.

The advisory recommendation to accept arbitrary newer MySQL 8.4 patches is not adopted: the approved baseline pins and checks a verified patch across local/CI/staging. Exact-match failure is deliberate drift detection, including untested provider suffixes. A future upgrade must update the shared target and its compatibility evidence together; VTC-041 owns comparing the final provider before cutover. No broad runtime compatibility with untested MySQL builds is claimed. Readiness deadlines also require revalidation on the chosen staging/final network.

## Primary references

- [Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/): synchronize source and rebuild dependency/config changes without sharing platform-specific host dependencies.
- [Official MySQL downloads](https://dev.mysql.com/downloads/mysql/8.4.html) and [8.4 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/): distinguish released downloadable artifacts from advance documentation.
- [Fastify validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) and [Ajv schema dialects](https://ajv.js.org/guide/schema-language): use explicit draft-2020-12 compilation and test the response boundary.
- [Official npm registry](https://registry.npmjs.org/) and [pnpm settings](https://pnpm.io/settings): exact versions/peer constraints and explicit build policy. Resolved versions/integrities are in the root lockfile.
