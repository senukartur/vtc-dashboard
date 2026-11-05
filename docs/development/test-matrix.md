# Test coverage matrix

[VTC-071](https://trello.com/c/1VhORI8U) inventories existing evidence and the approved browser selection policy. Counts describe test cases, not implemented requirements or passing executions. Browser mocks establish UI behavior; contracts establish wire shapes; real MySQL tests establish persistence and server enforcement. These layers intentionally overlap.

## Counting and measurement

The inventory expands parameterized declarations using `pnpm exec vitest list --json` for each `VTC_TEST_LANE=unit|contracts|integration` and `pnpm exec playwright test --list --reporter=json`. Source is this change's tests and configuration; the policy regression also enumerates every project without filters using [browser-enumeration.config.ts](../../test/support/browser-enumeration.config.ts). Group by file, declaration line and expanded title for browser cases; count project entries separately. Titles stay local to enumeration and are never timing diagnostics.

There are **680 unit cases in 76 files**, **36 contract cases in 10 files**, **463 integration cases in 24 files**, and **497 browser cases in 34 files**. Native Windows Vitest enumeration lists 674 runnable unit cases: five expanded POSIX launcher cases and one Linux no-follow blob-filesystem case are explicitly skipped there and included in the 680 source inventory. Listing does not execute cases. Ordinary assertion probes are excluded.

The browser policy selects **790 project executions**: desktop 484, tablet 141, mobile 165. Categories are **165 layout**, **287 controlled functional** (including 17 mobile smokes), and **45 real** cases. Selection is not a passed/skipped result: runtime guards or failures can still prevent execution. At base `b40b989cfbddd9e6534b1cd0c7773de21e94d483`, enumeration found 499 cases per project, or 1,497 potential executions before runtime skips. The two case merges and central filtering explain the candidate inventory; the potential-execution difference is not a measured speedup.

Durations below are seconds, measured **before this change** in [successful Quality run 42065940479](https://github.com/senukartur/vtc-dashboard/actions/runs/42065940479) at that base. Integration timings are whole-file elapsed durations; E2E timings sum test-result durations across the old project selection. They have different semantics and cannot be added as wall time. Unit/contract per-feature durations are **not measured**; their whole-lane durations (33.534s and 5.089s) are not divided among features. Candidate execution durations and comparable hosted before/after measurements belong in the delivery PR after exact-head CI.

Each file is allocated to one row below for additive counting. A zero means no dedicated suite in that layer, not an assertion that the feature is untested elsewhere. Shared journeys are allocated by their primary subject: `trips.spec` to manual reports; real trips and corrections to canonical decisions; dashboard backend reads to analytics; membership administration to members. The source map below makes these boundaries explicit.

## Feature × layer

U = unit cases; C = contract cases; I = integration cases / baseline seconds; B = unique browser cases / selected project executions / baseline seconds. U and C durations are not measured.

| Feature | U | C | I / seconds | B / executions / seconds |
| --- | ---: | ---: | ---: | ---: |
| Public pages | 23 | 0 | 0 / 0.000 | 17 / 30 / 53.315 |
| Account and identity | 32 | 0 | 64 / 54.442 | 38 / 55 / 187.579 |
| Admissions | 15 | 0 | 40 / 21.995 | 26 / 44 / 59.749 |
| Members and administration | 23 | 4 | 20 / 19.759 | 48 / 64 / 151.024 |
| Catalogs | 42 | 2 | 21 / 10.358 | 30 / 45 / 97.579 |
| Dashboard and analytics | 83 | 4 | 13 / 12.678 | 48 / 71 / 200.871 |
| Drivers | 25 | 0 | 0 / 0.000 | 22 / 26 / 71.846 |
| Events | 18 | 3 | 22 / 24.762 | 44 / 67 / 188.087 |
| Notifications and messaging | 56 | 2 | 63 / 29.982 | 42 / 55 / 120.036 |
| Qualifications | 75 | 2 | 33 / 32.222 | 40 / 69 / 156.080 |
| Trip list | 29 | 2 | 33 / 9.537 | 8 / 16 / 30.493 |
| Manual reports | 25 | 7 | 30 / 31.128 | 23 / 36 / 71.668 |
| Review and canonical decisions | 31 | 6 | 51 / 20.208 | 40 / 73 / 263.578 |
| Telemetry and reconciliation | 9 | 4 | 49 / 36.477 | 0 / 0 / 0.000 |
| UI foundation | 15 | 0 | 0 / 0.000 | 20 / 53 / 77.004 |
| Navigation | 11 | 0 | 0 / 0.000 | 19 / 40 / 38.618 |
| Settings | 13 | 0 | 0 / 0.000 | 25 / 38 / 62.430 |
| Readiness and built smoke | 0 | 0 | 0 / 0.000 | 7 / 8 / 9.175 |
| Harness, jobs and platform | 155 | 0 | 24 / 93.344 | 0 / 0 / 0.000 |
| **Total** | **680** | **36** | **463 / 396.892** | **497 / 790 / 1839.132** |

## Source map

Stems resolve under [unit](../../test/unit/) / [contracts](../../test/contracts/) / [integration](../../test/integration/) as `<stem>.test.ts`, and under [e2e](../../test/e2e/) as `<stem>.spec.ts`. This is an allocation of suites, not a claim that every case exercises every behavior in its row.

| Feature | Unit stems | Contract stems | Integration stems | Browser stems |
| --- | --- | --- | --- | --- |
| Public pages | `landing`, `landing-live`, `public-documents` | — | — | `landing` |
| Account and identity | `account`, `identity`, `succession-limits`, `external-identities` | — | `identity`, `identity-availability`, `identity-email`, `identity-reset`, `external-identities` | `account`, `account-real`, `identity`, `external-identities` |
| Admissions | `admissions`, `applications-ui` | — | `admissions`, `identity-admission` | `admissions`, `applications-layout` |
| Members and administration | `administration`, `members-ui` | `administration` | `administration`, `members` | `administration-real`, `members-layout` |
| Catalogs | `catalog-import-fixture`, `catalog-source`, `catalog-ui`, `catalogs-http`, `catalogs` | `catalogs` | `catalogs` | `catalogs`, `catalogs-real` |
| Dashboard and analytics | `analytics`, `dashboard`, `dashboard-blocks` | `company-stats` | `analytics`, `public-company-stats` | `dashboard`, `dashboard-blocks` |
| Drivers | `drivers` | — | — | `drivers` |
| Events | `event-workspace`, `events-ui`, `events` | `events` | `events` | `events`, `events-layout`, `events-real` |
| Notifications and messaging | `notifications-acceptance-diagnostics`, `notifications-acceptance-handshake`, `notifications-acceptance-sources`, `notifications-ui`, `notifications`, `messaging` | `notifications` | `notifications`, `messaging` | `notifications`, `notifications-real` |
| Qualifications | `qualification-changes`, `qualification-read-fence`, `qualification-rules`, `qualification-ui`, `qualification-workspace`, `qualifications` | `qualifications` | `qualifications` | `qualifications`, `qualifications-editor`, `qualifications-layout`, `qualifications-real` |
| Trip list | `trips`, `trip-ui`, `trip-availability`, `read-scheduler` | `trips-list` | `trips` | `trips-list` |
| Manual reports | `manual-blobs`, `manual-decoder-lifecycle`, `manual-native-notices`, `manual-report-ui`, `manual-roots` | `manual-reports` | `manual-reports` | `manual-report-layout`, `trips` |
| Review and canonical decisions | `review-ui`, `trip-decisions` | `trip-decisions` | `trip-decisions` | `review-layout`, `trips-corrections`, `trips-real` |
| Telemetry and reconciliation | `telemetry`, `reconciliation` | `telemetry` | `telemetry`, `reconciliation` | — |
| UI foundation | `foundation`, `ui-variants`, `font-subsets` | — | — | `foundation` |
| Navigation | `navigation` | — | — | `navigation` |
| Settings | `settings-ui` | — | — | `settings-layout` |
| Readiness and built smoke | — | — | — | `readiness-states`, `smoke` |
| Harness, jobs and platform | `browser-artifacts`, `browser-diagnostics`, `browser-policy`, `ci-result`, `ci-scope`, `claude-review-schema`, `database-operation-context`, `demo-dataset`, `development-deployment`, `fixture-settlement`, `harness`, `identity-diagnostics`, `jobs`, `jobs-acceptance-diagnostics`, `launcher`, `migration-diagnostics`, `schema-lifecycle`, `support`, `test-process`, `test-selection`, `trip-ci-diagnostics`, `trip-fixture-diagnostics`, `trip-read-diagnostics` | — | `concurrency`, `demo-seed`, `jobs` | — |

## Central browser viewport policy

The owner approved desktop/tablet/mobile for layout, desktop for controlled functional and real journeys, plus one deliberate mobile functional smoke per area. [browser-policy.ts](../../test/support/browser-policy.ts) defines project filters; each declaration calls `browserCase([...])` with exactly one category. The original guarded Playwright function remains unwrapped so source file/line provenance still reaches the safe reporter. [The policy regression](../../test/unit/browser-policy.test.ts) independently checks every expanded case, including cases hidden by filters, the selected project truth table, valid declaration locations, and one expanded smoke per area. RU/EN loops and parameterized cases count separately when Playwright expands them; a smoke tag on a multi-case loop fails uniqueness.

| Category / scope | Cases | Projects |
| --- | ---: | --- |
| Layout, no viewport scope | 135 | Desktop 1280×800, tablet 768×1024, mobile 390×844 |
| Layout, `@viewport-desktop` | 12 | Desktop; existing wide panels and explicit intermediate-width probes |
| Layout, `@viewport-mobile` | 12 | Mobile; phone dialogs, bottom navigation and More sheet |
| Layout, `@viewport-non-mobile` | 5 | Desktop + tablet; simultaneous panes / side navigation |
| Layout, `@viewport-narrow` | 1 | Tablet + mobile; full-page trip detail instead of the wide panel |
| Functional, no smoke | 270 | Desktop |
| Functional, one `@smoke-<area>` | 17 | Desktop + mobile |
| Real | 45 | Desktop |
| Assertion probe (outside ordinary inventory) | 1 | All three; required by failure-reporting proof |

Layout therefore selects 441 project executions, functional 304 and real 45. These are per-case categories: `*-layout` files also contain functional cases, and ordinary/real files contain layout cases. Existing breakpoint branches, compact/touch target assertions, keyboard/focus checks and explicit 375px, landscape, 1051–1199px probes remain. The review keyboard case keeps its filter assertions at every width and returns before wide-only panel assertions. The dashboard's former loop over the three configured viewport sizes is now one layout case in each actual project, preserving each size while using the correct mobile touch emulation. Viewport-dependent `test.skip` calls are replaced by central selection; narrow/wide exceptions above preserve their original intent.

The smoke areas are workflow boundaries, not an assertion of independent backend modules. Each row selects exactly one expanded controlled case on mobile; a test may exercise EN and RU internally without duplicating the smoke.

| Area | Retained mobile functional smoke |
| --- | --- |
| `account` | [preferences save language at once and timezone explicitly, with row status, guarded duplicates and conflict review](../../test/e2e/account.spec.ts) |
| `admissions` | [A3 approve sends the original body, version, key and CSRF header](../../test/e2e/applications-layout.spec.ts) |
| `catalogs` | [review tabs follow arrow, Home and End keys and show returned counts](../../test/e2e/catalogs.spec.ts) |
| `dashboard` | [filters by game and period with matching totals and requests](../../test/e2e/dashboard.spec.ts) |
| `drivers` | [filters by game from the keyboard and refetches only analytics and trips](../../test/e2e/drivers.spec.ts) |
| `events` | [RSVP prevents duplicates, retains decline input on stale and clears private state on session loss](../../test/e2e/events.spec.ts) |
| `foundation` | [synthetic local form preserves input, prevents duplicate pending submissions and confirms locally](../../test/e2e/foundation.spec.ts) |
| `public` | [controlled pending and uncertain retries preserve original payload/key; changed input gets a new key](../../test/e2e/landing.spec.ts) |
| `manual-report` | [R4 the passive requirements list follows the submission state in EN and RU](../../test/e2e/manual-report-layout.spec.ts) |
| `members` | [M3 membership switch sends one PUT with the reviewed version and no roles call](../../test/e2e/members-layout.spec.ts) |
| `navigation` | [sign-in lands on Overview unless returning to a protected deep link](../../test/e2e/navigation.spec.ts) |
| `notifications` | [read through sends accepted poll checkpoint and uncertain retry cannot broaden to later arrivals](../../test/e2e/notifications.spec.ts) |
| `qualifications` | [L3 game switch updates the URL, requests the ATS levels and resets the selection](../../test/e2e/qualifications-layout.spec.ts) |
| `readiness` | [supplemental controlled readiness pending, 503 and retry recovery](../../test/e2e/readiness-states.spec.ts) |
| `review` | [R3 over-limit acceptance lists every limit and sends the confirmed flag](../../test/e2e/review-layout.spec.ts) |
| `settings` | [S5 the timezone save keeps its body, version, key and CSRF header](../../test/e2e/settings-layout.spec.ts) |
| `trip-list` | [source filter: request query, URL state, cursor reset and focus](../../test/e2e/trips-list.spec.ts) |

## Complementary evidence and protected scenarios

The [approved policy scenarios](../product/mvp-policies.md#acceptance-scenarios-for-the-confirmed-decisions) identify requirements; the sources below identify relevant evidence, not an automatic completeness verdict.

| Invariant / scenarios | Complementary layers retained |
| --- | --- |
| Permission-filtered data, additive roles, no self-approval (3–5) | `administration`, `trips`, `trip-decisions`, `events` MySQL suites; controlled account/review/catalog session-loss journeys; real administration/trip journeys. Hiding content supplements server enforcement. |
| Revisions, undated reports, actual distance, accepted totals and evidence retention (7–11, 27–28, 34, 46) | Manual-report / trip-decision contracts; `manual-reports`, `trip-decisions`, `trips`, `jobs` integration; manual-report/review layouts and controlled stale-version/retry/expiry journeys; real trips. Zero and unavailable remain distinct. |
| Historical timing, per-game qualification, promotion and late reconciliation (12–17, 19, 26, 29) | Qualification rules/changes/read-fence units; qualifications contracts; `qualifications`, `telemetry`, `reconciliation`, `analytics` MySQL suites; real qualifications and trips. Browser mocks do not replace historical transaction evidence. |
| Invitation reuse, departure/return, protected director and identity changes (24–25, 35–42, 45) | Identity/succession units; administration contracts; identity, admission and administration integration; controlled and real account/administration journeys. One-time proof consumption, lockout and revocation remain server tests. |
| Idempotency, concurrency and recovery (cross-cutting) | `concurrency`, `jobs`, manual reports, trip decisions, telemetry and reconciliation real-MySQL races; published-prefix migration, partial-DDL and recovery tests; deployment rehearsal. No server, race, idempotency, historical-timing or recovery case is removed. |

Controlled and real browser journeys are retained together: the former force transport errors, stale reads, conflict/retry and delayed responses deterministically; the latter exercise actual cookies, CSRF, authorization and persistence. Layout cases retain RU/EN long labels, overflow, touch metrics, responsive breakpoint branches and keyboard order. Contract examples and pure normalization/rule units retain their separate guarantees.

## Duplicate merges

Only two browser declarations are removed; each previously ran in the three-project inventory before runtime skips.

| Removed case at the recorded base | Retaining coverage and unique assertions |
| --- | --- |
| `catalogs.spec.ts:416`, anonymous/revoked-session review hiding | `catalogs.spec.ts`, **a revoked session removes review and published catalog content** (base line 926), retains the same mocked `/me` 401 + focus refresh. It now explicitly checks that the Candidate review heading is absent, alongside the sign-in heading and absence of candidate/build/revision content. The retained test protects more private catalog content. |
| `trips.spec.ts:15`, generic controlled trip-list zero/labels/overflow/keyboard case | `trips-list.spec.ts`, **trip list layout: tabs, compact filters, dense table or phone cards in RU and EN** (base line 170), retains zero km, long EN/RU labels, overflow, screenshots and richer table/card checks. Its fixture carries the representative long Cyrillic origin. **keyboard reaches filters, rows and the panel in order; tabs activate manually** (base line 425) now carries ArrowDown before Tab and verifies Company decision focus, with the remaining row/panel order checks. Both remain layout cases at all three projects. |

Other apparent overlaps are complementary as above. No integration, persistence, recovery or deployment rehearsal case is deleted. Full exact-head Quality execution and independent review remain delivery gates; listing, native unit feedback and a baseline hosted pass do not establish candidate browser/MySQL acceptance.

## Persistence, recovery and deployment rehearsal

The Node lanes are inventoried separately from Vitest: [persistence.test.ts](../../test/persistence/persistence.test.ts) contains 17 published-upgrade cases plus one foundation parent with 11 sequential subtests; [recovery.test.ts](../../test/persistence/recovery.test.ts) contains 15 `recoveryTest` cases. Do not add parents, nested subtests and Vitest cases as a uniform total. Baseline whole-lane durations are **97.758s persistence** and **86.063s recovery**; per-case durations are not measured. Scaffold checks cover configuration, harness and public surfaces separately under [test/scaffold](../../test/scaffold/); they are not domain integration proof.

The [deployment rehearsal coverage manifest](../../deploy/development/rehearsal-coverage.json) records eight core and fourteen recovery checkpoints, plus the window harness, whose scheduler acceptance has nine scenarios. Checkpoints are not test-case counts. Safe VTC-072 window output contains only scenario ordinal/start offset/duration, scheduler tick count and summed tick work seconds; no safe rehearsal timing artifact was supplied with this baseline, so those durations are **not measured here**. Never infer them from lane or job wall time.

For comparable hosted E2E evidence, keep the same six-shard topology and report three measures separately: baseline test-duration sum **1,839,132ms**, E2E-stage sum **1,986,504ms**, and maximum E2E stage **367,399ms**. Stage sums include preparation/server/harness work; maxima approximate the slowest shard stage, not end-to-end workflow wall time. Refresh weights only from complete candidate measurements; the policy makes no fixed speed promise. See [safe CI diagnostics](ci.md#safe-diagnostics) for the bounded per-execution timing schema.
