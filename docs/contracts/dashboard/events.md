# Versioned domain events and effects

Internal events are persisted with domain changes in the same MySQL transaction. They are not public browser messages or raw telemetry envelopes. The platform owns delivery; the producing module owns event meaning. All are initially version 1, with explicit schema validation before consumption.

```json
{
  "eventId": "41000000-0000-4000-8000-000000000001",
  "type": "trip.decision_changed",
  "schemaVersion": 1,
  "aggregate": {"kind": "trip", "id": "42000000-0000-4000-8000-000000000001", "version": 7},
  "occurredAt": "2026-10-17T12:00:00.000Z",
  "correlationId": "43000000-0000-4000-8000-000000000001",
  "causationId": null,
  "data": {"decisionId": "44000000-0000-4000-8000-000000000001", "contributionVersion": 3}
}
```

This is a fictional example. Do not add emails, decline reasons, screenshots, raw source evidence, session/telemetry tokens or invitation/leadership codes to a common event. Consumers load authorised private facts through the owning facade. HTTP request IDs are for safe correlation, never secret-bearing headers/URLs.

| Event type | Producer | Consumers and idempotent effect |
| --- | --- | --- |
| `member.access_changed` | Identity | Revoke/gate current access and source eligibility, stop obsolete delivery; current membership remains the synchronous authority |
| `application.decided` / `invitation.issued` | Admissions | Private transactional-mail delivery job referencing the owned encrypted payload; manual copy remains independent of delivery success |
| `source.snapshot_stored` | Sources | Normalize/process the immutable source revision; does not directly increment stats or create start/end toasts |
| `trip.lifecycle_changed` | Trips | Derive one canonical start/end transition; suppress backfill/stale/redundant snapshot toasts |
| `trip.decision_changed` / `trip.reconciled` | Acceptance / trips coordinator | Replace the canonical contribution at its new version, recompute affected progress/totals, notify permitted recipients once |
| `qualification.assigned` / `promotion.review_required` | Qualifications | Update versioned progress period or notify administrators; never automatically demote |
| `event.changed` / `event.response_changed` / `event.attendance_changed` | Events | Invalidate/reschedule reminder generations, notify signed-up members of approved change categories, evaluate pending exception-related review |
| `catalog.published` / `qualification.rules_published` | Catalogs / qualifications | Invalidate eligible lookup caches and schedule explicit review; never mutate historical rule/fact snapshots |

Delivery is at-least-once with `(consumer,eventId)` unique handling and aggregate/contribution version guards. A replay or out-of-order lower revision cannot produce another trip, progress increment, reminder or toast. External mail is not claimed exactly-once: use provider idempotency where available, record delivery ambiguity and bounded retry, and keep one-time generation validity authoritative in the database.

Notifications store recipient/category/subject revision and safe navigation references. Recipient permissions are checked on creation, delivery and read; current resource access wins over old event eligibility. The agreed company start/finish activity can show a safe nickname/game transition without private report details; its navigation target is null when the trip is inaccessible. Private event/review messages still require their subject permissions. A cancelled event or superseded reminder generation is skipped after recovery. Changes in attendance may create a review proposal, but cannot silently rewrite an accepted trip while staff resolution is required.

Schema changes are additive and reviewed by producer/consumer owners. Unknown versions enter visible failure investigation, never silent discard or best-effort casts. VTC-021 implements the [durable platform](../../development/jobs.md); VTC-008 provides fixtures, and VTC-036/040 validate recipient privacy and end-to-end effects.

The implemented registry contains only `member.access_changed` v1: aggregate `{kind:"member",id:userId,version:membershipVersion}` and exactly `data:{userId,accessEpoch,identityEpoch}`. UUIDs are application IDs and versions/epochs are positive signed-INT values. Identity server composition appends on its command transaction, with `correlationId=eventId`, `causationId=null` until an explicit caller correlation seam exists. No downstream consumer is installed: immutable events remain visibly retained/unbound. Later reviewed subscriptions use bounded event/consumer anti-join catch-up without timestamp-only watermarks. Other table rows describe future owning workflows, not implemented schemas/effects.

## Implemented admissions safe events

VTC-015 registers `application.submitted`, `application.decided`, `invitation.reissued` and `invitation.redeemed`, schema version 1, aggregate `{kind: application, id, version}`, with data containing only `applicationId`. Event/correlation IDs are generated UUIDs; causation is null when no upstream event exists. No email, Steam URL, Discord/introduction, rejection reason, password, token or encrypted payload enters these events. They commit on the same transaction as admission state and remain retained without inventing an unconfigured downstream subscription. Identity's existing access event is additionally appended during atomic member creation. This does not claim delivery of a future notification/projection.
