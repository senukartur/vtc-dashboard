# Company and driver analytics APIs

VTC-032 implements the read-only analytics APIs for company-level and member-level summaries, time-series distributions, and driver leaderboards based strictly on accepted canonical trips. Approved product direction remains in [CONCEPT.MD](../CONCEPT.MD); the browser API contract is documented in [OpenAPI specification](../contracts/dashboard/openapi.json).

## Core aggregation principles

1. **Canonical accepted trips only**:
   - Only trips with `decision = 'accepted'` and `aliasOf IS NULL` contribute to completed trip counts and actual distance metrics.
   - Trips marked `decision = 'rejected'` or linked as superseded aliases (`aliasOf IS NOT NULL`) are strictly excluded.
   - Trips with `decision = 'pending_review'` are excluded from accepted totals, but cause the summary flag `projectionPending: true` to indicate unfinalized driving activity in the requested period.

2. **Distance precision**:
   - Company totals, buckets and `byGame` use `SUM(TRUNCATE(actual_distance_m, 1))` per bucket and game in exact MySQL decimals, folded with exact tenth-metre `BigInt` arithmetic (`addDistances`). This equals the per-trip tenth truncation, so `byGame` and the buckets sum exactly to the totals. Leaderboard distances are exact SQL sums.
   - Planned route length is never mixed or substituted for actual driven distance.
   - Summaries and leaderboard rankings use string representations preserving exact values without IEEE 754 floating-point drift.

3. **Attribution and timezone semantics**:
   - The reporting timezone is resolved from `identity_company.reporting_timezone` configured by company leadership, falling back to optional environment configuration `ANALYTICS_REPORTING_TIMEZONE`.
   - If no timezone is configured or valid, queries fail closed with HTTP 409 `SETUP_REQUIRED`.
   - `fromDate` and `toDateExclusive` represent calendar dates (`YYYY-MM-DD`) in the company reporting timezone.
   - Canonical `trips.reportingAt` timestamps (telemetry completion time or manual report confirmation time) are converted to the reporting timezone for date attribution and bucket assignment (`day` or `month`).
   - Trips crossing midnight in UTC are attributed to their local calendar date in the reporting timezone.

4. **Dynamic corrections without permanent snapshots**:
   - Aggregates are computed dynamically from primary trip records.
   - Approved revisions or manual report corrections immediately reflect in subsequent queries across affected historical periods without maintaining redundant snapshot tables.

## Endpoints and authorization

The anonymous [public company statistics](#public-company-statistics-vtc-052) route is the only exception. All other analytics endpoints require the `company.read` permission (satisfied by active members with roles `driver`, `dispatcher`, `deputy_director`, or `director`).

- `GET /api/v1/analytics/company`:
  - Query parameters: optional `period` (`range` default | `all_time`), `fromDate` and `toDateExclusive` (required for `range`, forbidden for `all_time`), optional `game` (`ets2` | `ats`), optional `granularity` (`day` | `month`).
  - Returns envelope with `data` containing `acceptedTrips`, `actualDistanceM`, `projectionPending`, `reportingTimezone`, contiguous `buckets`, the covered `fromDate`/`toDateExclusive`, `period`, `activeDrivers`, `activeMembers` and `byGame` (see [periods and active counts](#periods-and-active-counts-vtc-143)).

- `GET /api/v1/analytics/company/breakdown`:
  - Query parameters: required `dimension` (`route` | `cargo` | `source`), the same `period`, `fromDate`, `toDateExclusive` and `game` rules as company analytics, optional `locale` (`en` | `ru`) and, for `route` and `cargo` only, `limit` (1-10, default 5). `granularity` and unknown parameters return 422.
  - Returns top routes, top cargo or the source split with `totals`, `undetermined`, `remainder` and the covered period (see [breakdown](#breakdown-vtc-112)).

- `GET /api/v1/members/:memberId/analytics`:
  - Query parameters: `fromDate`, `toDateExclusive`, optional `game` (`ets2` | `ats`), optional `granularity` (`day` | `month`).
  - Returns member analytics envelope matching `Analytics` schema for the specified member.

- `GET /api/v1/analytics/leaderboard`:
  - Query parameters: the same `period`, `fromDate`, `toDateExclusive` and `game` rules as company analytics, optional pagination `limit` (1-100, default 50) and signed `cursor`. `granularity` is accepted and ignored for both periods.
  - Returns ranked member items (`member`, `acceptedTrips`, `actualDistanceM`, `position`) ordered by distance descending (members whose trips carry no distance rank with zero), accepted trips descending, then member ID ascending, plus `rankedMembers`, `viewer` and the covered `period`/`fromDate`/`toDateExclusive`.
  - Keyset pagination uses HMAC-SHA256 cursors bound to the requester's identity session, access epoch, and filter scope to prevent cross-user replay and tampering.

## Periods and active counts (VTC-143)

- **Validation** (422 before the analytics transaction starts): `period=all_time` with `fromDate` or `toDateExclusive`; company `period=all_time` with `granularity=day`; `range` (explicit or default) without both dates; an unknown `period`; and the existing range rules (calendar dates, `fromDate < toDateExclusive`, at most 732 days). The member route keeps required dates and rejects `period`.
- **Covered range**: `range` covers the requested dates. `all_time` uses month granularity and covers, in the reporting timezone, the first day of the month of the earliest accepted unique trip matching `game` (an ordered `LIMIT 1` read, not `MIN()`) up to the first day after the current month, without the 732-day limit. Without such a trip, or with only future trips, it starts at the current month, so an empty company returns one zero bucket. The request clock is read once and gives both the current month and `computedAt`.
- **Buckets**: bucket starts are computed in JavaScript as the local midnight of each bucket date (DST-aware through `Intl`, no MySQL time zone tables). One grouped statement maps `reporting_at` to its bucket with `INTERVAL()` over those epoch-millisecond starts and groups by bucket and game; no trip rows are loaded.
- **projectionPending**: for `range` it considers unfinalized trips (pending review, assessment or correction) inside the requested dates. For `all_time` it considers every unfinalized trip matching `game` with `reporting_at` before the end of the covered range, also those older than the earliest accepted trip, because accepting one would change the totals and `fromDate`.
- **activeDrivers**: distinct trip owners with at least one accepted unique trip in the covered range and `game`, from the same predicate as the totals. It includes former members with such trips, so it equals the leaderboard `rankedMembers` for the same period and game and can exceed `activeMembers`.
- **activeMembers**: memberships with status `active`, any role, read in the same transaction; the `game` filter does not apply.
- **byGame**: `ets2` then `ats`, including zeros, or only the filtered game.
- **Leaderboard**: `position` is the 1-based ordinal under the order above. `rankedMembers` counts every ranked member of the period. `viewer` is the requester's own `{ position, acceptedTrips, actualDistanceM }`, also when it is not on the page, or `null` when the requester has no accepted trip in the period. Member summaries are read only for the returned page.
- **Cursor**: it binds `game`, `period`, the covered `fromDate`/`toDateExclusive` and the timezone. An `all_time` cursor fails with 409 `VERSION_CONFLICT` once the month rolls over or the earliest accepted trip changes the start month, and a cursor never crosses periods. The next page starts at the first row strictly after the cursor's (distance, trips, member ID), so a member whose totals changed or who left the ranking between pages does not restart the list.
- **Cost**: per request one ordered earliest-trip read (`all_time` only), one grouped aggregate, one distinct-owner count, the pending probe and the active member count. The earliest read, the aggregate and the count can use `trip_analytics_reporting` (`decision, reporting_at, game, owner_id`); `all_time` reads every accepted trip up to the current month, and the leaderboard groups the same rows by owner. The pending probe is an `OR` of three flags without a matching index; it stops at the first match (`LIMIT 1`) but for `all_time` can scan all trip history when nothing is pending. No index or migration was added. `test/integration/analytics.test.ts` checks the plans and logs them as `stage4_explain`.

## Breakdown (VTC-112)

`getCompanyAnalyticsBreakdown` reads the same accepted unique canonical trips, covered range, `projectionPending` probe and `projectionVersion` as company analytics, in one read-only transaction.

- **Validation** (422 before the transaction): the period rules above, a missing or unknown `dimension`, `limit` outside 1-10, `limit` with `source`, `granularity`, an unknown `locale` or any other parameter.
- **Effective fact**: each trip is grouped by its current fact (`trips.current_fact_id`), which can be a derived fact after a staff correction or the other source's fact after reconciliation. `route` groups by game, origin city ID and destination city ID, so A to B and B to A are separate routes; `cargo` groups by game and cargo ID; `source` groups by the provider of the fact's source message (a derived fact uses its `derived_source_message_id`), so a corrected or reconciled trip counts once under that provider.
- **Module boundary**: the breakdown reads `trip_facts` and `source_messages` directly in its read-only aggregate. This is an approved exception (coordinator VTC-150 plan, Design 6) that extends the VTC-032 direct `trips` read, and it applies the Trips provenance rule `COALESCE(message_id, derived_source_message_id)`. If Trips changes how the effective fact is selected, this read must change with it.
- **Undetermined and remainder**: a trip with an unresolved city or cargo, or without a current fact, counts in `undetermined` and never in `items`. Resolved groups beyond `limit` count in `remainder`. `source` always lists `ets2telemetry` then `manual`, including zeros, has no `limit` and a zero `remainder`; a trip without a source message is `undetermined`.
- **Ranking**: accepted trips descending, then distance descending, then origin and destination city IDs (or the cargo ID), then game.
- **Exact invariant**: distances use the per-trip tenth truncation of the totals (`SUM(TRUNCATE(actual_distance_m, 1))`) and exact `BigInt` tenths. `totals` is the sum of the resolved and undetermined groups; `remainder` is the resolved sum minus the shown items, read in the same snapshot. Items plus `remainder` plus `undetermined` equal `totals`, which equal `acceptedTrips` and `actualDistanceM` of company analytics for the same filters. A negative difference fails with a server error instead of returning wrong numbers.
- **Labels**: one `labelsInTransaction` batch through the catalogs facade in `locale`, or the viewer's saved locale. Hidden catalog rows stay labelled with `hidden: true`, a missing Russian name falls back to English with `englishFallback: true`, and cities may carry `nameNative`. Without the catalogs module `route` and `cargo` return 503; `source` needs no labels.
- **Cost**: besides the shared period and pending reads, `route` and `cargo` run a two-row resolved/undetermined split and one ranked `LIMIT` statement; `source` runs one grouped statement of at most three rows. Each reads every accepted trip of the range through the same predicate as the totals, which can use `trip_analytics_reporting`, and joins `trip_facts` and `source_messages` by primary key once per trip; `all_time` reads every accepted trip up to the current month. On the tiny synthetic test tables (about 18 trips) EXPLAIN lists `trip_analytics_reporting` only as a possible key and the optimizer chooses `trip_group_members`; plans at real volume are not proven locally. No index or migration was added. `test/integration/analytics.test.ts` ("VTC-112 breakdown statements can use trip_analytics_reporting and primary-key joins") checks the possible keys for a year and `all_time` and logs the plans as `stage4_explain`. Like `getCompanyAnalytics`, the request holds the company row lock that `authorizeInTransaction` takes (`FOR UPDATE`) for the whole read transaction, so parallel analytics requests for the company serialize. Errors come in this order: 401 or 403, then 422, then 409 `SETUP_REQUIRED`, then 503 for `route` or `cargo` without the catalogs module.

## Public company statistics (VTC-052)

`GET /api/v1/public/company-stats` (`getPublicCompanyStats`) supplies the closed aggregate for the public landing stats band (VTC-050). It is registered with the other analytics routes, so it returns the ordinary JSON 404 when `ANALYTICS_ENABLED` is off.

- **Access**: anonymous. The route charges the persistent public `read` rate limit (as public events) and never authenticates, reads or sets cookies; a session cookie does not change the result. Exceeding the limit returns 429 with `Retry-After: 60`. Unknown query parameters return 422.
- **Caching**: a successful 200 carries `Cache-Control: public, max-age=60` through the shared allowlist in `apps/api/src/platform/http/cache.ts`; every error stays `no-store`. There is no ETag or in-process cache, so values can be up to 60 seconds stale and cached copies repeat `meta.requestId`.
- **Fields**: `computedAt`, `activeMembers` (memberships with status `active`, any or no role) and `currentMonth`.
- **Current month**: the calendar month containing the request time in the company reporting timezone (stored value, then `ANALYTICS_REPORTING_TIMEZONE`), with `month`, half-open `fromDate`/`toDateExclusive` and `reportingTimezone`. `acceptedTrips` and `actualDistanceM` use the same accepted canonical predicate and `reportingAt` window as the company analytics total: rejected, pending review, unassessed, superseded aliases and undated trips are excluded; an accepted trip with a pending correction counts with its confirmed facts. Distance is `SUM(TRUNCATE(actual_distance_m, 1))` in exact MySQL decimals, the per-trip tenth-metre truncation of `addDistances`, so it equals `GET /api/v1/analytics/company` for the same month. Null distances count as trips only. `games` lists games with at least one such trip (`ets2` before `ats`), so early in a month it can be short or empty.
- **Unavailable versus zero**: with a valid timezone and no trips the month is `available` with `0`, `"0"` and `[]`. Without a valid timezone it is `{ "status": "unavailable", "reason": "company_reporting_timezone" }` while `activeMembers` is still returned. A missing company row returns 409 `SETUP_REQUIRED`; database unavailability returns 503.
- **Privacy**: the DTO is a closed allowlist with no IDs, names, per-driver or per-game totals, pending/review counters or projection fields. There is no small-number threshold, so a month with a single accepted trip reveals that trip's distance, without any identity.
- **Consumers**: the landing stats band and the overview period anchors (VTC-056), which read only `currentMonth.reportingTimezone`.
- **Cost**: one transaction with three non-locking consistent reads (company timezone, active member count, one aggregate statement). It never locks the company or member rows, so concurrent identity commands do not block it. The aggregate range-scans `trip_analytics_reporting`; `test/integration/public-company-stats.test.ts` checks the plan.

## Database schema and index optimization

- Migration `0015_military_clint_barton.sql` adds:
  - `identity_company.reporting_timezone`: `varchar(128)` nullable launch configuration.
  - Index `trip_analytics_reporting` on `trips(decision, reporting_at, game, owner_id)` enabling efficient range filtering for accepted trips within reporting periods.

## Configuration

- `ANALYTICS_ENABLED`: boolean flag (disabled by default).
- `ANALYTICS_CURSOR_KEY`: 64-hex character HMAC key for signing pagination cursors.
- `ANALYTICS_REPORTING_TIMEZONE`: optional fallback IANA timezone name.
