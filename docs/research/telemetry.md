# VTC-003: telemetry integration discovery

**Observed:** 2026-10-17. **Status:** research complete; v1.0 implementation baseline adopted under the owner's conditional agreement authorization. [PR #3](https://github.com/senukartur/vtc-dashboard/pull/3) tracks final independent review and merge. No client/server integration has been implemented here.

The [VTC-003 card](https://trello.com/c/lQrxZ13N) owns this investigation and the [HTTP contract](../contracts/telemetry-v1.md). The dashboard's [approved concept](../CONCEPT.MD) remains authoritative for company decisions. The owner additionally requires automatic initial upload of **all retained local game trips**, followed by ongoing synchronization. An opt-in selection of old trips is not the agreed MVP behavior.

The owner also confirmed: an imported trip with unknown historical qualification stays visible but waits for staff review before statistics/progress credit; sufficiently supported historical trips use normal automatic validation. MVP synchronization is client-to-server only, without downloading dashboard-only manual reports into telemetry. Mandatory manual review solely because a trip is old/unbound was proposed but not approved and is not a product requirement.

## Frozen source and actual implementation

Inspected the telemetry repository's remote `main` at [e08a872e73f3d7c184dc0e71e37b6d75d23ff040](https://github.com/senukartur/ets2telemetry/tree/e08a872e73f3d7c184dc0e71e37b6d75d23ff040). A separate ignored snapshot avoided changing the owner's active telemetry checkout. No dependencies, games, telemetry processes, live accounts or upload endpoints were run during source inspection.

The implementation contains protocol v1 types/validation, the native producer, a pure trip reducer, SQLite storage schema v2, journal queries and JSON export. Crucially, [recording-policy.ts](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/apps/desktop/src/recording-policy.ts) still sets `GAME_HISTORY_RECORDING = false`. Synthetic/replay recording is wired, but this does not establish production recording or real-game completeness. No HTTP uploader, dashboard account binding, personal dashboard token flow or remote acknowledgement exists in this baseline. A journal JSON export is neither an ingestion message nor a supported restore/import format.

Read the telemetry board on the same date. ET-014/015/016 were in Review; ET-101–104 were in Later. Board state and merged code are distinct evidence. This investigation did not change that board or the telemetry repository.

## Verified field inventory

The following are code/type findings, not a promise that every gameplay session supplies every field. All SDK values retain availability; zero and false are not absence.

| Dashboard requirement | Existing telemetry evidence | Integration consequence |
| --- | --- | --- |
| Game | `SourceIdentity.game`, `TripRecord.game`: ETS2/ATS | Preserve per-game scope |
| Durable trip identity | `tripUuidFor(session, opening eventSeq)`; separate checkpoint-attach derivation | Reuse stored `tripUuid`; do not regenerate UUIDs during upload |
| UUID shape | First 128 hash bits, formatted as lowercase hex UUID; no RFC version bits | Do not reject these IDs with a version-4-only UUID validator |
| Source evidence | `pluginSessionId`, decimal `eventSeq`; checkpoint jobs have `nextEventSeq` and no opening event | Preserve event/checkpoint opening distinction |
| Origin | `game`, `synthetic`, `replay`; database purpose enforces its corresponding origin | Production endpoint accepts game origin only |
| Cities/companies | `JobConfiguration.sourceCityId`, destination/company counterparts plus display strings | Match IDs, not translated labels; no region IDs in this job shape |
| Cargo | ID, label, actual `cargoMass`, separate `cargoUnitMass` and count | Do not substitute catalog unit mass for shipment mass |
| Trailer | Per-index ID, `bodyType`, `chainType`, accessory and brand | Body/chain stay distinct; latest-10 journal configurations are not full history |
| Job context | Market, special job, loaded flag, deadline, planned distance and expected income | Snapshot at the relevant boundary; preserve uncertainty |
| Delivered outcome | `job.delivered`: distance, damage, income, XP, game duration, auto-park/load | Preserve delivered distance separately from observed distance |
| Cancellation | `job.cancelled`: penalty | Cancellation is not successful delivery |
| Other closes | `outcome: none` plus restart/gap/discontinuity/etc. reason | Map to `trip.closed`; never invent cancellation or delivery |
| Recording completeness | `complete`, `partial`, `unknown`; intervals and annotations | Independent of outcome and of dashboard acceptance |
| Distance/fuel | Stored observed metres and fuel-used litres; reducer excludes non-continuous steps | Incomplete observation is not automatically the whole-trip distance |
| UTC | Raw occurrence UTC, capture UTC, stored trip UTC labels | Reducer may fall back to last-known/receipt labels and clamp clock regressions; stored row timestamps alone do not prove actual times |
| Clock/order | Monotonic nanoseconds, source clock IDs, game minutes, boundary order | Keep large integers as decimal text; neither clock is wall-clock UTC |
| Game mode | Single-player/TruckersMP/unknown with method/confidence and ambiguous-trip flag | Evidence, not proof of multiplayer identity |
| Version | Welcome stores telemetry API, game-telemetry API and SDK archive versions | `gameTelemetry` is an API version, not retail game build |
| Exact game build, DLC/mod/map scope | Not present in the current v1 job/session upload-ready shape | Add verified metadata collection or explicitly mark unavailable; do not invent it |
| Locale | Localized SDK names, but no reliable source-name locale field in this shape | Preserve unknown locale; UI preference does not identify the source label's language |
| Steam/dashboard owner | No verified Steam or dashboard identity in inspected trip/protocol shapes | Authenticate/bind separately; a claimed Steam ID must never select the trip owner |
| Company event participation | No dashboard event association | Keep association/attendance in dashboard workflow; client cannot grant an exception |
| Online synchronization | Not implemented | VTC-023/024 and coordinated ET future work implement it |

Primary code references at the frozen SHA: [protocol-v1.ts](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/contracts/src/protocol-v1.ts), [trip identity](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/telemetry-core/src/trips/identity.ts), [reducer](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/telemetry-core/src/trips/reducer.ts), [storage API](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/storage/src/api.ts), [journal contract](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/contracts/src/journal.ts), [export contract](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/contracts/src/journal-export.ts), and [schema v1 session metadata](https://github.com/senukartur/ets2telemetry/blob/e08a872e73f3d7c184dc0e71e37b6d75d23ff040/packages/storage/src/sqlite/schema-v1.ts).

## Client work needed before compatibility can be claimed

1. Accept/enable the real-game recorder through the telemetry project's existing gates; do not flip its flag as part of VTC-003.
2. Add authenticated connection, immutable owner/identity-epoch bindings and protected token storage. Existing offline local use remains possible without an account.
3. Persist a synchronization journal: stable event IDs/revisions, frozen payloads, durable acknowledgements and per-owner cursors. Local recording commits and creation of pending sync work must not leave an untracked loss window.
4. At first connection, bind every previously unbound retained game trip to that account and automatically enqueue full snapshots, including partial/cancelled/closed trips. Page enumeration and resume it after crashes while new recording continues. Never reassign already-bound trips to another account.
5. Add trustworthy start/end provenance, full trailer/rule-relevant history summaries, and completeness aggregates. The current stored UTC labels and latest-10 journal trailer list alone cannot satisfy this contract. A missing old fact stays missing; it is not backfilled from the current game state.
6. Collect exact build/locale/map metadata only through a verified mechanism. Retain unsupported/unobserved states. Pin actual supported build/mode evidence during VTC-024.
7. Implement the HTTP queue separately from the plugin's Named Pipe ACK pipeline. A local database commit can ACK the plugin while the network is offline; a remote ACK can only acknowledge server durable receipt.

## Existing ET cards and dashboard ownership

| Existing telemetry work | Dashboard counterpart | Reconciliation |
| --- | --- | --- |
| [ET-014](https://trello.com/c/XhHPB5sA), [ET-015](https://trello.com/c/QelHZK5E), [ET-016](https://trello.com/c/FUHtxncI) | VTC-003/024 | Consume existing lifecycle/storage/journal work and preserve its pending acceptance gates |
| [ET-101](https://trello.com/c/v8LZYyH3) | VTC-003/005 | Agree identity/upload contract; older PostgreSQL and broader restore proposals do not override owner-selected MySQL and this dashboard scope |
| [ET-102](https://trello.com/c/dNfsHzdF) | VTC-022/023 | Dashboard owns its canonical records and ingestion; do not build a competing server in the telemetry repository |
| [ET-103](https://trello.com/c/WEhvEB4A) | VTC-024 | Client queue, token boundary, initial history upload, crash/retry/account safety; coordinate instead of duplicate cards |
| [ET-104](https://trello.com/c/yx35yY15) | Dashboard implementation cards | This repository owns dashboard UI/API; no second website |
| ET-101–104 history restore | VTC-110 (Later) | Initial client-to-server history upload is MVP; server-to-client restoration is still later work |

These are the dashboard's agreed coordination boundaries. No external card was edited, messaged or accepted on another maintainer's behalf; implementation hand-off still belongs to VTC-024.

## Evidence limits and closure

This research reads committed source and board requirements. It does not run the telemetry project's tests, claim its reported tests as ours, capture real driver data, establish anti-cheat/Steam-play proof, or demonstrate an uploader that does not yet exist.

The [contract agreement record](../contracts/telemetry-v1.md#agreement-record-2026-10-17) records the owner's authorization to adopt the reviewed/corrected v1.0 baseline. VTC-003 still requires final independent review and a merged dashboard PR before Done. VTC-023 must prove durability/concurrency against real MySQL; VTC-024 must prove both games, online/offline initial history synchronization, revoked credentials and partial data with the actual desktop client. The [acceptance matrix](../contracts/telemetry-v1-acceptance.md) separates specification checks from implementation evidence.

Local specification validation used JSON Schema draft 2020-12 with `jsonschema` 4.26.0 in ignored research-only tooling. The initial six examples and 26 negative probes passed structural checks, but independent source review identified field-specific money and game-mode inconsistencies. After correction, all six examples and 36 negative probes pass; additional positive probes preserve exact unsigned/signed 64-bit boundary strings and valid known/unknown game-mode combinations. These probes validate schema structure, not authentication, source truth, concurrency, retries or any running application. The isolated validator/tool dependencies are not application tooling and are not added to the repository dependency baseline.

Independent review found three actionable P2 issues: expected income must preserve native `u64` while revenue/penalty remain `s64`; game-mode evidence must obey native known/unknown confidence rules; a full queue must pause new materialization while already frozen uploads keep draining. Schema, fictional fixtures, contract wording and the acceptance matrix were corrected accordingly. The final reviewed head and delivery evidence are recorded in PR #3 rather than claiming that these specification corrections implement the future uploader.
