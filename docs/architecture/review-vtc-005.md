# VTC-005 independent review corrections

The independent reviewer inspected PR #5 at `074b6b4cfd1d9fde94bd31349f385b82e8d2c89e` against the merged VTC-004 baseline. Final-head re-review, merge and acceptance evidence are recorded in [PR #5](https://github.com/senukartur/vtc-dashboard/pull/5) and [VTC-005](https://trello.com/c/jgqgv1bd). This record does not claim that application or database integration is implemented.

Five P2 findings concerned missing read contracts. A successful write or an opaque ID did not let another reviewer, or a browser after reload, inspect the persisted decision inputs.

| Finding | Correction and validation boundary |
| --- | --- |
| Correction/resolution proposals were not readable | Add private bounded list/detail responses with immutable revision, reason, evidence, changed fields, base trip/fact versions and review outcome. Approval uses the current trip ETag and exact proposal revision; stale supporting facts require renewed review |
| Manual history and the staff's original rejection explanation were unavailable | Add private immutable manual-revision list/detail and retain `Decision.reason` alongside machine reason codes. A resubmitted example points the old rejection to revision 1 while revision 2 is pending |
| Qualification rules could be published but never read | Add published immutable rule-version list/detail for existing forms and historical explanations. Private evaluation snapshots identify the pinned level/rule/assignment; bounded owner/admin/trip-review assignment history exposes real interval boundaries without inventing retrospective assignments |
| Staff could not discover or inspect completed Steam replacement proof | Add owner status and administrator list/detail reads with candidate profile, bound member/identity epoch, expiry and state. Application requires an unexpired single-use verified proof for that member's current epoch; no callback secrets are exposed |
| Catalog publication had only completeness flags, without review data | Add administrator review manifest, version-pinned paginated entity diff, per-pack coverage and mapping issues. Expose build/release inventory and safe public provenance/permitted-use references; keep source archives and private paths out of responses |

The [wire schema](../contracts/dashboard/openapi.json), [examples](../contracts/dashboard/examples.json), [API semantics](../contracts/dashboard/README.md) and [UI journey map](../contracts/dashboard/ui-coverage.md) are updated together. Structural validation covers 119 operations, 160 fictional examples, 25 invalid payload cases, permission/guard annotations and four public-projection shapes. The [isolated probes](../../spikes/architecture/README.md) still do not establish real MySQL transactions, native sign-in, authorization enforcement, hosted operation or CI protection. Those remain explicitly owned implementation gates.
