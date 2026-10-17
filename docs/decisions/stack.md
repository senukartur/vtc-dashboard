# VTC-005: stack and architecture direction

**Date:** 2026-10-17. **Status:** selected implementation direction; independent review and adoption are recorded in [PR #5](https://github.com/senukartur/vtc-dashboard/pull/5) and VTC-005. Product requirements and the two-stage deployment are already approved; this ADR selects the concrete development direction and records implementation gates.

## Decision

Use a **TypeScript modular monolith** with React/Vite on the web and Fastify on Node.js 24. Use MySQL 8.4/InnoDB through **Drizzle's MySQL dialect and mysql2**, with Better Auth behind a narrow project-owned authentication facade. Keep one same-origin HTTP service, a standalone bounded jobs CLI, persistent private files and a MySQL transactional outbox. Frontend permissions are presentation hints; server ownership/action guards are authoritative.

Start development on the separately budgeted staging design from [VTC-004](hosting.md). Docker Compose may package staging; the application also has a normal Node entry and independent CLI for eventual Passenger deployment. Local/CI/staging development does not wait for Hostland access. VTC-041 verifies the actual final host after VTC-040 and before cutover. No cloud account, root scaffold, workflow or deployed service is delivered by this ADR.

## Version selection and evidence

| Layer | Selected development baseline | Evidence / remaining gate |
| --- | --- | --- |
| Runtime | Node.js **24.22.0**, maintained 24.x line | Official archive SHA-256 checked; isolated Windows runtime probe. Linux/CI and later Hostland execution are not proved |
| API | Fastify **5.12.7** | Injected request/response smoke; actual TLS/proxy/session behavior later |
| Database access | drizzle-orm **0.45.4**, drizzle-kit **0.31.11**, mysql2 **3.24.6** | MySQL SQL generation and adapter imports; **no live DB**. Use `provider:"mysql"`, Drizzle `mode:"default"`, and explicit auth schema mapping |
| Auth | better-auth **1.7.10**, @better-auth/drizzle-adapter **1.7.10** | Matching adapter initialized and disabled HTTP signup rejected; real sign-in, owned auth-schema writes and invitation atomicity remain VTC-013/015 |
| Web | React/react-dom **19.3.1**, Vite **8.3.4**; root TypeScript **5.9.3** under VTC-006 | VTC-005 probed only the TS 7.0.2 CLI; VTC-006 uses 5.9.3 to satisfy openapi-typescript 7.13.0's declared `^5.x` peer, with strict root type/build checks. See the workspace evidence below |
| Queries / forms | @tanstack/react-query **5.104.3**, Zod **4.6.7** | Runtime probe. React Hook Form/resolver integration is VTC-006/012 |
| Web composition | react-router-dom **7.18.4**, Tailwind **4.3.3**, Recharts **3.10.1**, i18next **26.4.7**, react-i18next **17.0.21**, react-hook-form **7.90.0**, @hookform/resolvers **5.9.2**, @vitejs/plugin-react **6.1.2** | Observed official registry peer/version metadata, not installed app integration. Pin/test these in the root VTC-006 setup; update via a reviewed compatibility change if needed |
| UI primitives | Project-owned shadcn/ui components | VTC-012 imports/reviews chosen components and accessibility/RU–EN layouts; no new UI toolkit or mock UI is claimed |
| Root tooling / tests | pnpm **12.14.0** candidate; Vitest **5.0.5**, Playwright **1.64.1** candidates | Registry/runtime requirements reviewed; actual root lockfile/toolchain and test configuration remain VTC-006/008/009 |

The [isolated probe](../../spikes/architecture/README.md) has its own npm lockfile; it is **not** the root application dependency baseline. VTC-006 owns root package-manager installation, lockfile, scripts, strict TypeScript configuration, React/Vite plugin integration and contract generation. Keep dependency updates deliberate; no floating `latest` tag in implemented CI/deployment. The [compatibility record](../research/stack-compatibility.md) distinguishes measured checks from metadata and deferred tests.

The [VTC-006 workspace baseline](../development/workspace.md) records the actual root lockfile, Docker-first local workflow, generated contract/compiler bridge and scaffold verification. It supersedes candidate-only tooling choices where explicitly stated; the isolated research record remains unchanged. Drizzle schema/migrations, Better Auth, full form/chart/shadcn integration, CI and hosted proof remain their owning implementation cards.

## Auth integration and atomic creation

Expose only project-owned `/api/v1/auth/*` and identity commands. Do not mount Better Auth's generic route tree or admin plugin: standalone signup, credential/email mutation and role administration must not bypass the invitation-only flow, active membership, protected director channel or app CSRF rules. Use its credential hashing, verification and session engine behind the facade; preserve all needed Set-Cookie headers and explicitly configure origin/proxy/cookie policy.

For invitation redemption, compute the configured auth hash before locks. Identity's **private version-pinned auth-schema repository** inserts the auth user/credential on the supplied Drizzle transaction alongside membership, initial assignments, invitation consumption, audit and outbox. Do not call an independently committing library signup API inside an outer transaction. No automatic session or fake email verification is issued by redemption. VTC-013/015 must prove that normal Better Auth sign-in reads this exact schema/hash mapping and that partial auth creation fully rolls back on real MySQL. An unsupported integration requires a reviewed ADR change, not a silent non-atomic fallback or custom cryptography.

Exactly one Director is derived from the singleton company pointer after bootstrap, separate from additive roles and per-game qualifications. Generic role APIs cannot assign/remove Director. Current active membership/access epoch is checked on every protected operation; cookie caches cannot preserve revoked privileges.

## Contract and persistence decisions

The [OpenAPI browser contract](../contracts/dashboard/openapi.json), [API rules](../contracts/dashboard/README.md), [module map](../architecture/modules.md) and [transaction boundaries](../architecture/data-and-transactions.md) define the implementation interfaces. Browser input/output types are generated/reviewed from that contract; form-specific Zod validation must not become a competing wire schema. Fastify's default schema dialect is not assumed to consume an entire OpenAPI 3.1 document: VTC-006/008 wire and test the schema compiler/serializer, including null/union/ref behavior and response projection.

Use application UUIDs, explicit UTC/millisecond dates, exact quantity strings and binary comparison for opaque keys. MySQL row locks/unique constraints protect concurrent review, idempotency, promotion and singleton succession. Commit domain state and outbox together; consumers handle at-least-once delivery through effect keys and contribution versions. MySQL implicit DDL commits require reviewed migrations/forward repair and tested restore, not a promised transactional schema rollback.

Published catalog/rule versions and manual/source evidence are immutable. Missing/ambiguous facts require review, not a translated-name guess or automatic violation. A pending correction does not replace a confirmed acceptance until staff acts; no correction/reconciliation double-counts or automatically demotes. Preserve telemetry's separately frozen IDs, shape, durable receipts and historical timing.

## Alternatives and boundaries

- Express is familiar to the owner, but Fastify provides an explicit route/schema/serialization boundary and has a successful bounded runtime probe here. No second backend is introduced.
- A custom password/session system would add security-sensitive implementation; reuse Better Auth's engine with the narrow owned-schema integration and real-DB gates above.
- PostgreSQL, Redis, microservices and per-second telemetry persistence are outside the selected MVP architecture. Browser and telemetry APIs have separate authentication/version/error semantics.
- Full Trucky/VTCBase adapters, Web Push, visas/points and server-to-client telemetry restoration remain deferred. The extensible ports do not mark those integrations implemented.

Remaining runtime/database/auth/serializer/integration gates belong to VTC-006/007/008/009/013/015/018/019/021 and feature cards; actual staging is VTC-011 and final Hostland proof is VTC-041. Specification adoption through VTC-005 review/merge does not complete those gates.
