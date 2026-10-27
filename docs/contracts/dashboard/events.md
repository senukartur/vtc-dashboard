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

The implemented identity registry contains `member.access_changed` v1: aggregate `{kind:"member",id:userId,version:membershipVersion}` and exactly `data:{userId,accessEpoch,identityEpoch}`. UUIDs are application IDs and versions/epochs are positive signed-INT values. Identity server composition appends on its command transaction, with `correlationId=eventId`, `causationId=null` until an explicit caller correlation seam exists. The four implemented admissions event types are described below. No downstream consumer is installed: immutable events remain visibly retained/unbound. Later reviewed subscriptions use bounded event/consumer anti-join catch-up without timestamp-only watermarks. Other table rows describe future owning workflows, not implemented schemas/effects.

## Implemented admissions safe events

VTC-015 registers `application.submitted`, `application.decided`, `invitation.reissued` and `invitation.redeemed`, schema version 1, aggregate `{kind: application, id, version}`, with data containing only `applicationId`. Event/correlation IDs are generated UUIDs; causation is null when no upstream event exists. No email, Steam URL, Discord/introduction, rejection reason, password, token or encrypted payload enters these events. They commit on the same transaction as admission state and remain retained without inventing an unconfigured downstream subscription. Identity's existing access event is additionally appended during atomic member creation. This does not claim delivery of a future notification/projection.

## Implemented catalog publication event

VTC-019 registers `catalog.published` schema version 1 with aggregate `{kind:"catalog",id:revisionId,version:candidateVersion}` and exactly `data:{catalogRevisionId}`. The publication pointer, immutable candidate transition, audit and event commit on the same transaction. Event/correlation UUIDs are generated; causation is null. No labels, source paths, artifact bytes, permission evidence or staff reasons enter this event. No downstream subscription is installed; events remain retained/unbound until a reviewed consumer owns its effects.

## Implemented source and trip safe events

VTC-022 registers `source.snapshot_stored`, `trip.lifecycle_changed` and `trip.facts_changed`, schema version 1, with exactly `data:{sourceRecordId,tripId,factRevisionId}`. The source event aggregate is `{kind:"source",id:sourceRecordId,version:1}`; trip events use `{kind:"trip",id:tripId,version:canonicalVersion}`. Immutable source revisions keep their own full safe-integer revision, independently of signed-INT application versions. Event/correlation IDs are generated and causation is null. The common event contains no source envelope, money, owner identity, review reasons or connection details. Producers commit with source/fact/projection/history writes. A canonical open refresh emits facts changed; benign obsolete revisions and exact replays emit no new lifecycle transition. Conflicting evidence can emit a fact change while effective facts remain fixed. Internal retained occurrence/receipt/delivery context is available through the owning facade for later suppression checks. No source/trip subscription, notification or accepted contribution is installed. See [trip implementation](../../development/trips.md).

## Implemented qualification safe events

VTC-028 registers schema-v1 `qualification.rules_changed`, `qualification.assigned`, `qualification.promoted`, `qualification.progress_changed` and `promotion.review_required`. Aggregate is `{kind:"qualification",id,version}` and closed data is exactly `{userId,assignmentId}`; both references are null only for level configuration events. Aggregate IDs refer to a level, assignment or immutable promotion proof respectively; versions describe that level/state/period/private review transition. Events carry no rules, thresholds, staff reason, evidence or private explanation. A correction emits a promotion alert only on an invalidating review-state transition and never demotes. All events commit with domain state and remain unbound until reviewed downstream consumers are installed; notification delivery is VTC-036.

## Implemented Events safe events

VTC-034 registers closed schema-v1 `event.changed`, `event.response_changed` and `event.attendance_changed`. Common data is exactly `{eventId,eventRevisionId,revisionId,changeSequence,memberId,category}`. `memberId` is non-null only for response changes. Definition categories are `created|updated|cancelled`; response/attendance categories are `response|attendance`. Aggregates are respectively `{kind:event,id:eventId,version:definitionVersion}`, `{kind:event_response,id:responseId,version:ownResponseVersion}` and `{kind:event_attendance,id:eventId,version:attendanceCollectionVersion}`. UUIDs and positive signed-INT versions are validated. No private reason, note, organizer text or load evidence enters the common event.

The per-event change sequence orders immutable definition/RSVP/attendance history independently of those three version namespaces. A definition consumer reconstructs signed-up recipients immediately before its change through Events' bounded latest-prior-response lookup, then rechecks current access. Attendance batch events reference a representative last revision plus the sequence; the entire batch remains in owning history. VTC-036 installs a typed definition/response consumer and current-generation reminder work; attendance remains unbound to notifications. Cancellation/rescheduling generation fences and current RSVP checks hide obsolete reminders. Attendance/definition changes also signal accepted-trip review without rewriting contributions. See [Events implementation](../../development/events.md) and [notification policy](../../development/notifications.md).

## VTC-026 correction event

`trip.correction_recorded` v1 uses the canonical trip aggregate/current version and safe data `{reconciliationId,primaryTripId,secondaryTripId,reconciliationVersion}`. Apply/reverse persists it with membership, history, contribution replacement, receipt and audit. Private reasons, snapshots, report evidence and source payloads are excluded. Consumers must load current authorized state and use monotonic contribution/aggregate versions; no new consumer/subscription or notification delivery is claimed. See [reconciliation](../../development/reconciliation.md).

`trip.proposal_reviewed` v1 is an Acceptance-owned safe event on canonical trip/version with only `{proposalId, reviewedRevisionId}`. Proposal review/audit/outbox commit together, including rejection before any terminal trip decision. It does not assert that the effective trip outcome or contribution changed; analytics and notification consumers remain unbound.
