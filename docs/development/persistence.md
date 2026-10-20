# VTC-007 persistence foundations

[VTC-007](https://trello.com/c/0Fz7jw4v) adds the local Drizzle/mysql2 transaction, value, audit and migration foundations. Its original `0000` migration contains `audit_entries` plus the migration runner's operational ledger. [VTC-013 identity](identity.md) adds two ordered additive migrations: `0001_mean_masked_marvel.sql` creates auth/member/company/challenge storage, then `0002_acoustic_starfox.sql` adds challenge stage and identity-epoch columns. Apply both in order and follow the [drain-and-reissue rollout gate](identity.md#email-replacement-rollout). Canonical trips and outbox/jobs remain their owners' work. Persistence primitives alone do not establish passing domain scenarios or final-host compatibility.

## Runtime and connections

Pins: Node 24.22.0, pnpm 12.14.0, TypeScript 5.9.3, mysql2 3.24.6, drizzle-orm 0.45.4, drizzle-kit 0.31.11 and real MySQL 8.4.11. Strict dependency/peer policies remain enabled. InnoDB, utf8mb4 labels, UTC and the SQL modes in `requiredSqlModes` are required. Every transaction checkout resets session timezone, modes, isolation, autocommit and connection charset, including reused connections. Isolation is `REPEATABLE-READ`; authorization/concurrency owners must still use locking reads and recheck current state.

Connection budget is **5 readiness + 5 transaction + 1 dedicated migrator = 11** for one instance of each factory and one migration invocation. Pools are lazy; identity-enabled startup also instantiates one shared UnitOfWork. Create one shared UnitOfWork per application process, rather than a pool per repository/request. Across processes the bound is `5 * readiness instances + 5 * UnitOfWork instances + concurrent migration invocations`; jobs and replicas must be added to the deployment budget. A named migration lock does not prevent waiting migrators from opening their own one connection. Final-host privileges and capacity remain VTC-041 gates.

Both pools reject immediately at saturation instead of queuing. Connection/handshake timeout is one second. Readiness retains its separate one-second limits for each of its two queries, approximately three seconds overall excluding scheduling. Transaction initialization uses two queries with one-second deadlines. START TRANSACTION and ROLLBACK each retain one-second wire and independent wall-clock deadlines; COMMIT receipt has a five-second wire and independent wall-clock deadline. The wall bound includes time queued behind unresolved wire work: mysql2 starts its own query timeout only when a command reaches the wire. Callback failure attempts bounded rollback and preserves the original error even if cleanup fails. COMMIT failure discards immediately without queuing rollback; its outcome remains uncertain. The command callback and ordinary repository queries have no automatic overall deadline; owners must keep commands short and bound their operations. Failed initialization/transactions discard the connection and force-close its stream through the pinned mysql2 adapter. Half-open-readiness and transaction/migration cleanup child-process regressions must remain passing on driver upgrades. Close both factories during application shutdown; do not close the shared pool in a repository.

## Transaction participation

Import `createUnitOfWork`, `TxContext` and `createAudit` from `@vtc/db`. `run(command)` begins DML on one checked-out connection, passes an opaque context, commits after the awaited callback succeeds, and attempts rollback on callback failure. Each module owns its repository/schema and gets its Drizzle client through `unit.client(tx)`. Audit uses that same accessor and connection. Foreign, forged and completed contexts are rejected; deferred queries retained past completion also reject at driver execution. Nested autonomous transactions and streaming iterators are unsupported. There is no cross-module generic repository or second-pool participation shortcut.

Await every repository operation inside the callback. Do not launch detached promises, issue DDL/transaction-control SQL through repositories, perform network effects inside the transaction, retain clients/builders, or call an auth API that opens its own connection. These are internal trusted-code boundaries, not a sandbox against a malicious module or DBA. VTC-013 owns auth-schema participation; VTC-021 owns jobs/outbox and network delivery.

Every COMMIT-phase failure throws the root-exported `TransactionCommitOutcomeUnknownError`, with the fixed message/code `TRANSACTION_COMMIT_OUTCOME_UNKNOWN` (also exported as a constant). Its `cause` preserves the original failure for authorized private diagnostics only; never serialize/log the full error or cause into public responses, comments or artifacts. Callback failures retain their original error even if rollback cleanup fails. The distinct commit outcome must not enter a blind transient retry: first verify durable command idempotency/committed-result records or follow an explicitly reviewed recovery workflow. A rejected COMMIT response does not prove that the transaction failed.

VTC-013 focused identity workloads reproduced one-second COMMIT receipt timeouts while the same isolated MySQL 8.4.11 server recorded a COMMIT execution maximum of approximately 2.072 seconds. The aggregate does not identify the failed transaction or establish a storage cause. The five-second receipt budget gives bounded technical headroom over that observed server latency; it is not a throughput or production-latency guarantee. START/ROLLBACK, readiness, pool capacity and automatic-retry policy are unchanged. VTC-011 staging, VTC-039 operational hardening and VTC-041 final-host measurements still own capacity and latency proof; further timeout changes require coordinated failure/recovery evidence.

For authorized internal diagnostics, `databaseFailureContext(error)` returns a copy of fixed operation, configured client `wireDeadlineMs` and observed `elapsedMs`, or `null` when unavailable. It covers connection opening, the two session-initialization queries and individual migration lock/baseline/journal/DDL queries. Private WeakMap metadata preserves the exact original error/cause and its first captured operation; the accessor can find that context through bounded cause traversal. It adds no enumerable error fields or production logging. These client timings do not identify server execution time, cancellation or durable outcome. Test sanitizers may retain this fixed context before replacing private fixture errors; never serialize the native error, SQL, parameters or connection settings. This observability change does not change any deadline or establish the cause of a historical timeout.

## Values and references

| Storage/helper | Contract |
| --- | --- |
| `idColumn` / `applicationId` / `newId` | Server-generated lowercase UUIDv4, exact 36 ASCII bytes in `BINARY(36)`. Organization/company and user references use the identical shape. Do not impose this version rule on external/provider identities. |
| `opaqueColumn` / `opaqueBytes` / `opaqueUtf8` | `VARBINARY(n)`, explicit byte conversion, 1–512 byte technical maximum. No case folding, trimming, Unicode normalization or PAD SPACE collation. UTF-8 conversion rejects lone surrogates; arbitrary hashes may include zero/non-UTF-8 bytes. Module owners select an appropriate bound. |
| Localized labels | Separate utf8mb4 text, default `utf8mb4_0900_ai_ci`. Label matching never establishes opaque identity or rule equivalence. |
| `utcColumn` / `utcDateTime` / `utcIso` | `DATETIME(3)`, explicit offset-bearing ISO input and canonical ISO UTC reads. Offset input is converted once to UTC. Reject invalid calendar values, offset-free times and precision beyond milliseconds. Supported stored years are 1000–9999. No company reporting timezone default is inferred. |
| `bigintColumn` / `signedBigint` | Signed 64-bit canonical decimal **strings**, including values beyond JS safe integers. mysql2 keeps BIGINT results as strings. External unsigned IDs retain their own contract/byte representation. |
| `decimalColumn` / `decimal38_18` | Signed technical `DECIMAL(38,18)` envelope: at most 20 integer and 18 fraction digits; strings only, no exponent, no float conversion. Reject excess precision/range before insert. MySQL may pad fractions on reads; never use MySQL's fractional rounding as validation. |

The decimal envelope is storage capacity, not company mass, promotion or reporting policy. This card supplies no business arithmetic implementation. Keep unavailable values distinct from zero, and preserve source/confirmation/acceptance times as separate facts in future module schemas.

Audit retains opaque historical references without premature FKs to nonexistent auth/company/trip tables. Feature owners must coordinate real restrictive FKs and retention/tombstones when those tables exist; never cascade-delete historical audit/trip history to delete an account. Synthetic parent/child tests demonstrate actual unique/FK rejection and restrictive deletion without shipping feature schema.

## Audit contract and exclusions

`createAudit(unit).append(tx, input)` requires an active transaction and generates its own ID. Input has exactly `actorKind`, `actorId`, `operation`, `subjectKind`, `subjectId`, `occurredAt`, `reason` and optional `companyId`. A user actor requires an application ID; system actor requires `actorId: null`. Company scope, when supplied by a module, must also be an application ID. The subject reference and occurrence instant are required.

The code registry in `packages/db/src/schema/audit.ts` is closed and runtime validated: operations `configuration.changed`, `membership.changed`, `report.reviewed`, `leadership.transferred`, `catalog.published`; subjects `company`, `user`, `trip`, `catalog`; reasons `operator_request`, `staff_review`, `initial_setup`, `catalog_update`. Adding a code is a reviewed source/schema contract change; these registered names do not implement or authorize those workflows. The module determines actor authorization, safe attribution time and reason eligibility. There is no user-supplied actor trust or audit-read endpoint.

Unknown fields and unregistered codes fail before insert. No arbitrary JSON, before/after snapshot, free-text reason, email, password, token, reset/invitation/transfer code, raw telemetry, request/header, exception or evidence payload is accepted. Private report/decline details remain in their permission-filtered owners. Indexes support subject/time and actor/time lookups; primary IDs are unique. The package root omits the writable `auditEntries` table; `createAudit(...).append` is the supported mutation facade, with no update/delete primitive or public schema subpath. Internal schema access remains an owning-module/test convention; this facade is not a SQL sandbox or administrator-proof immutability. Separate least-privilege runtime/migration grants and production retention/restore proof remain VTC-039/041. Never log raw Drizzle/mysql2 errors: they may contain SQL and bound parameters.

## Migration ownership and commands

One migration integrator generates/orders the journal after coordinating module schema changes. Use `pnpm db:generate`, review **all** SQL and snapshot/journal changes, and run real MySQL tests. The root command formats generated metadata deterministically. `packages/db/drizzle.config.ts` explicitly includes audit and identity schemas; the integrator adds future module schemas explicitly. Review InnoDB/charset, indexes, exact comparisons, reference lengths, nullable uniqueness, FKs, MySQL's lack of generic `RETURNING` and implicit DDL commits. SQL explicitly declares engine/charset/collation after generation; regeneration without schema changes must leave committed assets unchanged.

Never edit an applied/published migration or run `drizzle-kit push`/an auth automigrator. Use additive changes compatible with the currently running app; destructive removal needs its own reviewed rollout and recovery plan. Application startup, install and development setup never migrate, reset or seed.

From the root after installing/building:

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:migrate
```

For the Docker development environment:

```sh
docker compose exec app pnpm db:migrate
```

The runner reads packaged Drizzle SQL and `meta/_journal.json`, opens a **dedicated** mysql2 connection, acquires a database-scoped hashed `GET_LOCK` before journal access/application, and force-closes that single-purpose connection in `finally`. Disconnect releases its named lock when processed by MySQL. It never queues `RELEASE_LOCK` after a potentially unresolved command; that cleanup query's mysql2 timeout would not start while still queued. Default lock wait is five seconds (programmatic maximum 30); the wire deadline is wait plus two seconds. Each migration statement has a 30-second wire deadline (programmatic bounds 100–300000 ms). Case-folded lock names conservatively serialize database-name aliases. The runner verifies the pinned baseline, strict session and ordered journal. It validates the entire recorded prefix by version and SHA-256 checksum, rejects missing/modified history, writes durable `applying` before SQL, then `applied` only after success. This operational `_vtc_migrations` ledger intentionally extends the generated Drizzle assets rather than using the upstream applied-only ledger. Do not mix this runner with the upstream Drizzle migrator.

The lock coordinates participating migrators only. Stop competing deploys, other schema tools and incompatible app traffic operationally; it is not a deployment mutex against arbitrary clients. On a failed/lost connection, server-side work/lock release may lag until MySQL notices the disconnect. Query deadlines do not prove server cancellation. Inspect server state before another operator proceeds.

`packages/db/package.json` ships built JS/declarations, SQL and the runtime journal; generation snapshots/config/TypeScript/test seeds are unnecessary at runtime. A production API deployment created with `pnpm --filter @vtc/api deploy --prod --legacy <output>` or the production Docker target can run, from its artifact root:

```sh
node node_modules/@vtc/db/dist/migrate-cli.js
```

For a production container: `docker run --rm --env-file <private-runtime-env> <reviewed-image> node node_modules/@vtc/db/dist/migrate-cli.js`, with the separately approved network/access configuration. This command needs environment configuration only; no global pnpm, workspace, source tree or drizzle-kit. Root `pnpm db:migrate` is a contributor command and rebuilds packages first. The CLI emits fixed event/category fields and an applied count; it does not print credentials or raw driver diagnostics.

## Partial-DDL recovery runbook

1. Stop migration/deploy competitors and incompatible traffic. Preserve the failed revision, SQL/checksums and private operational diagnostics. Protect backups and evidence from public logs/artifacts.
2. Inspect actual MySQL tables/indexes/constraints and `_vtc_migrations` under authorized private access. An `applying` row is intentionally sticky; an earlier DDL statement may already have committed. A journal checksum pass does not detect arbitrary schema drift.
3. Restore a tested **consistent** pre-deployment database and related evidence backup, including matching migration history; alternatively prepare and independently review a forward repair against the observed partial schema. Verify every affected statement/constraint/data transformation before any explicit operator journal reconciliation. Never automatically stamp success, delete the dirty marker to replay blindly, rewrite published SQL, or describe DML rollback as DDL rollback.
4. Verify schema/history agreement, sentinel/domain consistency and the application's compatibility, then run the runner and readiness/smoke checks. Record exact revision and sanitized evidence before resuming traffic. If outcomes are uncertain, preserve state and stop for recovery rather than retrying a non-idempotent command.

The separate fixture rehearsal below restores an **empty synthetic pre-deploy baseline** by dropping its fixed fixture tables/journal, then applies the reviewed production migration. It is deliberately not a general-purpose production restore tool, backup export test or proof of evidence/file restoration. Production backup/restore and forward-repair execution remain VTC-041 gates.

## Explicit synthetic verification

VTC-008 now supplies the [isolated test launcher](testing.md). Run these destructive fixtures only through its fresh per-lane schema/user, canonical baseline, explicit reset acknowledgment and suite ownership lock. A synthetic name and test mode alone are insufficient; ordinary native commands cannot fall back to a development environment. The provisioner creates/drops only its own allocated schema; fixture reset still drops only fixed tables and never disables FKs. Temporary combined migration assets remain ignored and are removed after use.

```sh
pnpm test:local persistence
pnpm test:local recovery
```

The launcher runs `pnpm db:test` and `pnpm db:recovery` internally as separate protected Node lanes. `db:test` checks empty/replayed and committed-prior-fixture additive migration, sentinel preservation, checksum drift, atomic audit/domain commit/rollback, context lifetime/foreign contexts, multiple/reused/tampered sessions, pool saturation/recovery, actual unique/FK/restrictive deletion, exact case/accent/composed Unicode/trailing-space keys, RU/EN/four-byte labels, bigint/decimal values, invalid precision, UTC in another process timezone, rejected private audit inputs, bounded lock contention/disconnect and concurrent fresh migration without duplicate apply. `db:recovery` separately proves persisted earlier DDL, durable dirty state, refusal to replay, released lock and restored-baseline application/replay. Its bounded real MySQL `SLEEP(2)` migration also verifies prompt local timeout rejection, preservation of the `applying` marker and refusal to replay after the server processes disconnect/lock release.

`pnpm check` additionally runs nine database-independent synthetic protocol regressions for delayed, late, stalled and server-error COMMIT, rollback, queued rollback and migration baseline/statement/final-journal operations. A 2.3-second COMMIT acknowledgement completes exactly once; a response after five seconds remains unknown. Half-open cases assert natural child-process exit, bounded rejection, socket disposal and recovered transaction-pool capacity before peer cleanup. COMMIT cases verify the distinct outcome class/code and original cause with safe top-level fields; callback failures retain their original error identity and one-second rollback bounds. A separate public-surface test verifies that audit append is exposed while the writable table is absent. The timeout tests exposed the original queued-cleanup hang on the initial implementation before correction; they are not substitutes for the guarded real MySQL dirty-state/DDL cases.

The migration success-serialization fixture explicitly allows a 15-second lock wait through the existing bounded option, because full fixture application has measured above the runtime default five-second wait. It waits for both started callers to settle before asserting results or resetting/closing resources, retaining fixed safe caller/phase/timing diagnostics on failure. This fixture allowance does not change the runtime default five-second lock wait or 30-second maximum. Deliberate one-second lock denial, two-second disconnect release, exactly-once application/history assertions and the enclosing test deadline remain unchanged.

## Evidence and remaining gates

During the original persistence implementation on 2026-10-17, native pinned tooling passed strict typechecking/build and the real isolated MySQL persistence and separate recovery suites. These were narrow persistence checks, not VTC-008's broader test platform or passing E2E scenarios 7, 9, 10, 25, 26, 27, 29, 33, 35, 38, 40 or 41. They supported downstream invariants without implementing their workflows; application CI and identity integration were pending at that historical point.

The current [CI guide](ci.md) and [review guide](review.md) describe the subsequently configured PR/main checks and separate Claude advisory path; [identity foundations](identity.md) describe the subsequent auth/member schema integration. Current acceptance still requires checks and independent risk review for the exact final candidate. The delivery report/PR retains failed attempts, unrun lanes and current coverage; a later focused pass does not replace a failed required check. Staging capacity, durable outbox/jobs and final-host privileges/restore/transfer remain their respective VTC-011/021/041 gates. This historical evidence does not claim hosted deployment, production acceptance or a live migration.

Primary references: [Drizzle mysql2 setup](https://orm.drizzle.team/docs/mysql/get-started-mysql), [MySQL locking functions](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html), [implicit commits](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html) and [binary strings](https://dev.mysql.com/doc/refman/8.4/en/binary-varbinary.html). Pinned installed source behavior is additionally exercised by the integration checks.


VTC-021 adds reviewed migration 0003 for outbox_events, durable_jobs, job_effect_receipts and job_runner_leases. The immutable published 0000–0002 prefix is preserved. [Jobs](jobs.md) documents exact binary identities, claim indexes, transaction fences and retention. Worker/runtime table grants and existing-installation application are prepared in the [operations runbook](../operations/development.md#durable-jobs-existing-installation-update-and-acceptance); source merge does not apply them. The runtime Drizzle config now also explicitly includes the platform schema.

VTC-014 adds serialized migration 0004_windy_ravenous for private mail_deliveries and actor-scoped safe mail_commands. The published 0000–0003 prefix remains byte-identical. MEDIUMTEXT stores authenticated encrypted requests, with exact binary generation uniqueness and bounded expiry/idempotency cleanup indexes. The nullable payload_expires_at eligibility deadline is cleared atomically with ciphertext and excludes retained safe history from the expiry range. No domain/history cascade or startup migration is introduced. The persistence lane explicitly upgrades the four-migration published prefix and preserves its sentinel/checksums; recovery still uses the separate guarded synthetic schema. [Mail operations](../operations/email.md) owns key handling and activation gates.

## Admissions additive schema

VTC-015 adds serialized migration `0005_admissions` for admissions applications/decisions/invitations, fixed abuse slots, bounded command results and the qualifications-owned initial Trainee assignment seam. Published 0000–0004 SQL remains byte-identical. The audit subject enum is extended additively. Restrictive foreign keys retain structured history; nullable exact `open_email` enforces one reviewable/approved-awaiting-redemption application per lowercase email, independently of receipt idempotency. Hash/ciphertext/result eligibility has bounded indexed cleanup. The explicit guarded persistence lane upgrades the five-migration published prefix and preserves its sentinel and checksums; recovery still uses its separate synthetic schema. These migrations are prepared source changes, never a live application claim. [Admissions](admissions.md) documents ownership, lock order, expiry, private result retention and the narrow VTC-028 extension boundary.

## External identities additive schema

VTC-018 adds `0006_nervous_daredevil` for permanent Steam ownership, unique current links, session/epoch-bound proof generations, globally unique nonce hashes, immutable private change history and a fenced basic TruckersMP cache. Published 0000–0005 bytes and the journal prefix remain unchanged. Restrictive foreign keys, exact ASCII provider keys, UTC millisecond dates and short explicit FK names follow the target MySQL limits. The guarded persistence lane upgrades the exact six-migration prefix, preserves member/audit sentinels and verifies existing members stay unlinked. Fixed reset order drops external children before identity parents. [External identities](external-identities.md) describes cleanup, synchronous credential eligibility and explicit provider activation; the same sticky partial-DDL recovery procedure applies. No live migration is claimed.

## Catalog additive schema

VTC-019 adds the single serialized 0007 catalog migration, preserving published 0000–0006 SQL. Fourteen catalog-owned tables store exact scoped identities, immutable facts/typed relations, coverage/review evidence and private bounded artifacts/operations. Staged candidates remain inaccessible until finalization; publication pointer/audit/outbox share one transaction. The guarded persistence lane rehearses the exact seven-migration prefix upgrade. [Catalogs](catalogs.md) describes worker cursor recovery, private byte expiry and pending real-data/operational acceptance. No live migration/grants are applied by source merge.
