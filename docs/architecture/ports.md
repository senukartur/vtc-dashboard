# Infrastructure ports and contract ownership

These are architectural interface signatures, not installed TypeScript exports. VTC-006/007/013/014/019/021/022/025 implement them against the reviewed contracts. Keep provider details out of domain/UI code.

VTC-007 exports the opaque `TxContext`, `UnitOfWork`/`createUnitOfWork`, exact value helpers and `createAudit` from `@vtc/db`; use the [implemented persistence contract](../development/persistence.md) for actual signatures/lifetime and connection budgets. VTC-021 adds the separate [safe outbox/jobs facades](../development/jobs.md). The combined `AuditOutbox` sketch below remains architectural shorthand. Other ports below remain specifications unless their owning implementation is explicitly linked.

```ts
type Id = string;
type TxContext = { readonly transactionId: Id }; // opaque, owned by platform/db
type Actor = { userId: Id; accessEpoch: number; capabilities: readonly string[] };
type Locale = "en" | "ru";
interface Clock { nowUtc(): string }
interface IdGenerator { nextId(): Id }

interface UnitOfWork {
  run<T>(command: (tx: TxContext) => Promise<T>): Promise<T>;
}
interface AuditOutbox {
  append(tx: TxContext, event: DomainEvent): Promise<void>;
}
interface BlobStore {
  putPrivate(input: { objectId: Id; bytes: AsyncIterable<Uint8Array>;
    contentType: string; expectedSha256?: string }): Promise<{ sha256: string; byteLength: number }>;
  readPrivate(objectId: Id): Promise<AsyncIterable<Uint8Array>>;
  removeUnreferenced(objectId: Id): Promise<void>;
}
interface IdentityProvisioner {
  prepareCredential(password: string): Promise<{ passwordHash: string }>;
  insertWithCredential(tx: TxContext, input: { userId: Id; email: string;
    name: string; passwordHash: string }): Promise<void>;
  // Uses the configured Better Auth hasher and owned schema on the supplied connection.
  // No auto-login, public signup, autonomous commit or password-bearing background job.
}
interface TransactionalMail {
  deliver(input: { deliveryId: Id; template: string; recipientRef: Id;
    privatePayloadRef: Id }): Promise<{ providerReceipt: string | null }>;
}
interface CatalogResolver {
  resolve(input: { revisionId: Id; game: "ets2" | "ats"; kind: string;
    mapNamespace: string | null; provider: string; sourceId: string | null;
    locale: Locale | null; label: string | null; regionId: Id | null }): Promise<
      { status: "resolved"; entityId: Id; factRevisionId: Id } |
      { status: "unknown"; reasonCode: string } |
      { status: "ambiguous"; candidateIds: readonly Id[] }>;
}
interface TripSourceAdapter {
  readonly provider: string;
  normalize(immutableSourceRecordId: Id): Promise<NormalizedTripEvidence>;
  // Normalized evidence never supplies trusted accepted/qualification/attendance flags.
}
```

`DomainEvent` is defined by the [versioned event contract](../contracts/dashboard/events.md); normalized evidence is defined below. Exact generated value/wire types are owned by the contracts/sources integrator. The example signatures do not authorize arbitrary string providers, rules, MIME types or templates at runtime: implementations use registered allowlists and validated schemas. Facades requiring authorization also take `Actor`; ports themselves are not HTTP endpoints.

## Normalized evidence and rule boundary

```ts
type DecimalString = string;
type Fact<T> =
  | { status: "known"; value: T; sourceRecordId: Id; sourceField: string }
  | { status: "unknown"; reasonCode: string; sourceRecordId: Id };
type PinnedEntity = { entityId: Id; catalogRevisionId: Id; factRevisionId: Id };
type ReportedTime = { utc: string | null;
  basis: "event" | "checkpoint" | "last-known" | "receipt" | "unknown";
  verifiedActual: boolean };
interface NormalizedTripEvidence {
  sourceRecordId: Id;
  factRevisionId: Id;
  provider: "ets2telemetry" | "manual";
  ownerUserId: Id; // derived from server auth/binding, never trusted from a payload
  game: "ets2" | "ats";
  outcome: "open" | "delivered" | "cancelled" | "none";
  recording: "complete" | "partial" | "unknown";
  start: ReportedTime;
  end: ReportedTime;
  origin: Fact<PinnedEntity>;
  destination: Fact<PinnedEntity>;
  cargo: Fact<PinnedEntity>;
  cargoMassKg: Fact<DecimalString>;
  actualDistanceM: Fact<DecimalString>;
  measuredSegmentM: Fact<DecimalString>;
  plannedDistanceM: Fact<DecimalString>;
  deliveredDistanceM: Fact<DecimalString>;
  wholeTripDistanceSupported: boolean;
  trailers: { complete: boolean; items: readonly Fact<PinnedEntity>[] };
  adrCategory: Fact<PinnedEntity>;
  ruleContextComplete: boolean;
  reasonCodes: readonly string[];
}
interface EvaluationContext {
  qualificationAssignmentId: Id;
  ruleVersionId: Id;
  attributionBasis: "actual_start" | "manual_confirmation" | "staff_resolution";
  confirmedEvent: null | { eventId: Id; eventRevisionId: Id; attendanceRevisionId: Id;
    prescribedCargoId: Id | null; prescribedMassKg: DecimalString | null;
    prescribedTrailerTypeId: Id | null };
}
type RuleResult = { outcome: "pass" | "fail" | "unknown";
  reasons: readonly { code: string; field: string }[] };
```

A known normalized actual start/end requires supported lifecycle evidence, not a numeric checkpoint or client flag alone. Manual source times are unknown; confirmation time belongs to the **decision**, not the source. Incomplete distance retains its measured segment separately and leaves actual trip distance unknown. Pinned trailer types preserve body/chain classification; an incomplete list cannot satisfy an allowlist check. ADR comes from supported pinned catalog facts, not a translated cargo label. Raw money, fuel, damage, mode/build/locale and source identities remain available in the immutable telemetry snapshot; this minimal rule boundary does not erase or reinterpret them.

The coordinator obtains historical qualification/rule versions and confirmed event attendance through owning facades; a source adapter cannot supply trusted acceptance, qualification or exception flags. If qualification is unknown, create review work rather than inventing an `EvaluationContext`. Staff resolution records supported facts/attribution explicitly; it cannot silently reuse today's qualification for an old trip.

Rule evaluators are registered pure functions over evidence, context and typed immutable config. Initial configs are max mass, allowed trailer types and allowed ADR categories as declared in OpenAPI. Proven failure returns `fail`, insufficient facts return `unknown`, and all required supported checks passing returns `pass`. Only the confirmed event-prescribed matching load can bypass those three qualification restrictions; it never bypasses ownership, lifecycle, completeness or timing checks. No arbitrary JavaScript expression or unknown rule type executes from stored JSON.

## Adapter rules

| Boundary | Required implementation behavior |
| --- | --- |
| Transaction context | All participants resolve the **same** Drizzle/mysql2 connection from `TxContext`; no nested pool transaction as a substitute. Identity's private schema/credential repository joins this exact connection, rather than invoking a separately committing library signup API |
| Auth engine | Better Auth behind an application facade. No public catch-all library route, admin plugin or unrestricted signup/reset/change-email route. Browser DTOs/capabilities belong to this project, not generated library internals |
| Blob | Local private persistent filesystem initially, replaceable storage later. Metadata/ref/retention stays in MySQL. Stage object first, verify content/checksum, then attach transactionally; clean unattached orphans after a configured grace period. Never delete an attached object before the one-year/latest-decision and under-review checks |
| Mail | Local fake in tests/staging by default; production provider selected in VTC-014. Durable delivery identity, bounded retries, sanitised failures. No email failure may block administrator copy of a valid invitation. Leadership code expiry does not extend because a mail retry is delayed |
| Catalogs | Read pinned local published facts. Import/extraction happens outside the production app; source licensing, all-DLC coverage, readable labels and publication review remain VTC-019 gates. Own RU/EN labels/fallback do not become trusted identity mappings |
| Trip sources | Own telemetry uses its frozen contract and durable receipt. Manual uses revised forms/evidence. Future company-wide Trucky/VTCBase adapters authenticate and persist to the same source/acceptance pipeline, not another statistics path |
| Steam/TruckersMP | Bound verified external IDs and narrow reads; cache with explicit stale/unavailable state. Provider outage cannot silently change ownership, revoke historical trips or infer verification. Steam replacement requires director/deputy, audit, epoch change and token revocation |

## Public API and migration ownership

`docs/contracts/dashboard/openapi.json` owns the browser API wire format. The [telemetry contract](../contracts/telemetry-v1.md) continues to own `/api/telemetry/v1/*`; its ACK/status/error/ID semantics are not wrapped or renamed by this API. Frontend/API owners coordinate changes through additive reviewed contract PRs before implementation. An unsupported request field is rejected rather than silently ignored.

VTC-006 produces package/tooling setup and imports the selected contracts; it does not regenerate frozen telemetry schemas opportunistically. Schema owners add module definitions, and the migration integrator alone regenerates/orders the journal. Auth CLI output is reviewed/merged through that same owner; no separate auth auto-migration runs against a deployed database.

Every adapter needs contract fixtures and a real integration gate. A local fake or an imported npm package does not prove real MySQL persistence, invitation crash recovery, SMTP delivery, Steam ownership, private evidence access or Hostland compatibility. Keep such pending evidence visible in the implementing card.


VTC-021 implements the transaction-scoped safe outbox and durable queue facade described in [jobs](../development/jobs.md). Server composition supplies IdentityPorts.accessEvents on the shared UnitOfWork, with member access version/epochs only and a documented event-ID correlation fallback. Private delivery uses the explicitly configured VTC-014 adapter below and remains fail-closed when disabled. No access-event consumer or other domain handler is installed; future module consumers must register reviewed safe references and own permission/version checks.

VTC-014 supplies the [private messaging port](../operations/email.md) on the same producer transaction, with direct safe delivery-ID jobs and local/Resend adapters behind explicit disabled-by-default configuration. Identity owns delivery validity and transactional private-payload invalidation facades. VTC-015 supplies admissions generation validity and keyless transactional invalidation on reissue/consumption, including when mail is disabled. No first outbox subscription, deployed admissions service or real provider activation is established.

VTC-015 now installs the [admissions coordinator](../development/admissions.md), its same-transaction identity provisioning/current-authority facades, a qualifications-owned initial assignment initializer, and actual admissions validity/invalidation callbacks in both API and jobs composition. These are opt-in implementation seams; full qualification rules/progress and verified Steam identity remain VTC-028/VTC-018. Disabled-mail approval retains independent invitation copy, while required rejection mail fails closed without a durable adapter.

VTC-019 implements the local published-fact resolver and [bounded normalized catalog import](../development/catalogs.md). Its private JSON artifact store is deliberately catalog-owned MySQL MEDIUMTEXT, capped below byte capacity and expired without erasing immutable published facts; this does not generalize report evidence storage. API/worker composition registers the safe catalog handler alongside mail. Operator-reviewed exact artifact/inventory/provenance evidence remains separate from uploaded assertions; actual full production datasets and permitted distribution are pending.

VTC-022 now exports the internal `TripSourceAdapter`, `NormalizedTripEvidence` and caller-transaction trip/source facade in the [trip implementation](../development/trips.md). Telemetry and manual adapters are registered; no future webhook or public ingestion transport is activated. Catalog normalization uses additive transaction-scoped published/resolve/pinned/label facades and current member summaries remain identity-owned.


VTC-025 implements the [private filesystem port and manual coordinator](../development/manual-reports.md) with immutable generated generations, full bounded image decode and protected streams. The transaction-scoped VTC-029 retention decision/reopen seams never apply acceptance or statistics. The production evidence callback prevents alternate source callers bypassing persisted ownership/readiness.
VTC-028 exports `createQualifications`, same-transaction historical lookup and contribution replacement through the [qualification facade](../development/qualifications.md). Trips owns canonical/fact validation, current contribution replacement/history and exact authoritative totals. Identity exports `qualificationContextInTransaction` for sorted current member locks and `completeTraineeInTransaction` for the narrow additive role transition. Its injected qualifications lifecycle port closes real current periods on deactivation; return requires explicit new assignments. These seams do not activate adjudication or notification transport. VTC-026 now supplies the opt-in reconciliation coordinator described below.

VTC-026 [reconciliation](../development/reconciliation.md) installs synchronous telemetry/manual source callbacks, Trips-owned group/evidence/apply/reverse primitives, Manual Reports-owned author/deletion fences, and a Qualifications-owned preparation facade. The cross-module coordinator uses these facades on the caller transaction; it never queries another module schema directly. No new adapter, acceptance endpoint or outbox subscription is installed.
