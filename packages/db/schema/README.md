# Schema ownership

Module owners coordinate new schema with the sole migration integrator. The current production schema is [audit only](../src/schema/audit.ts); value/transaction helpers live under `src/core/` so the existing public build layout stays stable. There are no auth/member/company/trip tables or seed accounts. Do not run an auth tool's automatic migrations against an existing database.

Read the [persistence contract and recovery runbook](../../../docs/development/persistence.md) before changes. Add future module schema paths explicitly to `drizzle.config.ts`, review exact comparisons/indexes/constraints, and preserve historical references with restrictive deletion semantics. Numeric fixtures are not company policy.
