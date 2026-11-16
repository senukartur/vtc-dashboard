# Qualifications

[VTC-157](https://trello.com/b/NwhwurSM/vtcdashboard) replaced the earlier rule-version, promotion-proof and confirmation model with one page per game, five trip limits and automatic promotion. The product rules are in [MVP policies](../product/mvp-policies.md#qualification-configuration-before-launch).

## Model

Three tables in `packages/db/src/schema/qualifications`:

- `qualification_levels`: one row per level and game, with a 1-based `position`, a name, the five limits, the promotion conditions and an edit `version`. A removed level keeps its row with `position = NULL` and `deleted_at` set, so stored trip snapshots and assignment history still resolve its name. A ladder holds at most 25 active levels.
- `qualification_level_trailers`: the trailer types allowed by a level in `selected` trailer mode, with a foreign key to the game's catalog row.
- `qualification_assignments`: half-open UTC periods `[assigned_at, ended_at)` per member and game. `kind` is `admission`, `promotion`, `manual`, `level_removed` or `reinstatement`. The generated `open_marker` and the unique `(user_id, game, open_marker)` index keep at most one open period per member and game. The unique `previous_assignment_id` keeps the history a chain.

The five limits are cargo mass (min/max kg), actual distance (min/max m), trailer types (`any` or `selected`), ADR (`forbidden`, `selected` or `any`) and Hard Mode (required or not). Empty bounds mean no limit. A `selected` mode needs at least one item. The conditions are a trip count and an actual distance; every set condition must be met. A non-top level must have at least one condition (`422 QUALIFICATION_CONDITIONS_REQUIRED`); a level without conditions never promotes.

`QUALIFICATIONS_ENABLED=true` requires Identity and Trips and has no other settings. The retired cursor key, ladder-edit and eligibility-tracking settings are ignored.

## Trip check

`checkTrip` in `apps/api/src/modules/qualifications/check.ts` is pure. It returns the five rules in a fixed order, each `pass`, `fail` or `unknown`, with the configured value and the trip value. A failure outranks an unknown rule. An unknown value is never zero:

- an incomplete trailer chain is unknown unless a known trailer is already outside the selected set;
- non-ADR cargo passes every ADR mode;
- a missing Hard Mode result counts as unknown when Hard Mode is required.

The [decision coordinator](trip-decisions.md) selects the member's level at the trip's attribution time, which is the actual start for telemetry and the staff confirmation for manual reports. It applies that level's current limits. A failed limit rejects the trip with `qualification_cargo_mass`, `qualification_distance`, `qualification_trailer`, `qualification_adr` or `qualification_hard_mode`. An unknown rule (`qualification_unknown`), an unknown level (`qualification_level_unknown`) or an unknown attribution time (`qualification_attribution_time_unknown`) sends the trip to staff review. Staff may accept a manual report over any of the five limits with an explicit confirmation.

A trip with current confirmed event attendance is credited without the level limits (`event_exempt`). Prescribed loads no longer matter for the check.

Each decision stores a snapshot of the level name, edit version, limits and rule results. Reads show `basis: decision` for decided trips, so later edits never rewrite history. Pending trips show `basis: current`.

## Promotion

`replaceContributionsInTransaction` records credits and then re-checks the affected members, and so does a level edit that changes conditions. A member whose credited trips and distance on the current level meet every set condition moves to the next level in the same transaction. The move appends a `promotion` period, an audit entry and a `qualification.promoted` outbox event. A revoked or merged trip never demotes.

Lock order is company, then sorted members, then assignments, then contributions. The unique open marker and predecessor indexes are the database backstop, so two concurrent credits produce exactly one promotion.

Leaving the first level in either game, whether by promotion, manual change or removal transfer, replaces a held Trainee role with Driver through the identity-owned same-transaction facade.

## Commands and reads

| Route | Capability |
| --- | --- |
| `GET /qualification-levels?game=`, `GET /qualification-levels/{id}` | `company.read` |
| `GET /me/qualifications`, `GET /members/{id}/qualifications` | `company.read` |
| `POST /admin/qualification-levels` | `qualifications.manage` |
| `PUT /admin/qualification-levels/{id}` and `/position` | `qualifications.manage` |
| `POST /admin/qualification-levels/{id}/removal` | `qualifications.manage` |
| `PUT /admin/members/{id}/qualifications/{game}` | `qualifications.manage` |

Writes take `expectedVersion` and return `409` on a stale version. Edits and moves return `promotedCount`. Removing a level moves its drivers to the chosen level as `level_removed` periods and shifts later positions up. A manual change needs a comment and is audited. A level's change history comes from the audit log and is shown only to managers (`history: null` for others).

## Web

`apps/web/src/features/qualifications` holds the single page at `/account/qualifications`, the level page and the level editor. The editor previews how many drivers a draft would promote. The trip and review pages share `QualificationCheckList`. Driver profiles read `/members/{id}/qualifications`. Hard Mode keeps its English name in both languages and shows the flame icon.

## Migration

`0035` maps the old model in place:

- level positions are kept and archived levels are soft-deleted;
- assignment purposes become kinds;
- open periods without a state row are closed at their own start;
- the rule versions, states, promotion proofs and reviews are dropped;
- outbox, routing and notification rows of the retired types are removed.

Ladder limits and conditions are not carried over, because the old rules have no equivalent. Staff configure them again after the upgrade. `test/integration/qualification-simplification-upgrade.test.ts` checks the mapping and that the upgraded schema equals a fresh one.
