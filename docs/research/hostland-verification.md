# Isolated Hostland verification plan

**Status:** prepared, not executed. **Owner:** VTC-004; later deployment/recovery owners VTC-011/041. Read the [findings](hosting.md), [proposed decision](../decisions/hosting.md) and [unsent provider questions](hostland-provider-questions.md).

## Scope before execution

Use a specifically approved temporary hostname/application directory, new empty database and dedicated test database user. Keep all existing domains, PHP/Node settings, databases, cron entries, DNS, certificates and deployed files unchanged. Creation of that isolated setup, credentials and deployment must be explicitly authorized before execution; read-only panel inspection is not a deployed proof.

Prepare a small reviewed artifact using the intended Fastify and mysql2 versions once the runtime/release decision is resolved. It contains a single `server.js` entry, a readiness endpoint, a synthetic MySQL smoke, a bounded CLI job, one private synthetic file and an optional short SSE probe. It must have no real driver data, email sends, telemetry tokens or production integrations. This document specifies that artifact; it does not claim one has been built or tested.

Keep logs/results in ignored private evidence, including actual versions, settings, runtime paths and server metadata. Public reports record only checks/results and sanitized target-compatibility decisions. Diagnostic HTTP routes must not expose environment variables, connection strings, server/account identity, schema inventory or stack traces. Use private operator access; any credential remains outside the public artifact.

## Proof matrix

| Check | Concrete procedure | Required evidence |
| --- | --- | --- |
| PROBE-01 | Verify approved hostname/empty database and available quotas/cost before upload | Isolated targets confirmed; no paid changes or collision with existing services |
| PROBE-02 | Capture actual `process.version`, platform/architecture, runtime/Passenger startup; serve one Fastify HTTPS request | Correct maintained Node.js 24 process, release ID and no public diagnostics |
| PROBE-03 | Stop/restart via the documented marker; revisit after idle and inspect a private startup marker | Cold start/restart succeed; no dependence on permanent in-memory state |
| PROBE-04 | Connect with mysql2 using the intended authentication/TLS; run the metadata SQL below privately | Actual maintained MySQL release, InnoDB, SQL modes, collation/timezone/isolation, pool/packet limits and privileges |
| PROBE-05 | In the new test database only, create a tiny InnoDB table and exercise insert/rollback/unique/FK/UTF-8/UTC/exact-ID behavior; repeat a migration and inject one DDL failure | DML rollback and constraints proven; DDL partial-failure recovery recorded without claiming transactional schema rollback |
| PROBE-06 | Start two isolated MySQL workers against the same synthetic job lease and kill one after claim | One effective result, bounded lease recovery and no duplicate effect; this is a minimal host proof, not full domain integration coverage |
| PROBE-07 | Run a tiny cron CLI heartbeat every minute for at least five invocations with no web visits, then one synthetic durable job | Measured start times, no overlapping effective job, bounded CPU/wall/memory and later catch-up after an intentionally skipped invocation |
| PROBE-08 | Write a small private synthetic evidence file; deploy/restart and read it through operator-only access | Persistence, correct permissions and rejection through public static/SPA routes |
| PROBE-09 | Optional: send short synthetic SSE heartbeat frames through actual HTTPS proxy, reconnect and exercise multiple tabs | Individual frames visible before connection close; timeout/buffering/capacity measured. SSE remains unknown if not run |
| PROBE-10 | Test 64 KiB telemetry-shaped body bounds and short authenticated polling; check TLS/forwarded origin/cookie handling | No proxy/body-limit mismatch, controlled load and verified origin handling |
| PROBE-11 | Make an HTTPS request to an approved public health/documentation endpoint with no personal payload or API credential | DNS/TLS/outbound connectivity; not email deliverability or authenticated production integration proof |
| PROBE-12 | Stage artifact over approved SSH/SFTP access, verify checksum/host key, activate and roll back an app-only release | Noninteractive delivery, permissions, correct release ID and retained private data |
| PROBE-13 | Export test DB/file and restore into another isolated test target | Readable matching data, measured recovery, no overwrite of real services; production recovery remains VTC-041 |

Every item starts **not run**. Provider answers, menu options, local tests and generated scripts cannot be substituted for an actual hosted pass.

## Read-only database metadata

Run only after connecting to the approved test database. These results are private and must not enter public CI logs or commits. If a variable/query is unavailable, record the limitation instead of changing server settings or querying another site's data.

```sql
SELECT VERSION(), @@version_comment;
SELECT @@character_set_server, @@collation_server, @@session.sql_mode;
SELECT @@session.time_zone, @@global.time_zone, @@session.transaction_isolation;
SELECT @@max_connections, @@max_user_connections, @@max_allowed_packet;
SHOW ENGINES;
SHOW GRANTS FOR CURRENT_USER;
```

Use a small explicit pool, set session UTC for the actual tests, and measure application-plus-cron combined usage against confirmed per-account limits. Do not print passwords or place credentials in command arguments. Confirm the account's permitted schema/DDL operations; do not try to grant extra privileges or alter global MySQL configuration.

## Acceptance and cleanup

Publish an aggregate report identifying the tested artifact revision and pass/fail/not-run per check, with actual account details retained privately. Update the capability matrix and budget conclusion only after evidence exists. If the host fails maintenance/cost/runtime requirements, keep production approval blocked and ask for a concrete provider/hosting decision before stack-dependent implementation.

Disable/remove only the specifically approved temporary jobs/resources after retaining necessary private evidence. Verify exact targets and authorization before deletion; no broad account reset, bulk file deletion, restore-overwrite or cleanup of unrelated user resources is part of this plan. If deletion authorization is absent, hand off the named test resources for the owner to remove rather than removing anything else.
