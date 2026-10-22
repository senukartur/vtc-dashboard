# Schema ownership

Module owners coordinate new schema with the sole migration integrator. The production schema contains [audit](../src/schema/audit.ts) and [identity](../src/schema/identity/index.ts); value/transaction helpers live under `src/core/` so the existing public build layout stays stable. Identity adds auth/member/company storage without startup seed accounts; catalogs, canonical trips, telemetry and manual reports now have separately owned additive schemas. Do not run an auth tool's automatic migrations against an existing database.

Read the [persistence contract and recovery runbook](../../../docs/development/persistence.md) before changes. Add future module schema paths explicitly to `drizzle.config.ts`, review exact comparisons/indexes/constraints, and preserve historical references with restrictive deletion semantics. Numeric fixtures are not company policy.


The [manual schema](../src/schema/manual-reports/index.ts) retains immutable revisions/references and durable candidate-generation intents. Missing/cleaned paths keep persisted check times because filesystem calls can complete late; generation identities are never reused. See the [implementation and activation boundaries](../../../docs/development/manual-reports.md).
