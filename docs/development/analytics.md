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

All analytics endpoints require the `company.read` permission (satisfied by active members with roles `driver`, `dispatcher`, `deputy_director`, or `director`).

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

## Database schema and index optimization

- Migration `0015_military_clint_barton.sql` adds:
  - `identity_company.reporting_timezone`: `varchar(128)` nullable launch configuration.
  - Index `trip_analytics_reporting` on `trips(decision, reporting_at, game, owner_id)` enabling efficient range filtering for accepted trips within reporting periods.

## Configuration

- `ANALYTICS_ENABLED`: boolean flag (disabled by default).
- `ANALYTICS_CURSOR_KEY`: 64-hex character HMAC key for signing pagination cursors.
- `ANALYTICS_REPORTING_TIMEZONE`: optional fallback IANA timezone name.
