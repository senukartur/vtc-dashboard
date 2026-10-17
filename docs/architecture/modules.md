# Module ownership and allowed dependencies

**Baseline:** [architecture](README.md). One database does not grant every module write access to every table. Table names below are logical ownership groups, not a final migration.

| Module / owner cards | Owns | Public facade / consumers |
| --- | --- | --- |
| Identity and membership — VTC-013/018/038 | Auth user/session/account/verification schema, membership status/roles, Steam/TruckersMP links and identity epochs | Authenticate, current capabilities, member lookup, deactivate/reinstate, protected succession; every module reads the facade |
| Admissions — VTC-015 | Applications, decisions, seven-day invitation generations and redemption idempotency | Public apply/redeem; administrator review/copy/reissue; calls identity provisioning port in the same transaction |
| Catalogs — VTC-019/020 | Immutable revisions, opaque entity IDs, RU/EN labels, external mappings, DLC/build/coverage/provenance | Search/display/pinned-fact resolution/import validation/publication; trips and rules consume pinned facts |
| Sources and telemetry — VTC-022/023/024 | Personal token hashes, bindings/installations, immutable source inbox/revisions, source-trip ownership and receipt identities | Frozen telemetry API; normalized source evidence port; never owns company acceptance or qualifications |
| Trips and reconciliation — VTC-022/025/026 | Canonical trip identities, manual revisions/evidence references, source links, merge/unmerge history and the authoritative contribution register | Company summaries/private detail and transaction-scoped trip/source/contribution primitives; application coordinators combine these with acceptance policy |
| Rules — VTC-027 | Pure versioned rule evaluators and typed rule definitions; no user/session/database ownership | Evaluate normalized evidence + pinned rules + confirmed event facts; returns pass/fail/unknown with stable reason codes |
| Qualifications — VTC-028/031 | Per-game levels/rule versions, assignment periods, promotion decisions and progress projections | Historical qualification lookup, evaluated progress, director/deputy confirmation; reads authoritative trip contributions, roles remain identity-owned |
| Acceptance — VTC-029 | Immutable adjudication decisions, review work items and committed attribution snapshots | Coordinates trip/rule/qualification/event reads and decision writes in one transaction; applies self-review prohibition |
| Events — VTC-034/035 | Public/member event revisions, RSVP/private decline reason, actual attendance and prescribed-load conditions | Public projection/member detail, RSVP, attendance confirmation and pinned exception facts |
| Analytics — VTC-032/033 | Rebuildable contribution projections/watermarks, not trip facts | Accepted canonical-trip totals and actual distance by explicit company reporting timezone |
| Notifications — VTC-036/037 | Per-recipient notification/read state, category preferences, durable reminder identities | Permission-filtered polling/history, mark read, upcoming event projection; no raw source-event toasts |
| Administration / composition — VTC-038 | Company reporting configuration and source-connection metadata | Calls owning facades; does not become a second user/trip/rule repository. Future Trucky/VTCBase connections are company-wide |
| Platform — VTC-007/014/021/039 | Transaction host, append-only audit/outbox/job delivery, mail/blob adapters, request configuration/observability | Infrastructure ports only; no qualification or promotion decisions |

## Dependency direction

- HTTP composition calls module commands and queries. A command may call another module's exported facade with the same `TxContext`; it must not instantiate a second pool or read another module's tables directly.
- Identity is foundational and must not import admissions/trips to authorize a session. Admissions calls identity's transaction-scoped provisioning facade; identity/member creation grants access only after the invitation transaction commits.
- Rules are pure and depend on contract value types only. They receive historical facts; they cannot fetch the current qualification or translate a label to guess identity.
- Cross-module application coordinators sit above owning facades and combine trips, acceptance, qualifications, catalogs, events and rules on one transaction context. They are composed in `apps/api/src/use-cases/`; lower modules do not import coordinators back. Single-module primitives return facts/results or publish events, rather than recursively invoking another aggregate's high-level policy command.
- Qualifications confirms promotions through identity's narrow role-change facade in the same transaction. Identity does not infer per-game qualifications from a global role.
- Analytics and notifications consume committed domain facts/events and never write source/trip/qualification records. Consumers use the authoritative latest accepted contribution version, not blindly add deltas from delivery order. Trips owns that register; a decision coordinator replaces its contribution in the decision transaction. Qualifications reads it through the trips facade, while chart/progress projections may catch up asynchronously.
- The administration UI composes separate APIs. Administrative parity does not bypass protected director operations, target privacy or self-review rules.

## Permission vocabulary

Effective capabilities are additive and emitted in `/me`, but server checks remain authoritative: `company.read`, `trips.submit_own`, `trips.read_own_private`, `trips.review`, `events.respond`, `applications.manage`, `events.manage`, `qualifications.manage`, `members.manage`, `connections.manage`, `company.configure`, and `leadership.transfer`.

Active VTC membership grants `company.read` for every role, including a dispatcher/administrator without a driving role. Trainee/Driver add the standard driving/event-response capabilities. Dispatcher supplies review, not member impersonation. Director/Deputy supply administration; only the current singleton director supplies transfer/protected self-account authority. An administrator may also have Driver and independent per-game qualifications. Administrative role alone does not imply a driving qualification. A driver-level route requires the relevant member capability and current active membership/linked identity when applicable.

`trips.review` additionally requires actor != manual author for **every** manual review decision, including correction/reconciliation paths. Generic role checks do not satisfy this condition. Event-decline reasons are projected only for their author/director/deputy; ordinary member attendance lists never include them.

## Collaboration and schema ownership

One owner edits each module's contracts/schema and exports its facade. Shared root dependencies, app composition, capability registry and `packages/contracts` have an integrator. Module owners submit additive contract/schema proposals; one migration owner generates/orders the final Drizzle journal and migration files. Never generate competing migrations from separate branches against the same journal.

Cross-module FKs refer to stable IDs and use deliberate deletion behavior. Deactivation retains history; do not cascade-delete accepted trips or invite/review/audit facts. No module may write auth hashes/session fields, overwrite a published catalog/rule revision, or alter an already reviewed manual revision through a shared "generic update" helper.
