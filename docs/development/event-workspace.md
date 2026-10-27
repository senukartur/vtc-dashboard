# Event workspace

VTC-035 adds the RU/EN event UI over the existing [Events APIs](events.md). Product policy remains in [CONCEPT.MD](../../CONCEPT.MD), especially scenarios 1, 2, 5, 14, 20–22, 30, 31, 33 and 39. This source integration does not activate Events, apply migrations, send notifications or deploy the service.

## Routes and use

| Route | Surface |
| --- | --- |
| `/`, `/en` | Small runtime public convoy widget; the build-time/no-JavaScript document retains a public-events link |
| `/events`, `/events/:eventId` | Public upcoming/past lists and detail; only public API endpoints are used, including while signed in |
| `/account/events`, `/account/events/:eventId` | Protected member lists/detail, own RSVP and paginated safe participating-member names |
| `/account/events/new` | Director/deputy creation form |

Lists use validated `period=upcoming|past` and an opaque URL `cursor`. Changing period resets the cursor. Pagination is server keyset pagination, never a browser fetch-all/filter operation. An obsolete cursor has an explicit first-page recovery action. Cancelled events retain readable detail; the nearest-event result excludes cancellation. The member header and dashboard share the same upcoming-event query, independent of RSVP and formatting locale. At the displayed event's start the header hides the expired event and refreshes once. If an ahead-of-server client clock receives the same event, the header offers the event list without repeatedly requesting it. Dashboard/report selections link to the protected event detail.

The event's title, game/server, route, meeting location and meeting/start times precede secondary details. The existing Yukon Union cards, tokens, native form controls and Radix dialog provide the visual/keyboard foundation. Layout targets are 1280×800, 768×1024 and 390×844, including Russian expansion and reduced motion.

## Time, catalogs and commands

Organizer controls are explicitly labelled UTC and show a preview in the member's display timezone. Calendar-valid input becomes a canonical millisecond `Z` instant. Meeting must not follow start; an optional end must not precede start. Member display follows self preferences; anonymous display follows the resolved browser timezone with UTC fallback. Each displayed instant includes its timezone and offset, so daylight-saving transitions are explicit. These settings do not change the company reporting timezone.

Canonical city/cargo/trailer IDs and exact mass strings are separate from labels. Selections are nullable and catalog lookups begin only when the organizer opens the selection controls. Retained IDs remain visible before opening them. An unavailable catalog does not erase retained IDs; the organizer can keep or explicitly clear them. A game change explicitly resets game-bound references. The server validates the current catalog and remains authoritative for all event/qualification behavior.

All reads validate generated envelopes, use the existing read scheduler and forward cancellation. Member cache keys include identity, session generation, access epoch and capabilities, with private cache metadata. Private views disappear on session/access loss. Public views never request participants, personal responses or attendance. Other members' decline reasons are loaded only when an authorized manager opens the responses/attendance panel.

Commands send CSRF and UUID idempotency keys, with separate definition, own-response and attendance collection ETags. Pending commands cannot be submitted twice. There is no automatic write retry. An unchanged uncertain retry retains its key; changed input or precondition creates a new identity. A stale response refreshes current authority while preserving entered input and requiring an explicit resubmission. Success copy confirms the committed change and makes no notification-delivery claim.

## Participation and report integration

Participation is voluntary. Members can choose unanswered, participating, or declined; declining requires a nonblank private reason. The author, director and deputies can read that reason. Ordinary members see only safe signed-up names. RSVP closes at the revised start or cancellation; rescheduling preserves the answer.

Director/deputy actual attendance is separate from RSVP and opens after start. The panel pages the current roster, uses the collection ETag and sends only rows intentionally changed by the organizer. Notes remain private. A failed transient/unknown attendance command retains its original body, precondition and retry identity, even if a later read observes new authority. A stale precondition instead exposes the preserved named drafts above every roster page; staff must find and review each current target row (or remove its draft) before explicitly resubmitting against refreshed authority. Cancellation is confirmed in an accessible dialog with a mandatory private reason.

An RSVP alone grants no qualification exception. The trip report/event selector links to the event, while [VTC-029](trip-decisions.md#event-participation-and-durable-work) owns the immutable association, staff-confirmed actual attendance, prescribed-load match and canonical contribution. This UI does not duplicate that decision pipeline. Event reminders and participant change notifications remain VTC-036.

## Verification ownership

`test/unit/event-workspace.test.ts` covers periods, strict UTC/DST display, decline omission/validation, command identity, generated envelope validation and RU/EN key parity. `test/e2e/events.spec.ts` exercises real routes/providers at a controlled network boundary, including privacy, stale input, pending writes, session loss, organizer/attendance dialogs, responsive fit and safe recovery states. Its screenshots use fictional data and remain in ignored local output; never publish authenticated captures.

`test/e2e/events-real.spec.ts` uses the guarded built API/MySQL browser fixture, isolating independent scenarios at their fixture boundaries. Staff create public/member events through the UI. Real anonymous/member/deputy/dispatcher contexts exercise visibility, private responses, voluntary RSVP, rescheduling, cancellation, staff attendance and report-to-event navigation. Owning fixture services supply unrelated setup, including immutable event histories. Attendance readback distinguishes RSVP-only support from an actual attendance revision with the prescribed load. The existing `test/e2e/trips-real.spec.ts` event journey supplies the integrated VTC-029 completion-report, unconfirmed-versus-confirmed participation, staff acceptance of 21000 kg against the fixture's ordinary 20000 kg limit, retained attendance reference and single canonical contribution checks. The minimal `newMember(roles)` fixture extension creates only fictional additive role combinations.

Run the contributor baseline and [isolated test launcher](testing.md). Controlled browser assertions establish frontend behavior; real API/MySQL journeys establish their integration. Exact-candidate verification, independent review, Required CI, merge and hosted activation are separate delivery gates. Necessary local synthetic captures belong under ignored `.local/` storage, outside public commits and PR attachments.
