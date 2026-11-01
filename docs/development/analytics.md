# Company and driver analytics APIs

VTC-032 implements the read-only analytics APIs for company-level and member-level summaries, time-series distributions, and driver leaderboards based strictly on accepted canonical trips. Approved product direction remains in [CONCEPT.MD](../CONCEPT.MD); the browser API contract is documented in [OpenAPI specification](../contracts/dashboard/openapi.json).

## Core aggregation principles

1. **Canonical accepted trips only**:
   - Only trips with `decision = 'accepted'` and `aliasOf IS NULL` contribute to completed trip counts and actual distance metrics.
   - Trips marked `decision = 'rejected'` or linked as superseded aliases (`aliasOf IS NOT NULL`) are strictly excluded.
   - Trips with `decision = 'pending_review'` are excluded from accepted totals, but cause the summary flag `projectionPending: true` to indicate unfinalized driving activity in the requested period.

2. **Distance precision**:
   - Driven distance is aggregated from `trips.actualDistanceM` using exact tenth-meter scaled arithmetic (`BigInt`).
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
  - Query parameters: `fromDate`, `toDateExclusive`, optional `game` (`ets2` | `ats`), optional `granularity` (`day` | `month`).
  - Returns envelope with `data` containing `acceptedTrips`, `actualDistanceM`, `projectionPending`, `reportingTimezone`, and contiguous `buckets`.

- `GET /api/v1/members/:memberId/analytics`:
  - Query parameters: `fromDate`, `toDateExclusive`, optional `game` (`ets2` | `ats`), optional `granularity` (`day` | `month`).
  - Returns member analytics envelope matching `Analytics` schema for the specified member.

- `GET /api/v1/analytics/leaderboard`:
  - Query parameters: `fromDate`, `toDateExclusive`, optional `game`, optional pagination `limit` (1-100, default 50) and signed `cursor`.
  - Returns ranked member items (`member: { id }`, `acceptedTrips`, `actualDistanceM`) ordered by distance descending, with deterministic tie-breaking by member ID ascending.
  - Keyset pagination uses HMAC-SHA256 cursors bound to the requester's identity session, access epoch, and filter scope to prevent cross-user replay and tampering.

## Public company statistics (VTC-052)

`GET /api/v1/public/company-stats` (`getPublicCompanyStats`) supplies the closed aggregate for the public landing stats band (VTC-050). It is registered with the other analytics routes, so it returns the ordinary JSON 404 when `ANALYTICS_ENABLED` is off.

- **Access**: anonymous. The route charges the persistent public `read` rate limit (as public events) and never authenticates, reads or sets cookies; a session cookie does not change the result. Exceeding the limit returns 429 with `Retry-After: 60`. Unknown query parameters return 422.
- **Caching**: a successful 200 carries `Cache-Control: public, max-age=60` through the shared allowlist in `apps/api/src/platform/http/cache.ts`; every error stays `no-store`. There is no ETag or in-process cache, so values can be up to 60 seconds stale and cached copies repeat `meta.requestId`.
- **Fields**: `computedAt`, `activeMembers` (memberships with status `active`, any or no role) and `currentMonth`.
- **Current month**: the calendar month containing the request time in the company reporting timezone (stored value, then `ANALYTICS_REPORTING_TIMEZONE`), with `month`, half-open `fromDate`/`toDateExclusive` and `reportingTimezone`. `acceptedTrips` and `actualDistanceM` use the same accepted canonical predicate and `reportingAt` window as the company analytics total: rejected, pending review, unassessed, superseded aliases and undated trips are excluded; an accepted trip with a pending correction counts with its confirmed facts. Distance is `SUM(TRUNCATE(actual_distance_m, 1))` in exact MySQL decimals, the per-trip tenth-metre truncation of `addDistances`, so it equals `GET /api/v1/analytics/company` for the same month. Null distances count as trips only. `games` lists games with at least one such trip (`ets2` before `ats`), so early in a month it can be short or empty.
- **Unavailable versus zero**: with a valid timezone and no trips the month is `available` with `0`, `"0"` and `[]`. Without a valid timezone it is `{ "status": "unavailable", "reason": "company_reporting_timezone" }` while `activeMembers` is still returned. A missing company row returns 409 `SETUP_REQUIRED`; database unavailability returns 503.
- **Privacy**: the DTO is a closed allowlist with no IDs, names, per-driver or per-game totals, pending/review counters or projection fields. There is no small-number threshold, so a month with a single accepted trip reveals that trip's distance, without any identity.
- **Cost**: one transaction with three non-locking consistent reads (company timezone, active member count, one aggregate statement). It never locks the company or member rows, so concurrent identity commands do not block it. The aggregate range-scans `trip_analytics_reporting`; `test/integration/public-company-stats.test.ts` checks the plan.

## Database schema and index optimization

- Migration `0015_military_clint_barton.sql` adds:
  - `identity_company.reporting_timezone`: `varchar(128)` nullable launch configuration.
  - Index `trip_analytics_reporting` on `trips(decision, reporting_at, game, owner_id)` enabling efficient range filtering for accepted trips within reporting periods.

## Configuration

- `ANALYTICS_ENABLED`: boolean flag (disabled by default).
- `ANALYTICS_CURSOR_KEY`: 64-hex character HMAC key for signing pagination cursors.
- `ANALYTICS_REPORTING_TIMEZONE`: optional fallback IANA timezone name.
