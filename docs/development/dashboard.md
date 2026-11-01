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
- **Privacy footnote**: the driver profile states under its trips that pending and rejected reports, their reasons and screenshots are not shown and that account details never appear on profiles. The profile requests only accepted trips, public qualification progress (`ProgressPublic`, no review flags) and no `/admin/*` or `scope=review` data.

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
- **Driver Profile (`/account/drivers/:memberId`)**: a compact layout (VTC-061, board R11) built only from existing endpoints.
  - Header: decorative initial avatar, nickname as the page heading, role badges, `Active` / `Former member`, `You` on one's own profile, one chip per assigned game with the level name (`ETS2 · Driver II`; `Loading level…` / `Level unavailable`, never the level ID) and the game segmented control (All games, ETS2, ATS). A small `All drivers` link sits above. The breadcrumb is unchanged.
  - KPI strip (`Driver statistics, last 12 months`, `<dl>`): accepted trips, actual distance and this month (last bucket: distance plus trips and month). The window is a fixed rolling twelve calendar months: from the first day of the UTC month eleven months back to the first day of next month (`granularity=month`), within the 732-day API limit. Zero shows as `0` / `0 km`; a failure shows an error with Retry, and 409 shows the reporting-timezone setup message without Retry.
  - Accepted trips: counted time with the viewer's display timezone shown, route link to `/account/trips/:id` with an `English name` marker for fallback labels, cargo, source and actual distance (`Unavailable` for null). On one's own profile the first page of `scope=mine&decision=accepted&limit=10` is exact and `All my trips` appears when more exist. For another member the contract has no owner filter, so the latest 100 accepted company trips (`scope=company`) (of the selected game, when one is chosen) are filtered by owner and capped at ten; a note says so whenever more of the member's trips were in the window than shown or the window did not reach the company's oldest trip; empty texts distinguish own, incomplete-window and complete-window cases. Phones (≤760px) show row cards with visible cell labels and the same table semantics.
  - Qualification card per game (follows the game filter): level name heading, `Next: …` or `Top level`, the level ladder as a static progression (`<ol>`, decorative arrows, current step highlighted with `aria-current="step"`), exact trips and distance against the thresholds with decorative bars, `Promotion thresholds are not configured.` for null thresholds, the eligibility text with a ✓, and `Progress since` in the display timezone. No assignment shows `No qualification assigned` without a progress request; progress and level names load and fail per game.
  - Distance by month: Chart/Table toggle, reporting timezone from the response, peak summary under the chart, and an exact month table in a focusable scroll region named by its caption; the body keeps one height across states.
  - Requests and keys: `driver-profile`, `driver-analytics`, `driver-progress` (`EnvelopeProgressPublic`, only for assigned games after the profile loads) and `driver-accepted-trips`, keyed by member, viewer, session generation, identity epoch, capabilities, language and path; level names reuse the overview's `/qualification-levels?game=<g>&limit=25` read (only assigned games). Switching the game refetches only analytics and trips. A 403 clears inactive private queries and refreshes the session, a 401 confirms session loss.
  - States: without `company.read` the page shows an access notice and mounts no query; profile loading keeps the heading and a hidden status line; 400/404/422 show `Driver not found` with a link back; 403 shows the access notice; other failures show an alert whose Retry keeps focus on the stable page heading.
  - Layout: one column below 1200px; from 1200px trips beside a 300px side column (340px from 1360px), which keeps whole Russian words in the trips table with the sidebar expanded. Trip and month tables override the shared break-anywhere wrapping with whole-word wrapping and automatic column widths. Styles live in `features/drivers/drivers.css`, scoped to `.driver-profile-page`, from shared tokens; touch screens get the 40px targets.
  - Omitted, with no data source in the API or policies (follow-ups): member-since date, Steam/TruckersMP indicators (privacy decision), average trip, convoy count, period select and all-time totals, trip pagination with totals (no owner filter), cargo mass and event marker, and the assigning person.

## Verification and Testing

- **Backend Integration (`test/integration/members.test.ts`)**: Real MySQL 8.4 integration testing for `GET /api/v1/members` and `GET /api/v1/members/:memberId`, cursor pagination, former member flags, and privacy verification.
- **Unit Tests (`test/unit/dashboard.test.ts`)**: Period date calculations and progress-bar geometry from `features/dashboard/model.ts`, RU/EN translation key parity, privacy invariants, quantity and UTC formatting.
- **Driver profile unit tests (`test/unit/drivers.test.ts`)**: rolling window, month labels, ladder and next level, trip request paths and owner filtering, failure mapping, RU/EN key and placeholder parity, and every synthetic profile fixture (`test/e2e/support/drivers-fixtures.ts`) parsed by the browser runtime schemas, including public progress that the private progress schema rejects.
- **E2E Playwright Tests (`test/e2e/dashboard.spec.ts` & `test/e2e/drivers.spec.ts`)**, on desktop (1280×800), tablet (768×1024) and mobile (390×844):
  - Overview KPIs, regions and omitted blocks; game/period filters with matching request parameters and bucket totals.
  - First-screen budget at 1280×800 in EN and RU (header, KPIs, qualification and the first leaderboard row).
  - Chart/Table switching by keyboard and touch with preserved focus, exact table values and a stable card height; interval changes while a response is pending.
  - Loading, analytics error with Retry, partial leaderboard/progress failures, empty company, missing and revoked `company.read`.
  - Target sizes (compact on fine pointers, 40px on touch), block and keyboard order, leaderboard count caps.
  - Driver directory search (`mockDashboardRoutes`).
  - Driver profile with `mockDriverRoutes` (`test/e2e/support/drivers-ui.ts`, fixed clock, unexpected requests logged): full content without IDs or omitted metrics, exact request set, keyboard game filter refetching only analytics and trips, own and former-member profiles, loading/not found/error with Retry/403/missing `company.read`, partial analytics/progress/level/trip failures, unconfigured thresholds and the top level, phone cards and target sizes, two columns at 1280 and 1200 (stacked at 1199) with whole-word Russian wrapping, headings/regions/table semantics and Tab order, and RU/EN switching that keeps the selected game.
