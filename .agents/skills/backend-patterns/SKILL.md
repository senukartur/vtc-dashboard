---
name: backend-patterns
description: Implement or review VTCDashboard Fastify APIs, module use cases, permission-filtered queries, transactional commands, adapters, errors and durable background work.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# Backend Patterns

Read [AGENTS.md](../../../AGENTS.md), [module boundaries](../../../docs/architecture/modules.md), [transaction rules](../../../docs/architecture/data-and-transactions.md), [ports](../../../docs/architecture/ports.md) and the affected contract/card. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Boundaries and API flow

- Keep Fastify routes thin: validate the wire request, establish authenticated context, invoke an authorized command/query and serialize an explicit public DTO. Use the existing schema/error pipeline instead of Express/Next.js handlers.
- Keep domain commands/queries/repositories inside their owning module. Cross-module coordinators call public facades and receive an explicit transaction context; do not reach through another module's tables or implementations.
- Use reviewed browser contracts and the separately frozen telemetry contract. Do not invent routes, pagination, status envelopes or error codes to fit an example. Coordinate additive contract changes through their owner.
- Validate content type, size, parameters and supported versions. Preserve strict body validation and the existing deliberate wire-parameter coercion boundary; do not enable broad coercion that changes supplied facts.
- Keep provider-specific normalization behind ports. Missing/ambiguous catalog mappings stay explicit and reviewable; display labels never become identifiers.

## Authentication, permissions and privacy

- Browser operations follow the selected session/origin/CSRF design; telemetry uses its separate bearer contract. Do not replace these with a generic JWT example or cookie fallback.
- Resolve current capabilities, membership, target ownership and relevant versions from authoritative state. Recheck race-sensitive facts under command locks, including current reviewer/author and protected director operations.
- Roles are additive and independent of per-game qualification. Apply the concept's exact constraints rather than a single `admin` flag. No reviewer can approve their own report.
- Permission-filter queries/serializers before data leaves the server. Evidence, pending/rejected reports and decline reasons cannot be returned and merely hidden by React.
- Use fixed-field safe diagnostics and request IDs. Do not log request bodies, tokens, provider payloads, credential-bearing URLs, raw SQL errors or private identities.

## Transactional commands

- Commit domain changes, audit history and outbox records in one MySQL transaction. Pass the same transaction connection through participating repositories; never let a nested repository silently use the global pool.
- Preserve one canonical trip and immutable source evidence. Enforce durable uniqueness/idempotency at the database boundary; a prior in-memory lookup does not prevent concurrent duplicates.
- Lock affected records in deterministic order and validate revision/current-state preconditions inside the transaction. A reviewed obsolete revision must fail safely rather than deciding the new revision.
- Keep actual start, actual completion, receipt and staff-confirmation times distinct. Select historical rules and analytics periods according to the concept; do not let ingestion time replace missing event facts.
- Do network/mail/blob work outside database locks through the agreed durable workflow. Use [mysql-patterns](../mysql-patterns/SKILL.md) for concurrency, retry and recovery details.

## Queries and durable work

- Select only the fields the DTO needs; batch related lookups or use appropriate joins to avoid N+1 queries. Bound pagination/sorts by the contract and inspect representative plans before adding indexes.
- Keep authoritative permission, leadership, revision and acceptance decisions uncached. Any optional cache needs access scope and invalidation; there is no Redis or competing backend in this architecture.
- Required asynchronous effects use MySQL-backed durable jobs/outbox with claim/lease, idempotent effects, bounded attempts, retry scheduling and observable terminal failures. In-process arrays and fire-and-forget promises do not establish durable acknowledgement.
- The existing jobs CLI is a placeholder until VTC-021. A skill example does not implement queues, mail, notifications or recovery. Required notifications use polling/cron; optional SSE stays separate.
- Keep abuse controls effective for the actual deployment and restart model. Coordinate durable/shared rate limiting through the approved platform design rather than adding Redis or claiming per-process counters provide global enforcement.

## Failure and verification

Return contract-defined safe validation/conflict/permission/unavailable errors. Retry only classified transient failures with idempotency and a bound; do not blindly retry authentication, validation or an irreversible provider call. Preserve confirmed results pending staff review when late evidence would change them.

Run contributor checks for affected code, contract fixtures, and behavior-specific failure tests. Database behavior requires real target-compatible MySQL evidence, including races, rollback, duplicate delivery and restart/retry where applicable. Auth/permissions/reconciliation/qualification changes need appropriate independent review. Report absent tooling and pending integration gates precisely; scaffold tests or a readiness probe do not prove domain behavior.
