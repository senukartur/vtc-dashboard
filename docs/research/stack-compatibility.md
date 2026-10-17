# VTC-005 compatibility evidence

**Observed:** 2026-10-17. **Scope:** package metadata and an isolated synthetic Windows Node.js probe. No live MySQL server, real account, mail provider, app, CI workflow, deployment or hosting settings were used. The [stack ADR](../decisions/stack.md) records selected versions and implementation gates.

## What actually ran

The official Node.js **24.22.0** Windows archive was downloaded into ignored local research storage, verified against the vendor's published SHA-256 list and extracted without a global install. The [isolated npm manifest/lock](../../spikes/architecture/package.json) resolved its exact versions without peer overrides. Reproduction is in the [probe README](../../spikes/architecture/README.md).

`check.mjs` passed:

1. Fastify 5 request injection and JSON-schema response serialization.
2. Drizzle/mysql2 mock **SQL generation**, with a parameterized MySQL query; no connection or transaction execution.
3. Better Auth 1.7.10 plus its matching separate Drizzle adapter initialized against synthetic MySQL auth tables; its configured password hasher verified a synthetic password and rejected a different password, and its disabled HTTP signup route returned 404 before any database work. No password/hash is printed or stored outside the running probe.
4. React server rendering, React Query cache and Zod validation.
5. A small Vite production bundle generated in an isolated temporary directory.

The TypeScript 7.0.2 CLI also reported its pinned version. This does not type-check a real application or test React/Vite plugin behavior, forms/charts/localization/accessibility, cookies or browser sessions.

The first probe exposed two setup requirements: pass explicit `mode:"default"` when supplying a MySQL Drizzle schema, and map all expected auth tables rather than assuming a table-less adapter initialization proves compatibility. The committed fixture supplies those tables only for initialization; it is not the reviewed production auth schema. A library signup route blocked by configuration is not proof that our application facade or invitation transaction is secure.

Package registry metadata supplied exact candidate versions/peer constraints for the remaining UI/tooling packages in the ADR. They are not represented as installed/tested app dependencies. npm reported deprecated transitive Drizzle-kit research dependencies; this was not a vulnerability audit or a demonstrated runtime failure. VTC-010 owns dependency hygiene; do not upgrade the selected ORM/auth combination independently without rechecking it.

## Contract checks

The [OpenAPI](../contracts/dashboard/openapi.json) is validated with the isolated pinned Python tooling; its [fixtures](../contracts/dashboard/examples.json) are fictional structural/UI examples. The validator checks references, operation ownership/path parameters, browser CSRF/session annotations, successful/error shapes, intentionally invalid manual/role/RSVP/quantity payloads, public DTO field separation and declared critical action guards. These checks are not application unit/E2E tests or proof that a server enforces those guards.

## Required implementation evidence

| Gate | Owner and required proof |
| --- | --- |
| Root toolchain / Linux | VTC-006/009: maintained Node/pnpm pin, lockfile, strict TypeScript, React/Vite/Tailwind integration, schema generation/compiler and Linux build/native dependency checks |
| Real MySQL | VTC-007/008: actual 8.4, engine/collation/SQL mode/UTC/isolation settings, parameter/decimal/ID round-trip, unique/FK constraints, concurrent claims/commands and partial DDL recovery |
| Auth engine + owned schema | VTC-013/015: real sign-in against transaction-created credential rows, all Set-Cookie headers, CSRF/origin, no native route bypass, revocation and director-channel protection; two invitation redeemers, rollback/reissue/response-loss races and no session before commit |
| Catalog/source normalization | VTC-018/019/024: verified identity ownership, exact provider mappings/build context, all official-DLC and permitted-use coverage; missing facts remain unknown |
| Jobs / contributions / notifications | VTC-021/029/036/037/040: actual MySQL leases/effect keys/versioned contributions, review invariants, recipient privacy, polling recovery and measured end-to-end timing |
| Hosting | VTC-011: synthetic staging infrastructure; VTC-041: actual Passenger/Node/MySQL/cron/files/restore/cost after integrated tests |

No live MySQL proof was attempted through another engine or represented by the mock SQL check. Schema/auth CLI generation and migrations remain VTC-007/013 work. Actual root dependency pins may change through reviewed compatibility work before scaffold merge; this evidence remains dated and bounded.

## Primary references

- [Official Node.js release index](https://nodejs.org/dist/index.json) and [24.22.0 checksums](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt).
- [Fastify v5 requirements and complete JSON schemas](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/).
- [Drizzle MySQL/mysql2 setup](https://orm.drizzle.team/docs/mysql/get-started-mysql) and [transactions](https://orm.drizzle.team/docs/transactions).
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Fastify integration](https://better-auth.com/docs/integrations/fastify), [options](https://better-auth.com/docs/reference/options) and [database schema](https://better-auth.com/docs/concepts/database).
- [MySQL 8.4 locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).
- [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html).
- Exact package metadata is from the official [npm registry](https://registry.npmjs.org/), not a copied third-party compatibility claim.
