# Company Dashboard and Driver Profiles

VTC-033 delivers the company overview dashboard, driver directory, and individual driver profiles in VTCDashboard.

## Architecture and Endpoints

### Identity Module Endpoints (VTC-033 Owned)

- `GET /api/v1/members`:
  - Returns paginated list of company members (`EnvelopeListMemberSummary`).
  - Supports `limit` (default 50, bounded 1..100) and signed cursor pagination (`nextCursor`).
  - Each item contains `id`, `nickname`, `roles`, and `formerMember` boolean flag.
  - Requires `company.read` capability.
- `GET /api/v1/members/:memberId`:
  - Returns driver profile envelope (`EnvelopeMemberProfile`).
  - Contains `member` summary and active qualification `qualifications` assignments per game.
  - Requires `company.read` capability.

### Consumed APIs

- `GET /api/v1/analytics/company`: Company aggregate distance and accepted trips with day/month buckets.
- `GET /api/v1/analytics/leaderboard`: Top drivers ranked by accepted distance and trips.
- `GET /api/v1/members/:memberId/analytics`: Individual driver monthly distance and trips.
- `GET /api/v1/me/upcoming-event`: Next upcoming convoy or company event.
- `GET /api/v1/me/qualification-progress` and `/members/:memberId/qualification-progress`: Current qualification levels and progress.
- `GET /api/v1/trips`: Confirmed trip history (accepted trips only on driver profiles).

## Privacy Safeguards

- **Strict isolation of private account data**: Member summaries, profiles, and directory listings never expose emails, passwords, password hashes, credentials, or session tokens.
- **Privacy tests**: Integration and end-to-end tests assert that no `@example.invalid` address, password hash, or credential token is present in serialized responses or client storage/DOM.
- **Privacy disclaimer**: Profile surfaces visibly state the privacy policy protecting private driver account details.

## UI Components and Features

- **Company Overview (`/account/dashboard`)**: a compact layout (VTC-048) that keeps the key numbers, qualification progress and the leaderboard on the first 1280×800 screen.
  - Header: title, subtitle and filters on one row. The game filter is a segmented control (All games, ETS2, ATS) and the period is a labelled native select (This month, Last month, Last 30 days, Last 7 days). Filters are local page state.
  - KPI strip (`Key metrics` region, `<dl>`): actual distance, accepted trips and active drivers. Active drivers is the number of leaderboard entries for the filters; the leaderboard is requested with `limit=100` (contract maximum) and shows `100+` when a next cursor exists. A failed leaderboard shows `Unavailable`, never `0`.
  - Distance card: Interval (Daily/Monthly) and View (Chart/Table) segmented controls; the reporting timezone and computation time stay visible. Chart view pairs the decorative bar chart with a visible peak summary. Table view shows the exact per-bucket table (caption with the reporting timezone, sticky header, peak badge) in a focusable scroll region named by its caption. The card body keeps one height across views and states.
  - My Qualification: per game (ETS2, ATS) the level badge, an eligibility badge and exact `trips` / `distance` values against the requirement with a decorative bar. Each game shows its own loading or `Progress unavailable` state; `No qualification assigned` appears only when the response has no assignment or the member cannot submit own trips.
  - Driver Leaderboard: top ten rows with rank badges for the top three, driver profile links, trips and distance, plus an `All drivers` link. Loading, failure (with Retry) and empty states are separate.
  - Side column: Review Queue for `trips.review` (count from the five-item queue request, `5+` when more exist) and Upcoming Event (title, start time with the viewer's display timezone, details link), each with its own error text.
  - Collapsible "How Metrics Are Calculated" card (`aria-expanded` / `aria-controls`).
  - States: a visually hidden status announces loading while analytics or the leaderboard is pending, static placeholders per block show it without shifting the layout, and the header controls stay usable. Every block renders its latest data when present and shows its own error only when it has none, so a failed background refresh keeps current values. An analytics failure without data replaces the KPIs and grid with an alert and Retry; Retry moves focus to the page title (or, for the leaderboard, its heading) because the button unmounts; members without `company.read` see an access notice and no dashboard query runs; an empty company shows a notice above the KPIs only when both analytics and the leaderboard answered with zero.
  - Layout: from 1051px a two-column grid (distance | qualification, then leaderboard | side column); below that one column in DOM order. Visual order matches DOM and keyboard order. Styles live in `features/dashboard/dashboard.css`, scoped to `.dashboard-page` and built from shared tokens; touch screens get the shared 40px targets.
  - Omitted in VTC-048 by card scope (follow-up VTC-055): recent company trips, convoy RSVP/participants and countdown, which would need extra requests or mutations on the overview. No data source: KPI deltas, member totals, review-age KPIs, next qualification level.
- **Driver Directory (`/account/drivers`)**:
  - Filter by driver nickname.
  - Role badges: Director, Deputy Director, Dispatcher, Driver, Trainee.
  - Active vs Former Member indicators.
  - Links to individual driver profiles.
- **Driver Profile (`/account/drivers/:memberId`)**:
  - Driver header with nickname, roles, and status badge.
  - Personal statistics: Total distance, accepted trips.
  - Monthly distance chart.
  - Qualifications per game with promotion eligibility.
  - Confirmed trips history table (strictly accepted trips only).

## Verification and Testing

- **Backend Integration (`test/integration/members.test.ts`)**: Real MySQL 8.4 integration testing for `GET /api/v1/members` and `GET /api/v1/members/:memberId`, cursor pagination, former member flags, and privacy verification.
- **Unit Tests (`test/unit/dashboard.test.ts`)**: Period date calculations and progress-bar geometry from `features/dashboard/model.ts`, RU/EN translation key parity, privacy invariants, quantity and UTC formatting.
- **E2E Playwright Tests (`test/e2e/dashboard.spec.ts` & `test/e2e/drivers.spec.ts`)**, on desktop (1280×800), tablet (768×1024) and mobile (390×844):
  - Overview KPIs, regions and omitted blocks; game/period filters with matching request parameters and bucket totals.
  - First-screen budget at 1280×800 in EN and RU (header, KPIs, qualification and the first leaderboard row).
  - Chart/Table switching by keyboard and touch with preserved focus, exact table values and a stable card height; interval changes while a response is pending.
  - Loading, analytics error with Retry, partial leaderboard/progress failures, empty company, missing and revoked `company.read`.
  - Target sizes (compact on fine pointers, 40px on touch), block and keyboard order, leaderboard count caps.
  - Driver search and profile navigation; no horizontal overflow; RU and EN rendering.
