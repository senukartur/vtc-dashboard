# Contributing

Read [AGENTS.md](AGENTS.md), [CONCEPT.MD](CONCEPT.MD) and the [architecture](docs/architecture/README.md) first. Documentation and explanatory comments are English; the product supports Russian and English.

Project-local engineering skills are available to Codex, Claude Code and authorized subagents; see the [skill registry and handoff rules](docs/development/agent-skills.md).

## Local development with Docker

Docker Compose is the owner's preferred local environment. Use Docker Desktop with **Linux containers**, or Docker Engine with Compose **2.32+**. Windows Docker Desktop requires its working Linux/WSL backend. The application and real MySQL run in containers; host-installed MySQL is not required.

Generate private local configuration once. With any host Node.js 18+:

```sh
node scripts/setup-local.mjs
```

Without host Node, run the same helper in the pinned image (PowerShell and POSIX shells expand `${PWD}`):

```sh
docker run --rm --user node --mount "type=bind,source=${PWD},target=/workspace" --workdir /workspace node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 node scripts/setup-local.mjs
```

The container's `node` user is UID/GID 1000. On native Linux with another host UID/GID, replace `--user node` with `--user "$(id -u):$(id -g)"` so the private file remains readable by its owner. The helper never overwrites an existing `.env` or prints generated passwords. Keep that file private; `.env.example` contains placeholders only.

Start development from the repository root:

```sh
docker compose up --build --watch
```

Open [the local UI](http://127.0.0.1:5173). Compose Watch synchronizes app/package source while the API, TypeScript packages and Vite watch for changes. Dependency/contract/tooling changes trigger a rebuild. Container dependencies are not shared with host `node_modules`. Keep the foreground watch command running; `docker compose up --build -d --wait` is an alternative without live synchronization, followed by `docker compose watch` in a foreground terminal.

The UI is a bilingual development connection screen. Authentication, company pages, jobs and seed accounts remain pending. MySQL starts with an empty application database; VTC-007 adds an explicit audit-only migration and transaction/value primitives through the [persistence commands and recovery runbook](docs/development/persistence.md). Startup never migrates or seeds. [Fixture ownership](test/fixtures/README.md) separates synthetic tests from runtime data.

```sh
docker compose exec app pnpm check
docker compose exec app pnpm db:check
docker compose exec app pnpm smoke:local
docker compose exec app pnpm build
docker compose down
```

`down` preserves the named MySQL volume. Reusing the volume retains its original database users/passwords; editing `.env` does not change existing MySQL credentials. Do not remove a data volume to fix an ordinary connection error. Check the Docker engine, port availability, configuration field names and stored development credentials first. When `.env` changes, recreate the app container; source watch deliberately does not copy secrets.

Only loopback ports are published: UI 5173, API 3000 and MySQL 3307 by default, configurable through `.env`. The API's `/health/live` checks its process; `/health/ready` authenticates to MySQL and checks the pinned version/configuration, returning 503 when unavailable. The MySQL container's ping is only liveness, not the application's authenticated readiness.

The dedicated readiness pool fails immediately when all five slots are busy. Connection/handshake and each of its two queries have a one-second timeout; failed query connections are destroyed rather than reused. A probe therefore has about a three-second operation budget, excluding scheduling delays. The exact MySQL patch check is intentional baseline-drift detection: patch upgrades require updating the shared target and running compatibility checks. VTC-041 must verify the final provider's version/configuration before cutover; readiness does not silently accept an untested patch or provider suffix.

Compose passes the server settings as MySQL command arguments. Do not replace them with a Windows bind-mounted `.cnf`: Docker Desktop exposed that file as world-writable during verification, and MySQL silently skipped its settings after a warning. `deploy/local/mysql.cnf` remains the equivalent portable configuration reference; scaffold checks keep both forms aligned with `config/runtime.json`. Readiness checks server UTC/InnoDB as well as the explicit session UTC.

The API uses `tsx watch`; the Docker app enables Chokidar polling for reliable file replacement events after Compose synchronization. API, web, shared-package and test sources are synchronized; dependency/build/tooling changes have explicit rebuild rules. After changing `compose.yaml` or private environment values, rerun `docker compose up --build -d --wait` and restart the foreground watch command so its rules and service configuration are reloaded.

VTC-007's separate transaction pool has five additional slots when instantiated, with fail-fast acquisition and session reset on every checkout. One readiness pool, one UnitOfWork and one dedicated migration invocation have an aggregate bound of eleven connections; replicas, jobs and competing migrators add their own budgets. The [persistence guide](docs/development/persistence.md#runtime-and-connections) records the complete formula, operation deadlines and command boundaries.

## Native tooling and portable builds

Host editing/typechecking or a future non-Docker deployment uses Node **24.22.0** and pnpm **12.14.0**. Install those versions using your normal runtime manager; `npm install --global pnpm@12.14.0` is one package-manager installation option. Exact versions are recorded in [the shared runtime baseline](config/runtime.json), `.node-version`, the root manifest and container images. The setup helper's Node 18 minimum does not weaken the application runtime pin.

```sh
pnpm install --frozen-lockfile
pnpm contracts:check
pnpm check
pnpm build
```

For native app development with only MySQL in Docker, start `docker compose up db -d --wait` and then `pnpm dev`. The host `.env` defaults to MySQL on loopback port 3307. The default local workflow above keeps the application in Docker too.

For a portable production build, set `NODE_ENV=production`, `SERVE_WEB=true` and the target database variables through the environment or private `.env`, then run `pnpm start` from the repository root. It serves the built SPA and API on one origin. Deep frontend links return the SPA; unknown API/telemetry/evidence paths and missing assets return 404. `pnpm jobs` is a bounded placeholder that reports `not_configured`; VTC-021 supplies durable work. No auth/telemetry route is mounted just because a schema exists.

An optional production image is `docker build --target production -t vtc-dashboard:local .`. It packages only the API's production dependency deployment and built web assets, runs without root and has no embedded secrets. Building it is not staging deployment, a Hostland compatibility test or schema migration. Hostland does not have to support Docker.

## Commands and verification

| Command | Scope |
| --- | --- |
| `pnpm dev:setup` | Create private local configuration if absent |
| `pnpm dev` | Generate contracts/build shared packages, then watch API/web/packages |
| `pnpm contracts:generate` / `pnpm contracts:check` | Regenerate or verify browser types/runtime schemas from the approved OpenAPI |
| `pnpm format` / `pnpm format:check` | Format or check scaffold source/configuration with Biome |
| `pnpm lint` / `pnpm typecheck` | Lint and strict TypeScript checks |
| `pnpm test:scaffold` | Node test runner: HTTP/config/schema-bridge checks, including all reviewed structural browser examples |
| `pnpm check` | Generated-file, format, lint, type and scaffold checks |
| `node scripts/test-ci.mjs` | Safe structured CI wrapper around the same isolated suite; [CI gates and negative probes](docs/development/ci.md) |
| `pnpm test:local` | Owned isolated Docker stack: check/build, Vitest unit/contract/real-MySQL lanes, separate persistence/recovery, desktop/mobile Playwright and failure-reporting proof; see [testing](docs/development/testing.md) |
| `pnpm test:unit` / `pnpm test:contracts` | Native database-independent Vitest lanes after `pnpm build:packages`; Docker remains the network-isolated path |
| `pnpm db:check` | Real authenticated MySQL baseline probe; nonzero on failure |
| `pnpm db:generate` | Sole migration integrator generates/reviews Drizzle SQL/journal and formats metadata |
| `pnpm db:migrate` | Build packages and run explicit dedicated, locked migrations; never reset/seed |
| `pnpm db:test` / `pnpm db:recovery` | Destructive synthetic-only real MySQL checks / separate partial-DDL rehearsal; require the [documented guards](docs/development/persistence.md#explicit-synthetic-verification) |
| `pnpm smoke:local` | Actual local HTTP/module/readiness probe; defaults to the Vite origin |
| `pnpm build` / `pnpm start` | Portable production build / same-origin start |

For a production server on another loopback port, set `SMOKE_BASE_URL` for the smoke command. `SMOKE_EXPECT_READY=false` deliberately tests the unavailable-database path; success in that mode is never database proof. Do not run mutating tests or send real mail/webhooks with production identities.

Generated browser files are committed so frontend/backend owners consume one reviewed baseline. Edit `docs/contracts/dashboard/openapi.json` through a coordinated contract PR, then regenerate. Generated types and JSON Schema 2020-12 stay separate from the frozen telemetry contract. The API uses explicit Ajv 2020 compilers, rejects undeclared fields where the schema closes the object and fails closed on invalid response DTOs. This is structural enforcement, not a replacement for session/permission/domain checks in later cards.

Body and response validation do not coerce types; query, path and header validators decode string wire values using their declared schema types. Unexpected 5xx errors emit only a fixed event/code and the server-generated request ID, without exception text, input or headers. Full observability remains VTC-039. The built server caches fingerprinted JS/CSS assets; HTML, APIs, health, missing files and unversioned assets remain `no-store`.

The existing Node scaffold checks are separate from [VTC-008 test tooling](docs/development/testing.md), GitHub CI of VTC-009 and review enforcement of VTC-010. The synthetic stalled-MySQL protocol fixture tests deadlines, recovery and process exit with a half-open peer, not real MySQL transactions. No native authentication, deployment or game-client integration is proved by HTTP injection. See [the delivery evidence](docs/development/workspace.md).

VTC-007 adds narrow real MySQL transaction/value/audit/migration checks separately from `pnpm check`. Its [persistence guide](docs/development/persistence.md) documents the synthetic database name and reset acknowledgment, production artifact migration command, sticky partial-DDL state and remaining integration gates. Never run the destructive fixture commands against real data.

## Ownership and branches

Use one VTC card and scoped branch per change; preserve unrelated work. Read prerequisites and integration gates in the [backlog](docs/planning/mvp-trello-backlog.md). VTC-006 owns root tooling/lockfile and app composition; feature owners use their module directories and public facades. The migration owner alone generates/orders the Drizzle journal under VTC-007. Coordinate changes to generated contracts, capabilities, root dependencies and shared composition rather than independently regenerating them on parallel branches.

Keep secrets, real reports, extracted game data and host inventory out of Git and PR logs. Inspect the exact staged diff. Relevant checks, independent review, updated English docs and merge are separate completion requirements; a prepared PR does not authorize deployment or mark a feature Done.

Follow the [review and dependency guide](docs/development/review.md). [CODEOWNERS](.github/CODEOWNERS) routes ownership; the [PR template](.github/pull_request_template.md) captures exact-head validation, independent review, Copilot findings and delivery gates. Before merge inspect the latest-head Copilot comments, resolve findings/conversations and require green **Required CI**. Critical changes need review independent of their author; zero mandatory GitHub approval votes do not waive that gate. Rule JSON must be applied and read back before claiming enforcement. Weekly dependency checks include the documented temporary manual pnpm exception; bot PRs receive normal review and checks.

## Agent task delivery

Repository-local manual delivery entrypoints are available for [Codex](.agents/skills/deliver/SKILL.md) and [Claude Code](.claude/skills/deliver/SKILL.md). Follow the relevant entrypoint for invocation and host setup; the [shared workflow](.agents/skills/deliver/references/workflow.md) owns execution, trust, recovery, budgets and publication rules, with [shared role instructions](.agents/skills/deliver/references/roles.md).

The explicit human standing completion scope in [AGENTS.md](AGENTS.md#branches-collaboration-and-review) permits one card at a time through verified review/fixes, normal merge and Trello Done. It does not grant paid setup, deployment, production changes or skipped gates. Without that explicit human authority, the delivery workflow ends at a draft PR.

For first use in Claude Code, start a new session in a checkout containing the native definitions in `.claude/agents/`. Tool enforcement differs by host and is described in the entrypoints; these files do not create a security sandbox.
