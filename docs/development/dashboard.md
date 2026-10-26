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
- `GET /api/v1/me/trip-status-summary`: Driver's own trip review and acceptance counters.
- `GET /api/v1/me/upcoming-event`: Next upcoming convoy or company event.
- `GET /api/v1/me/qualification-progress` and `/members/:memberId/qualification-progress`: Current qualification levels and progress.
- `GET /api/v1/trips`: Confirmed trip history (accepted trips only on driver profiles).

## Privacy Safeguards

- **Strict isolation of private account data**: Member summaries, profiles, and directory listings never expose emails, passwords, password hashes, credentials, or session tokens.
- **Privacy tests**: Integration and end-to-end tests assert that no `@example.invalid` address, password hash, or credential token is present in serialized responses or client storage/DOM.
- **Privacy disclaimer**: Profile surfaces visibly state the privacy policy protecting private driver account details.

## UI Components and Features

- **Company Dashboard (`/account/dashboard`)**:
  - Overview KPI cards: Total distance (km), accepted trips count, active drivers count.
  - Game filter (All, ETS2, ATS) and reporting period selector (This month, Last month, Last 30 days, Last 7 days).
  - Distance dynamics chart (`ActualDistanceChart`):
    - Granularity toggle (Daily / Monthly).
    - Peak value bar highlighted.
    - Accessible table caption and data alternative for screen readers.
  - Driver Leaderboard widget with rank badges, nicknames, trip counts, and distance in km.
  - "My Qualification" widget displaying ETS2 & ATS levels and progress.
  - Reviewer Queue widget for staff with `trips.review` capability.
  - Upcoming Convoy Event widget with date, title, and link.
  - Collapsible "How Metrics Are Calculated" card explaining company timezone, telemetry start time, trip confirmation rules, and event loads.
  - Zero-state card for new companies starting from zero.
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
- **Unit Tests (`test/unit/dashboard.test.ts`)**: Period date calculations, leap year / year rollover boundaries, privacy invariants, quantity and UTC formatting.
- **E2E Playwright Tests (`test/e2e/dashboard.spec.ts` & `test/e2e/drivers.spec.ts`)**:
  - KPI overview and chart interactions.
  - Game/period filters.
  - Driver search and profile navigation.
  - Responsive viewports: Desktop (1280px), Tablet (768px), Mobile (390px) without horizontal scrollbar overflow.
  - Bilingual validation: Full RU and EN coverage without missing keys.
