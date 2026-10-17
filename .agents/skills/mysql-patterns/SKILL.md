---
name: mysql-patterns
description: Design or review VTCDashboard MySQL 8.4/InnoDB schemas, indexes, queries, migrations, mysql2 pools and transactional concurrency or recovery behavior.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# MySQL Patterns

Read [AGENTS.md](../../../AGENTS.md), [transaction rules](../../../docs/architecture/data-and-transactions.md), [stack decision](../../../docs/decisions/stack.md), `config/runtime.json` and the module's contract/card. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Target and ownership

- MySQL 8.4 LTS/InnoDB is the selected engine; `config/runtime.json` records the exact tested local target, charset, collation, UTC, isolation and SQL modes. Check the actual server/configuration through authorized local probes before claiming compatibility.
- Do not substitute MariaDB, SQLite, PostgreSQL or a research-only server. Provider availability is a deployment verification gate, not permission to weaken the baseline.
- mysql2 supplies the current readiness adapter. Drizzle schema/migrations belong to VTC-007; inspect actual manifests and schema decisions before assuming an ORM/schema exists.
- Feature owners edit owned schema files; the migration integrator serializes final migration generation/journal changes. Do not generate competing migration IDs.

## Schema and query design

- Use canonical identities and the approved schema representation. Do not choose auto-increment, UUID conversion/swap order or a new identity scheme from a generic example. Binary identifiers and case-sensitive provider/catalog keys need explicit representation/comparison tests independent of display collation.
- Keep ownership, lifecycle, foreign keys, versions and frequently filtered fields relational. JSON suits immutable source/extension evidence; it must not bypass constraints or silently become the normalized domain model.
- Preserve normalized units and required precision. Choose integer/decimal representations from the contract; account for mysql2 returning large integers/decimals as strings instead of silently losing JavaScript precision.
- UTC storage has no implied timezone metadata. Preserve timestamp precision and distinguish actual event times from receipt/decision times. Configure both server/session expectations and test boundary conversions.
- Build composite indexes around real predicates, equality/range/order requirements and deterministic tie-breakers. Use bounded contract pagination and matching indexes; do not replace an approved cursor shape just to fit an example.
- Inspect `EXPLAIN` on representative synthetic data. A table scan or filesort is evidence to investigate, not automatically a defect. Indexes cost writes/storage and need justification.
- Parameterize values through mysql2/Drizzle. Whitelist identifiers/sort directions; placeholders do not parameterize SQL identifiers. Select explicit permission-safe fields rather than returning `SELECT *` results as DTOs.
- For a justified upsert on MySQL 8.4, use supported row aliases rather than copying deprecated `VALUES(column)` patterns. Check all unique constraints: an upsert must not overwrite immutable source evidence or hide a competing identity conflict.

## Transactions and concurrency

- Acquire one connection and use it for the entire transaction, including participating module repositories, audit and outbox. Commit or roll back, then release in `finally`; handle unusable connections through the established adapter.
- Lock authoritative rows consistently and keep transactions short. Recheck membership, director/reviewer/author, revision and effective history as required by the command. Do not perform external I/O while holding locks.
- Use database uniqueness plus transactional handling for idempotency. Test concurrent identical keys and conflicting payloads; `SELECT` followed by unguarded `INSERT` is not enough.
- On deadlock, roll back and retry the entire safe transaction with a bounded budget/backoff. Explicitly roll back on lock-wait timeout before considering a retry; do not assume MySQL rolled back the entire transaction. Never blindly retry an ambiguous commit or already-executed external effect.
- `FOR UPDATE SKIP LOCKED` is for queue claims that may skip locked rows, never authoritative totals/permission/leadership decisions. A durable worker also needs leases, crash recovery, retry scheduling and effect deduplication.
- Under the configured isolation level, verify actual snapshot/locking behavior with multiple connections and deterministic coordination. A single-connection happy path does not prove a race is prevented.

## Migrations and recovery

MySQL DDL can implicitly commit; a wrapping application transaction does not make a multi-statement migration reversible. Plan additive rollout, applied-state detection, interrupted-run recovery and backup/restore verification. Check feature-specific online DDL support and metadata locking on the exact target; do not promise zero downtime from an `ALTER` option alone. Migration/admin privileges are separate from runtime privileges. Do not delete a persistent development volume to hide migration/configuration failure.

## Pools and diagnostics

- Reuse bounded pools, bound acquisition/queue/connection/query time, and close resources on shutdown. Avoid unlimited queues and fixed pool-size recipes unrelated to the environment. Do not replace the scaffold's tested readiness pool/deadline/stream-destruction behavior with generic snippets.
- Verify timeout, saturation, broken/half-open connection and recovery paths; query rejection alone does not prove socket cleanup. Recheck driver-specific adapters when upgrading mysql2.
- Use safe local diagnostics. `EXPLAIN ANALYZE` executes the query. Process lists, InnoDB status and slow logs can contain sensitive statements/identities; keep only necessary sanitized evidence. Enabling global logging, altering users or tuning a live server requires task authorization.
- Use the existing private environment/secret store and network/TLS policy. Never publish connection strings or account inventory in examples or reports.

## Verification

Run the contributor baseline and real target-compatible MySQL integration tests for changed behavior: constraints, precision, collation, UTC boundaries, concurrent locks/idempotency, rollback/deadlocks, restart/reclaim and migration recovery as applicable. `pnpm db:check` establishes readiness settings only. Record what ran and what remains pending; specifications and generated SQL are not applied migration evidence. Obtain the review required by the card before delivery completion.
