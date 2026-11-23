# Qualifications

[VTC-157](https://trello.com/b/NwhwurSM/vtcdashboard) replaced the earlier rule-version, promotion-proof and confirmation model with one page per game, five trip limits and automatic promotion. The product rules are in [MVP policies](../product/mvp-policies.md#qualification-configuration-before-launch).

## Model

Three tables in `packages/db/src/schema/qualifications`:

- `qualification_levels`: one row per level and game, with a 1-based `position`, a name, the trip limits, the promotion conditions and an edit `version`. A removed level keeps its row with `position = NULL` and `deleted_at` set, so stored trip snapshots and assignment history still resolve its name. A ladder holds at most 25 active levels.
- `qualification_level_trailers`: the trailer types allowed by a level in `selected` trailer mode, with a foreign key to the game's catalog row.
- `qualification_assignments`: half-open UTC periods `[assigned_at, ended_at)` per member and game. `kind` is `admission`, `promotion`, `manual`, `level_removed` or `reinstatement`. The generated `open_marker` and the unique `(user_id, game, open_marker)` index keep at most one open period per member and game. The unique `previous_assignment_id` keeps the history a chain.

The limits are cargo mass (min/max kg), actual distance (min/max m), trailer types (`any` or `selected`), ADR (`forbidden`, `selected` or `any`), Hard Mode and maximum cargo damage. Empty bounds mean no limit. The inclusive `cargoDamageMaxPercent` accepts a canonical decimal string from 0 to 100, with up to 18 decimal places. Null clears the cap. Omitting it disables damage on creation and preserves the saved value on edit. A `selected` mode needs at least one item. The conditions are a trip count and an actual distance; every set condition must be met. A non-top level must have at least one condition (`422 QUALIFICATION_CONDITIONS_REQUIRED`); a level without conditions never promotes. A create or move that would push the top level down without conditions fails the same way, and the error detail names that level in `ownResourceId`.

`QUALIFICATIONS_ENABLED=true` requires Identity and Trips and has no other settings. The retired cursor key, ladder-edit and eligibility-tracking settings are ignored.

## Trip check

`checkTrip` in `apps/api/src/modules/qualifications/check.ts` is pure. It returns the five base rules and adds `cargo_damage` when a cap applies, each `pass`, `fail` or `unknown`, with the configured value and the trip value. A failure outranks an unknown rule. An unknown value is never zero:

- an incomplete trailer chain is unknown unless a known trailer is already outside the selected set;
- non-ADR cargo passes every ADR mode;
- a missing Hard Mode result counts as unknown when Hard Mode is required;
- final telemetry fractions become exact percentages. The manual-only check takes the assessed immutable revision's reported percentage. A configured cap with missing or invalid evidence produces an unknown rule.

The [decision coordinator](trip-decisions.md) selects the member's level at the trip's attribution time, which is the actual start for telemetry and the staff confirmation for manual reports. It applies that level's current limits. A failed limit rejects the trip with `qualification_cargo_mass`, `qualification_distance`, `qualification_trailer`, `qualification_adr`, `qualification_hard_mode` or `qualification_cargo_damage`. An unknown rule (`qualification_unknown`), an unknown level (`qualification_level_unknown`) or an unknown attribution time (`qualification_attribution_time_unknown`) sends the trip to staff review. Missing final damage requires review even if another level limit failed. Staff may accept a manual-only report over a proven limit with explicit confirmation.

A trip with current confirmed event attendance is credited without the level limits (`event_exempt`). Prescribed loads no longer matter for the check.

Each decision stores a snapshot of the level name, edit version, limits and rule results. Reads show `basis: decision` for decided trips, so later edits never rewrite history. Pending trips and active staff review of a held result show `basis: current`. Stored decisions and audit values written before the cap retain their original shape.

## Promotion

`replaceContributionsInTransaction` records credits and then re-checks the affected members. Every level create, edit, move and removal re-checks the whole game through `recheckGameInTransaction`. A member whose credited trips and distance on the current level meet every set condition moves to the next level in the same transaction. The move appends a `promotion` period, an audit entry and a `qualification.promoted` outbox event. A revoked or merged trip never demotes.

Lock order is company, then sorted members, then assignments, then contributions. The unique open marker and predecessor indexes are the database backstop, so two concurrent credits produce exactly one promotion.

Leaving the first level in either game, whether by promotion, manual change or removal transfer, replaces a held Trainee role with Driver through the identity-owned same-transaction facade. `assign()` applies it only when the closed assignment was on the first level at that moment. A create, move or removal passes the first level from before the edit to `recheckGameInTransaction`; when that level is no longer first, Trainees with an open assignment on it are completed before promotion runs. Nothing else changes roles, so a Trainee that staff set on a later level stays one through renames, limit edits, unrelated reorders and promotions.

## Commands and reads

| Route | Capability |
| --- | --- |
| `GET /qualification-levels?game=`, `GET /qualification-levels/{id}` | `company.read` |
| `GET /me/qualifications`, `GET /members/{id}/qualifications` | `company.read` |
| `POST /admin/qualification-levels` | `qualifications.manage` |
| `PUT /admin/qualification-levels/{id}` and `/position` | `qualifications.manage` |
| `POST /admin/qualification-levels/{id}/removal` | `qualifications.manage` |
| `PUT /admin/members/{id}/qualifications/{game}` | `qualifications.manage` |

Edits, moves and removals take `expectedVersion` and return `409` on a stale version; create and the manual level change do not. Create, edit, move and removal return `promotedCount`. Removing a level moves its drivers to the chosen level as `level_removed` periods and shifts later positions up. A manual change needs a reason and is audited. A level's change history comes from the audit log and is shown only to managers (`history: null` for others). Each entry carries bounded before/after `values` (name, position, limits and conditions) so the level page shows what changed.

## Web

`apps/web/src/features/qualifications` holds the single page at `/account/qualifications`, the level page and the level editor. The editor previews how many drivers a draft would promote. A create at the top, and an ↑/↓ move that gives the current top a next level, also show how many of the top's drivers move up before saving; the move asks for confirmation. The trip and review pages share `QualificationCheckList`. Driver profiles read `/members/{id}/qualifications`. Hard Mode keeps its English name in both languages and shows the flame icon.

## Migration

`0035` maps the old model in place:

- level positions are kept and archived levels are soft-deleted;
- assignment purposes become kinds;
- open periods without a state row are closed at their own start;
- the rule versions, states, promotion proofs and reviews are dropped;
- outbox, routing and notification rows of the retired types are removed.

Ladder limits and conditions are not carried over, because the old rules have no equivalent. Staff configure them again after the upgrade. `test/integration/qualification-simplification-upgrade.test.ts` checks the mapping and that the upgraded schema equals a fresh one.

`0039` adds a nullable range-checked cap to each level. Existing levels start disabled. See the [migration rollback boundary](../../packages/db/migrations/README.md).

## Companion reads and live checks

The [companion contract](../contracts/telemetry-companion-v1.md) uses a caller-transaction read facade under the authenticated member/company fence. It returns exact current assignment, level edit, five limits, conditions and remaining credited amounts without invoking promotion. Missing assignment/disabled service are explicit states. A supported actual start may select a historical assignment; current mutable limits remain explicitly provisional. The shared checker applies the same limit policy. Companion v1 cannot send or display a damage rule, so a configured cap adds `fact_unavailable` to provisional preview reasons. Confirmed same-game attendance exempts every level limit without prescribed-load matching. RSVP and client references cannot authorize exemption. Lease applicability is supplied by the server; it is not a second client rule evaluator. Selected trailer labels are current_catalog presentation metadata, separate from retained identities/group membership. Qualification edits/assignments/promotions bump the Trips-owned owner revision through its contribution facade in the producer transaction.
