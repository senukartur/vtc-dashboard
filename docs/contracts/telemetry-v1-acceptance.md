# Telemetry v1 acceptance and delivery gates

**Status:** agreed v1.0 implementation scenarios under the [contract agreement record](telemetry-v1.md#agreement-record-2026-10-17), not passing implementation tests. Final independent review/merge evidence is tracked in PR #3. Read the [contract](telemetry-v1.md), [source findings](../research/telemetry.md) and [synthetic examples](examples/README.md). All real-client/MySQL/hosting evidence below remains pending until the named implementation cards deliver it.

## Specification review matrix

| ID | Scenario | Required result | Implementation owner |
| --- | --- | --- | --- |
| TEL-001 | Start, then complete | One source trip/canonical trip; distinct occurrence/receipt times; apply accepted totals once | VTC-022/023/029 |
| TEL-002 | Disconnect before sending, then restart | Frozen event ID/payload/revision survives; local recording is independent | VTC-024 |
| TEL-003 | Server commits, response is lost | Retry obtains duplicate receipt with identical receipt/first-receipt identities; one processing effect | VTC-023/024 |
| TEL-004 | Two requests for the same event race | MySQL uniqueness resolves race; no pre-commit ACK or duplicate outbox work | VTC-023 |
| TEL-005 | Same event ID, different payload | 409 conflict; original evidence unchanged; no second effect | VTC-023 |
| TEL-006 | Same trip revision under another event ID | 409 conflict; not a second source snapshot | VTC-023 |
| TEL-007 | Completion arrives before start | Full terminal snapshot works; delayed start remains evidence and cannot reopen/notify | VTC-022/023/036 |
| TEL-008 | Lower revision arrives after higher one | Retain evidence; no state/statistics regression | VTC-022/029 |
| TEL-009 | A new revision changes an accepted trip | Preserve confirmed result pending authorized review, recompute once after confirmation | VTC-026/029 |
| TEL-010 | Cancellation vs restart/gap closure | Preserve cancelled vs unknown outcome; neither becomes a successful trip | VTC-022/029 |
| TEL-011 | Late attach, missing actual start, partial distance | No invented actual start/full distance/current qualification; review uncertainty | VTC-024/027/029 |
| TEL-012 | Local UTC label was inherited/receipt-based/clamped | Preserve basis and raw source time/anomaly; do not use fallback label as actual lifecycle time | VTC-024/029 |
| TEL-013 | Same account/epoch rotates token | Old pending work resumes under unchanged owner and source IDs | VTC-023/024 |
| TEL-014 | Token replaced by another account | Distinct registration; old bound trips/queue remain held for original owner | VTC-023/024 |
| TEL-015 | Steam replacement changes identity epoch | Revoke tokens; old-epoch work held; no historical owner transfer | VTC-018/023/024 |
| TEL-016 | Member deactivated, including duplicate request | Refuse ingestion; retain already committed source/history; no revived old token | VTC-013/023 |
| TEL-017 | Forged user/role/company/accepted/exception field | Strict payload rejection; owner/permissions derived server-side | VTC-023/029 |
| TEL-018 | Synthetic/replay origin or local export document | Reject from production trip ingestion; dedicated test environment only | VTC-023/024 |
| TEL-019 | RU/EN label changes while IDs stay stable | Same catalog entity and historical rule outcome; unknown names do not establish identity | VTC-019/024 |
| TEL-020 | Unknown map/build/locale or missing trailer history | Preserve unavailable values; review rule-relevant ambiguity, not fabricated defaults | VTC-019/024/029 |
| TEL-021 | Actual shipment mass differs from unit mass/count | Preserve both; qualification uses actual supported shipment mass | VTC-024/027 |
| TEL-022 | Planned/observed/delivered distances differ | No sum or planned-distance substitution; uncertainty/conflict is reviewed | VTC-024/029/032 |
| TEL-023 | Zero values, unknown currency, uint64 over 2^53 | Preserve zero/unavailable and exact integer text; expected income u64, revenue/penalty s64 with precise bounds; no currency mixing | VTC-022/024/032 |
| TEL-024 | Invalid UTF-8/duplicate keys/unsafe number/oversized body | Reject before ACK; no truncated evidence or payload in logs | VTC-023 |
| TEL-025 | Unsupported version/media type | Fixed error; no silent downgrade or discarded queued work | VTC-023/024 |
| TEL-026 | 429, 5xx, timeout, invalid ACK | Backoff/resume exact event; validate ACK identity before marking delivered | VTC-023/024 |
| TEL-027 | Old replay/backfill or untrusted source clock | No false current activity/toast; duplicates emit no second notification | VTC-036 |
| TEL-028 | First connection with existing local history | Automatically enumerate every retained unbound game trip and bind it to the first account; no age cutoff or per-trip selection | VTC-024 |
| TEL-029 | Initial scan crashes or overlaps new recording | Resume durable scan/change cursors and trip revisions; no omissions or duplicate canonical trips | VTC-023/024 |
| TEL-030 | Copied/restored database reuploads existing trips | Same source-trip identity, original ownership, no duplicate totals across installations/database copies | VTC-023/024/026 |
| TEL-031 | Queue reaches disk/count bound | Pause new serialization/enumeration, keep frozen events uploading when possible, free capacity on durable receipts and resume automatically; retain source changes and keep recording responsive throughout | VTC-024 |
| TEL-032 | Manual report matches an initial-history trip | Preserve both sources and staff-review rules; one canonical trip and one credited result | VTC-026/029 |
| TEL-033 | Trip predates membership/qualification history | Keep it visible; never invent historical qualification or use today's level; review attribution before credit | VTC-028/029 |
| TEL-034 | Journal exposes only latest 10 trailer configurations | Derive complete rule context from full stored evidence or mark incomplete; no false complete claim | VTC-024 |
| TEL-035 | Upload scope vs restore | Initial local history reaches dashboard; dashboard manual trips and remote history are not restored into the local client in MVP | VTC-024; VTC-110 later |
| TEL-036 | Known/unknown game-mode evidence | Unknown requires none/none; known requires detection/non-none confidence, single-player only weak; no invented module evidence or identity proof | VTC-023/024 |

## Minimum client/server integration evidence

- [ ] Before client implementation, reconcile this owner-agreed v1 contract with the actual shipped local schema and obtain the external feature owner's implementation hand-off; preserve source-to-summary projection, legacy first-binding behavior, lifetime IDs and limits. Discovery agreement is recorded in the contract; this check requires client implementation coordination, not another discovery approval.
- [ ] Enable real game recording through that project's existing review/acceptance process; reference its exact revision and gates. Merely inspecting `GAME_HISTORY_RECORDING = false` does not satisfy this.
- [ ] With isolated accounts and a real MySQL test database, exercise TEL-003–009 and 013–018 concurrently and across process crashes; inspect one canonical result and permission-filtered effects.
- [ ] With the real desktop client, prove automatic full first history upload, scan restart, backlog/live overlap, token rotation/account switch and queue-pressure recovery; no synthetic fixture can establish actual client compatibility.
- [ ] Capture authorized representative ETS2 and ATS sessions, including partial recording, missing SDK fields, trailer changes, SDK delivered distance versus observed actual distance, and real UTC provenance. Keep source captures private and derive reviewed synthetic public regressions.
- [ ] Prove no samples, process/window details, credentials or unintended local data enter upload, proxy diagnostics, exports, test artifacts or public logs.
- [ ] Verify the chosen host's request/JSON body limits, sustained initial-sync rate, durable commit/job semantics and notification latency, without exceeding the approved hosting budget.

## VTC-003 completion versus later work

Discovery specifies the owner-agreed contract and implementation gaps without building an uploader/server. Agreement follows the owner's conditional authorization and recorded review corrections, not source reading or an invented separate maintainer approval. VTC-003 still requires final independent review and merge evidence. VTC-023/024/040/042 own implementation, regression and release acceptance; all integration checks above remain incomplete. VTC-110 retains server-to-client restore; full sample synchronization is excluded.
