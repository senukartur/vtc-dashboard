# MVP Product Policies

Owner-approved detailed product rules for the MVP. [CONCEPT.MD](../CONCEPT.MD) gives the short idea and feature list; this file holds the normative rules and acceptance scenarios that implementation, contracts and tests follow. Scenario numbers are stable references.

Change this file only when the owner approves new or changed behavior. Edit the affected rule or scenario in place, keep it concise, and update affected contracts and tests together. Do not add status, dates, card progress or evidence logs; put those in the PR description.

## Trip sources and notifications

- A driver creates a personal, scoped, revocable telemetry token. A token authenticates the submitter and must not let a client choose a different trip owner.
- At the telemetry client's first dashboard connection, all retained local game trips upload automatically, followed by new trips and material changes. Partial/cancelled/closed outcomes stay visible; upload does not imply acceptance or qualification credit. Previously bound records are not reassigned on account/token switch. Synchronization is client-to-server only.
- An imported telemetry trip with unknown historical qualification stays visible but needs staff review before statistics/progress credit; today's qualification is never substituted. With supported historical facts, normal automatic validation applies.
- Future Trucky/VTCBase webhooks are company-wide connections configured by the director/deputies, not by individual drivers, and feed the same acceptance/statistics pipeline.
- Notifications: bounded background work once per minute and authenticated polling every 30 seconds while the site is visible (paused while hidden/offline, refreshed on return). About 90 seconds is the healthy delivery target, not a guaranteed maximum. Web Push and SSE are later work.

## Game catalogs and localization

Maintain local, versioned catalogs for ETS2/ATS cities, regions, cargo, and trailer classifications. Investigate reliable data/API/extraction sources in VTC-002 before promising complete coverage.

The owner confirmed the MVP launch target on 2026-10-17: cover the base games and **all official DLCs for both ETS2 and ATS**, rather than only the packs used by the current members. Pin the launch build/release inventory and verify every pack's catalog contribution; record packs that add no relevant entities as checked/non-contributing. A partially tested installation or sample is not evidence of this complete coverage. New DLCs after that baseline enter the versioned update workflow.

The owner approved handing the unavailable Louisiana, Illinois and South Dakota ATS source checks from VTC-002 discovery to VTC-019, with their resolution still mandatory before launch. Record explicit coverage gaps rather than blocking unrelated architecture work or claiming the research sample is a complete production catalog.

Canonical identity is independent of RU/EN labels. Prefer provider/game IDs and scoped mappings; name-only aliases need game, locale, region/map context and an ambiguity path. Changing language must not alter selected IDs or rule outcomes. Distinguish cargo unit mass from actual shipment mass.

Maintain project-reviewed RU/EN labels separately from canonical/source IDs. The owner approved an explicit English-name fallback when a Russian translation is missing; complete Russian translation is not a launch prerequisite. Mark the fallback visibly and keep untranslated entries in a translation queue. An unreadable source token is a diagnostic value, not a completed English label. Fallback display does not establish a trusted name-matching alias or change qualification results.

Track game build, DLC/map coverage, provenance, publication version, and additions/changes/retirements. Preserve historical entities and rule references after DLC updates. Use an explicit import/diff/review/publish workflow; arbitrary mod support is later work.

The project's technical maintainer prepares updates; the Director or Deputy Director reviews and publishes them. Maintenance is an operational responsibility, not an additional dashboard role. The [VTC-002 source hand-off](../research/catalog-source-follow-up.md) records the measured coverage and remaining source/import/release gates.

### Catalog source use basis

On 2026-10-20 the owner selected closed, non-commercial use of game-derived catalog metadata for this VTC, from the owner-authorized game/DLC installations. A separate SCS permission reply is not a prerequisite for this selected delivery scope. This records the owner's project decision; it does not claim a provider permission grant or authorize public bulk redistribution of extracted definitions, label/localization corpora or game assets. Preserve attribution, exact private provenance and independent dataset review. Public Git contains original machinery, fictional fixtures and aggregate evidence. Production deployment and activation remain separate operational gates.

## Permission matrix

Administrative roles add permissions to the user's member roles; game qualifications do not grant administrative access. The detailed visibility rules below also apply to every action.

| Action | Trainee / Driver | Dispatcher | Deputy Director | Director |
| --- | --- | --- | --- | --- |
| Read member dashboard, accepted trips, directory, qualifications, company statistics | Yes | Yes | Yes | Yes |
| Submit own reports, manage own telemetry token, respond to events | Yes | Through member role | Through member role | Through member role |
| Read own pending/rejected reports and evidence | Yes | Yes | Yes | Yes |
| Review other members' manual/disputed trips and evidence | No | Yes | Yes | Yes |
| Accept another member's manual report over ordinary qualification limits, after explicit confirmation | No | Yes | Yes | Yes |
| Approve own manual report | No | No | No | No |
| Review applications and send or copy invitations | No | No | Yes | Yes |
| Manage events and confirm actual participation | No | No | Yes | Yes |
| View an accessible event's participant and decliner lists | Yes | Yes | Yes | Yes |
| View an event's list of members who have not answered | No | No | Yes | Yes |
| Read another member's event-decline reason | No | No | Yes | Yes |
| Configure qualifications and confirm promotion | No | No | Yes | Yes |
| Set a member's membership directly to Trainee or Driver | No | No | Yes | Yes |
| Administer users/roles, deactivate or reinstate ordinary members | No | No | Yes | Yes |
| Replace a member's Steam link on request | No | No | Yes | Yes |
| Configure company integrations and reporting settings | No | No | Yes | Yes |
| Transfer leadership | No | No | No | Serving director only, with email code |
| Delete/deactivate the serving director or remove the Director role outside succession | No | No | No | No |
| Change the director's email/login credentials | No | No | No | Self-service with confirmation via current verified email |

Anonymous visitors may view public landing/event content and submit membership applications. The landing may show only company aggregates: active member count and the current reporting month's accepted trips, actual distance and games, without identities or per-driver data. Member-only data, event participant and decliner lists, and decline reasons are not public.

## Confirmed roles and responsibilities

The five MVP roles are Trainee, Driver, Dispatcher, Deputy Director, and Director. A user may hold multiple roles; qualifications are separate from access permissions.

| Role | Confirmed responsibility |
| --- | --- |
| Trainee | Standard member capabilities; driving restrictions are defined by qualification. |
| Driver | The same standard member capabilities as a trainee; driving restrictions are defined by qualification. |
| Dispatcher | Review manual trip reports and investigate disputed trips. |
| Deputy Director | The same administrative permissions as Director, except director-only leadership transfer and protected changes to the serving director's account. |
| Director | Full administrative access, including membership applications, event management, users, qualifications, and company integrations. |

There must be exactly one director after the initial company bootstrap. Administrative roles are additive: the director can also hold Driver and have independent ETS2/ATS qualifications. Assigning an administrative role must not replace driver membership or qualification history. Trainee-to-driver promotion changes only those membership roles and preserves other assigned roles. The director or deputy may also set a member's membership directly to Trainee or Driver. This audited change replaces only that membership role and does not change game-specific qualifications or other assigned roles.

Do not delete or deactivate the serving director or remove their Director role without the director-only succession workflow below. A deputy cannot transfer leadership through direct role assignment or remove/deactivate the serving director. Do not allow multiple directors as an implementation shortcut.

The deputy's permission parity includes applications/invitations, event management and participation confirmation, private decline reasons, manual/disputed report review, qualification configuration and promotions, user/role administration, Steam replacement, and company integrations. Leadership succession and protected changes to the serving director's account remain exclusive to that director. General constraints such as the prohibition on approving one's own manual report apply to both roles. In the workflows below, director administrative responsibilities also apply to the deputy except for those explicitly protected operations.

Membership application review and event management belong to the director and deputy in the MVP. Separate recruitment and event-organizer roles are deferred. Joining or responding to an event is a standard member capability, distinct from managing it.

## Director-only leadership transfer

- The serving director selects another active member and confirms transfer. Only the serving director may authorize this operation.
- Change the Director role in one atomic operation so exactly one director remains. The former director retains Driver membership, game-specific qualifications, and historical trips.
- Require the email-code verification below before executing transfer.
- Deputy administration must not provide an alternate path to succession. Implementation must enforce the code limits below, concurrency safety, and replay protection.

### Confirmed email-code verification

- Send a one-time code to the serving director's verified email. The code is bound to that director and the selected successor, expires after ten minutes, and is invalidated after use or replacement. Each code allows at most five entry attempts; after five incorrect entries it is invalidated. The serving director may request a new code no sooner than 60 seconds after the previous one, and at most five codes in any 60-minute period.
- Execute the atomic transfer only after the serving director enters the valid code. A changed successor requires new confirmation.
- Only the serving director may change their email or login credentials, with confirmation through the existing verified email. Deputies cannot change those settings, redirect the transfer code, or recover access through an administrative bypass.

## Confirmed access and visibility

| Capability or information | Confirmed access |
| --- | --- |
| View the dashboard and company statistics | Standard members, including trainees and drivers. |
| View the driver directory and other members' qualifications | Standard members. |
| View accepted trips of other members | Standard members. |
| Submit a manual trip report | Trainees and drivers. |
| Generate a personal telemetry token and submit telemetry trips | Trainees and drivers. |
| View events and respond to participation requests | Trainees and drivers. |
| View a manual report awaiting review, rejection reasons, or attached evidence | The report's author and authorized staff: dispatchers reviewing trips, directors, and deputies. This information is not generally visible to other members. |
| Review membership applications | Director or deputy. |
| Create and manage events | Director or deputy. |
| Review manual reports and disputed trips | Dispatcher, director, or deputy. A manual report must be reviewed by someone other than its author; no role may approve its own report. |
| Configure company-wide webhook integrations | Director or deputy; external provider adapters remain deferred as defined on the Later cards in Trello. |
| Transfer company leadership | Serving director only, with additional verification. |

Accepted-trip visibility does not make its restricted rejection/review history or evidence public to other members. Public event information on the landing page remains supported by the planning baseline; member-only driver and trip visibility does not imply anonymous public access.

The members administration list shows each member's most recent accepted trip as its activity signal. The dashboard does not add sign-in or other site-activity tracking for this purpose.

## Trainee and driver equivalence

Trainees and drivers have the same basic dashboard capabilities. Qualification rules determine which loads, trailers, and other supported trip conditions are permitted; trainee status does not impose an additional set of website restrictions.

Qualifications remain separate for ETS2 and ATS. The confirmed initial progression in each game is **Trainee → Driver III → Driver II → Driver I**, with configurable names and requirements. MVP promotion progress uses accepted-trip count and total distance. Minimum tenure, cargo-damage criteria, and other promotion metrics are outside the initial MVP promotion requirements. Future reputation and spendable points must not be used as implicit MVP permissions.

## Qualification configuration before launch

- The initial supported qualification restrictions are maximum cargo mass, allowed trailer types, and hazardous-cargo category permissions (ADR), configured separately for each level and game.
- Keep restriction types extensible as specified in the planning baseline. The initial set is not a hard-coded limit on future rule types.
- The director configures actual qualification limits and accepted-trip/distance promotion thresholds before launch. No concrete numeric values have been supplied or approved during this clarification.
- Implementation may proceed with the agreed configuration model and clearly identified test fixtures; actual production values remain a director-owned launch prerequisite rather than invented defaults.

## Qualification timing and promotion

- For trips with a known actual start time, evaluate the driver's qualification and rule versions effective at that start, independently of submission or processing time.
- A qualification or rule change during such a trip does not change the versions used to assess it. A delayed report with a known start uses the historical versions applicable at that start.
- If the trip start time is unknown, require manual review rather than automatically substituting receipt or completion time.
- The system calculates promotion progress and signals when the defined requirements are met. The director or deputy confirms promotion; meeting a threshold alone does not automatically change a role or qualification.
- Director/deputy confirmation applies both to the transition from trainee to driver and to subsequent qualification levels.
- Each level has a separate promotion-progress period beginning when that level is assigned in the relevant game. For telemetry trips, count accepted trips started after that assignment; trips from earlier levels remain in historical statistics but are not reused for the next promotion.
- For manual reports without a trip date, use the qualification and rule versions effective at confirmation/acceptance. Attribute their progress to the game-specific qualification level assigned at that confirmation time. This is an explicit source-specific policy and does not establish an actual trip-start timestamp.
- After director/deputy-confirmed completion of the trainee stage in at least one game, the user receives the global Driver role instead of Trainee. The other game's qualification and restrictions remain unchanged; the driver may therefore have Driver III in ETS2 and Trainee qualification in ATS. The director or deputy may also set the global Trainee or Driver role directly; that change leaves every game-specific qualification and its progress period unchanged.
- When an accepted trip is corrected or its acceptance is revoked, recalculate affected statistics and qualification progress. If the change invalidates the requirements for a previously confirmed promotion, notify the director and retain the assigned qualification until the director decides what to do. Never automatically demote a driver.

## Qualification exceptions for company events

The owner confirmed the current company policy: qualification restrictions do not prevent participants in a company-wide event from carrying the load prescribed by that event, regardless of their ordinary qualification level. This exception is part of the event policy, rather than a separate discretionary waiver that the director must grant to each participant. It is also distinct from the discretionary over-limit acceptance in [manual report review](#manual-report-review-and-resubmission): a trip covered by this exception is accepted normally, not marked as accepted over limits.

The event's conditions determine the permitted load. For the MVP, a driver selects the event when submitting the report, and the director confirms actual participation. An RSVP alone does not establish participation. Automatic association of telemetry trips using event conditions may be added later; it is not an MVP prerequisite.

Accepted trips for a confirmed company-wide event count toward qualification progress, including when the prescribed load would be outside the driver's ordinary qualification limits. They contribute accepted-trip count and distance within the relevant level's progress period and count in company statistics as accepted canonical trips, without duplicate effects. Actual numeric thresholds are configured by the director before launch.

For the agreed initial restriction types, the prescribed-load exception covers ordinary cargo-mass, trailer-type, and hazardous-cargo qualification limits. The previously agreed evidence and review workflow still applies.

## Event responses, reminders, and privacy

- Members may change their participation response until the event starts. A decline requires a reason.
- After the event starts, the director records actual attendance separately from the member's prior response. The previously agreed director confirmation is used for event-trip participation.
- Send an in-app reminder one hour before the event starts to members whose response is Participating. Notifications are delivered while the website is open; Web Push remains deferred.
- Show the nearest upcoming event in the header to VTC members who may access that event, regardless of their participation response.
- VTC members with access to the event can see who signed up and who declined. A decline reason is visible only to its author, the director, and deputies, reflecting the deputy's confirmed administrative parity. Only the director and deputies can see which members have not answered.
- Public event pages do not expose participant or decliner lists, unanswered members, or decline reasons.

Response and actual attendance are distinct facts. Participation is voluntary in the MVP: members may leave an event unanswered, and the system imposes no automatic penalty for declining or not attending. The director can view responses and actual attendance, subject to the confirmed privacy rules.

Notify signed-up participants inside the website when the start time or route changes or the event is cancelled. A time change reschedules the one-hour reminder; cancellation removes scheduled reminders. Keep the participation response when an event changes, and allow members to change it until the revised start time.

## Membership application fields

The owner approved the following field set for the public membership application.

| Field | Requirement |
| --- | --- |
| In-game nickname | Required. |
| Email for the invitation | Required. |
| Steam profile link | Required. |
| Games played | Required: ETS2, ATS, or both. |
| Discord | Optional. |
| Short introduction | Optional. |

Application review is the director's or deputy's responsibility. The required email is retained even when an invitation is delivered manually through another channel.

## Application decisions and invitations

- A director rejecting an application must provide a reason. Email the reason to the applicant and preserve the application and decision history.
- Rejected candidates may submit a new application; rejection does not erase the prior application.
- After approval, provide a one-time invitation link for setting the account password, valid for seven days.
- Approval does not send the invitation email automatically. The director or deputy delivers the link with an explicit Send to email action, or copies it for manual delivery through Discord, Steam, or another messenger. Manual delivery must not depend on successful email delivery; the dashboard is not required to send messenger messages itself.
- The same one-time use and expiry rules apply regardless of delivery channel. Reissuing an invitation invalidates its previous link.

## Departure and account deactivation

- Deactivate the account when a member leaves the company. Block dashboard sign-in, revoke existing sessions, and revoke personal telemetry tokens.
- Retain the member's trips, statistics, and action history. Display a Former member indicator on the profile.
- This workflow uses deactivation rather than deleting the account and its historical contributions. The sole-director protection above applies.
- On a former member's return, restore the same account and historical trips. The director assigns roles and qualifications anew rather than automatically restoring earlier privileges. Previously revoked sessions and telemetry tokens remain invalid; the driver creates a new telemetry token.

## Steam identity changes

- Only the director or deputy may replace a linked Steam profile, following a driver's request. Preserve an audit history of the identity change.
- Revoke personal telemetry tokens when the linked profile changes. Previously recorded trips remain owned by the same local user; changing the Steam link must not transfer historical trips to another user.
- Verification of Steam ownership and provider-specific mapping behavior belong to the identity/telemetry integration work; this policy does not authorize bypassing identity verification.

## Manual report review and resubmission

- Every manual report requires a different authorized reviewer. Dispatchers, deputies, and directors may not approve their own manual reports; there are no role-based exceptions.
- An authorized reviewer other than the author may, at their discretion, accept a manual report that breaks ordinary qualification limits when no event exception applies. Before acceptance, show every exceeded limit and require explicit confirmation. Record the decision as accepted over limits, together with the reviewer. This waives only qualification limits, not other report requirements or review rules; the accepted trip then follows the ordinary statistics and progress rules.
- The author may correct a rejected manual report and resubmit it for review.
- Resubmission creates a new report revision for the same canonical trip. Preserve the previous version, rejection reason, and review history.
- A corrected submission must not create a second trip or duplicate statistics, qualification progress, or other trip effects.
- Every manual report must include at least one screenshot of the trip completion/results screen. Telemetry-confirmed trips do not require a screenshot.
- While a report awaits a decision, its author may edit it; preserve the changes in its revision history. A review decision must apply to the revision actually reviewed.
- After acceptance, the author requests a correction from a dispatcher, deputy, or director instead of directly editing the accepted record. Staff changes must retain an audit history and recalculate affected statistics. The prohibition on approving one's own manual report still applies.
- There is no submission deadline for manual reports in the MVP. The manual form does not collect the trip date; its reporting period is determined by confirmation, as specified below.

The required manual-report fields are game, origin city, destination city, cargo, cargo mass, trailer type, actual driven distance, and at least one screenshot. Event association and a comment are optional. Do not request a trip date. Undated manual reports require human review and use qualification/rules and progress attribution at confirmation time as agreed above.

## Screenshot retention

- Retain report screenshots for at least one year after the report's latest decision.
- Do not remove screenshots while a report is under review. Retention cleanup must account for renewed review and later decisions.
- Screenshot expiry does not remove the trip's structured data or decision history.
- File formats, per-file limits, image processing, and storage-capacity validation are implementation/operations work in VTC-025 and VTC-039. Do not treat the expected low upload volume as measured capacity evidence.

## Analytics metrics and period attribution

- Headline trip totals and distance statistics include accepted canonical trips only. Display pending-review and rejected trips as separate counters rather than including them in accepted totals.
- Sum actual driven distance. Retain planned route length as a separate metric; do not mix it into actual-distance totals.
- A manual report supplies actual driven distance, which the reviewer verifies against its screenshot.
- Corrections and acceptance revocation recalculate affected statistics without counting the canonical trip twice.
- For telemetry trips, attribute reporting periods to the actual trip completion date/time, including telemetry delivered after the trip finished.
- For manual reports without a trip date, attribute reporting periods to the report's confirmation/acceptance date/time, rather than an invented trip-completion timestamp.
- Preserve the distinction between trip timestamps and review/acceptance timestamps. A manual report's acceptance date does not establish when the trip actually started or ended.
- Use one company-wide reporting timezone for daily/monthly statistics, configured by the director before launch.
- Display event times in the user's timezone with an explicit timezone indication. A user's display timezone must not silently change company reporting-period boundaries.

## Late telemetry after a manual report was accepted

- Represent the matching manual report and later telemetry as two sources for one canonical trip.
- If the new data would change the confirmed decision, reporting period, or qualification progress, require dispatcher/deputy/director review before applying those changes. Preserve the previously confirmed result while review is pending.
- Retain both sources and the decision history. A confirmed reconciliation recalculates affected totals/progress rather than creating another trip. Previously agreed self-approval restrictions and the prohibition on automatic demotion still apply.

## Acceptance scenarios for the confirmed decisions

1. A trainee can open the dashboard, view accepted company trips, submit a manual report, manage a personal telemetry token, and respond to an event, just as a driver can.
2. Changing from trainee to driver does not independently unlock an unrelated dashboard action; qualification changes affect supported trip eligibility rules.
3. A member can read another member's accepted trip and qualification but cannot read that member's pending manual report, rejection reasons, or evidence without the appropriate staff permission.
4. A user holding both driver and dispatcher roles retains normal driver capabilities and receives trip-review permissions. The user cannot approve its own manual report. The same restriction applies to a director.
5. A director or deputy can review applications and manage events. Trainee, Driver, or Dispatcher roles alone do not grant those management permissions.
6. An applicant must supply a nickname, invitation email, Steam profile link, and at least one of ETS2/ATS. The applicant can omit Discord and the introduction.
7. An author corrects a rejected report and resubmits it. Staff can inspect the prior revision and rejection reason; the system retains one canonical trip and sends the new revision for review.
8. A manual report without a completion-screen screenshot cannot be submitted. A telemetry-confirmed trip does not require a screenshot.
9. An author edits a pending report. The revision history retains the previous values, and a reviewer cannot approve an obsolete revision as if it were the current report.
10. An author requests a correction to an accepted report. An authorized staff member records the correction with its history; affected statistics are recalculated without creating another trip.
11. A driver submits a manual report without entering a trip date and provides the required evidence. Its age alone does not prevent submission. Once confirmed, it belongs to the reporting period containing its confirmation time, is checked against the qualification/rules at confirmation, and contributes to that game-specific level's progress.
12. A rule or qualification changes after a trip starts but before it finishes or is submitted. The assessment uses the historical versions effective at the start.
13. A driver meets the configured promotion requirements. The system shows eligibility, but the role/qualification changes only after director/deputy confirmation.
14. A trainee selects a company-wide event on a report for its prescribed load, and the director confirms actual participation. Ordinary qualification restrictions do not prevent that load; once accepted, the trip also contributes to qualification progress. An RSVP without actual-participation confirmation does not authorize the exception.
15. ETS2 and ATS each expose the configurable initial sequence Trainee → Driver III → Driver II → Driver I. Qualification progress in one game must not silently promote the driver's qualification in the other game.
16. A director confirms promotion to Driver III in ETS2. Progress toward Driver II uses accepted telemetry trips started after the Driver III assignment and manual reports confirmed while that level is assigned; earlier credited trips remain in lifetime statistics. The same progression rules apply independently in ATS.
17. A member finishes the trainee stage in ETS2 but remains a trainee in ATS. Their global role becomes Driver, while the ATS qualification remains Trainee with its restrictions.
18. A director configures the production limits and promotion thresholds independently for each level and game before launch; implementation fixtures are not presented as approved company limits.
19. A corrected or revoked trip reduces the progress that justified an existing promotion. The system recalculates the affected totals and alerts the director, while retaining the assigned qualification pending the director's decision.
20. Before an event starts, a member changes Participating to Declined and supplies a reason. After the start, response editing is closed and the director records actual attendance separately.
21. One hour before an event, an in-app reminder targets members who selected Participating. The upcoming-event header remains visible to other VTC members who may access the event.
22. A VTC member can view the event's signed-up participant list but cannot read another member's decline reason without the Director or Deputy Director role. An anonymous visitor to a public event page sees neither the participant list nor decline reasons.
23. A director rejects an application with a reason; the applicant receives the reason by email and may submit another application while the earlier decision remains in history.
24. A director approves an application and copies its invitation link for manual delivery through Discord. The candidate can use the link to set a password within seven days, without relying on the email having been delivered. A consumed, expired, or replaced invitation cannot be reused.
25. A member leaves the company. Their existing session and telemetry token no longer grant access, while their profile is marked Former member and historical trips/statistics remain available according to the agreed visibility rules.
26. A telemetry trip finishes in January and arrives later. Use its actual January completion time for reporting-period attribution. A manual report without a trip date, confirmed in February, belongs to the February reporting period.
27. A pending or rejected report does not increase accepted-trip totals or accepted distance. Accepting it adds one canonical trip; correcting or revoking acceptance updates the affected totals rather than adding another trip.
28. A manual report records actual distance that differs from planned route length. The reviewer verifies the actual value against the screenshot; company and qualification-distance totals use the actual distance.
29. A previously accepted manual report receives matching telemetry that would change its reporting period or progress. The system retains one canonical trip and the confirmed result pending staff review; only a reviewed decision applies those changes.
30. A member leaves an event unanswered or signs up but does not attend. The director can record actual attendance, but the MVP does not impose an automatic penalty.
31. An event's start time changes. Signed-up participants receive an in-app update, their responses are preserved, response editing follows the revised start, and the one-hour reminder is rescheduled. Cancelling the event notifies them and removes its scheduled reminders.
32. A manual report includes game, origin/destination cities, cargo, mass, trailer type, actual distance, and a screenshot, while omitting the optional event/comment and any trip date. The form accepts that field set for review.
33. Two members use different display timezones. Company daily/monthly totals use the same configured reporting timezone; event times are displayed in each user's timezone with an explicit label.
34. A report screenshot is younger than one year since the latest decision or its report is under review. Retention cleanup must preserve it; expiry of an eligible older screenshot does not erase trip facts or decision history.
35. A former member returns. The same account and trip history are retained, the director assigns roles/qualifications anew, and old sessions/tokens remain invalid.
36. A director also holds Driver III qualification in ETS2. Their administrative role does not replace Driver membership or alter their game-specific qualification limits.
37. An operation would delete/deactivate the sole director, remove the Director role outside succession, or assign a second director. The operation is rejected. A deputy's general role-administration permissions cannot bypass this protection.
38. A director changes a driver's linked Steam profile after a request. The change is audited, telemetry tokens are revoked, and historical trips retain their local owner.
39. A deputy performs application/event/user administration, qualification promotion, Steam replacement, or integration configuration under the same constraints as the director. A leadership-transfer request from that deputy is rejected.
40. The serving director transfers leadership to another active member after the required additional verification. Exactly one director remains, and the former director retains driver membership, qualifications, and trip history.
41. The serving director selects a successor and receives a one-time code at their verified email. A code older than ten minutes, already used/replaced, or associated with another successor cannot authorize transfer.
42. A deputy attempts to change the serving director's email/login credentials or bypass succession through role administration. The operation is denied; a director's own credential change requires confirmation through the current verified email.
43. A director or deputy sets a member's membership from Trainee to Driver, or back to Trainee, without a promotion confirmation. The change is audited; ETS2/ATS qualifications, their progress periods and other assigned roles stay unchanged. Trainee, Driver, or Dispatcher roles alone cannot make this change.
44. A director approves an application. No invitation email is sent until the director or deputy chooses Send to email; alternatively they copy the link and send it through Discord or Steam. Either way the same one-time use and seven-day expiry apply.
45. After five incorrect entries, a leadership-transfer code cannot authorize transfer, even with the correct value. A new code requested within 60 seconds of the previous one, or a sixth code within 60 minutes, is refused.
46. A dispatcher reviews another member's manual report whose cargo mass exceeds the driver's ordinary limit, and no event exception applies. The review shows every exceeded limit. The dispatcher accepts only after explicit confirmation, and the decision is recorded as accepted over limits with that dispatcher. The author cannot make this decision on their own report. A trip covered by the event exception in scenario 14 is accepted without the over-limit marker.
47. A VTC member with access to an event sees its participant and decliner lists, but not decline reasons or the members who have not answered. The reason's author, the director and deputies can read a decline reason. An anonymous visitor to a public event page sees none of these lists.
48. The members administration list shows each member's most recent accepted trip and no sign-in or site-activity data.


These are approved requirements scenarios, not evidence that the application is implemented or tested. Administrative examples apply equally to a deputy unless the action is explicitly reserved to the serving director.
