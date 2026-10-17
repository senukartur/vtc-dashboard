# Hostland production findings retained for VTC-041

**Observed:** 2026-10-17. **Status:** documentation/read-only findings retained; no hosted proof. **Origin:** [VTC-004](https://trello.com/c/OZ84Rfk4). **Execution owner:** VTC-041, after VTC-040 testing. The owner's later clarification supersedes the initial early-Hostland gate: development uses a separate account up to USD 20/month, with [its own deployment plan](development-hosting.md). The gates below block final production cutover only, not VTC-004 plan completion, architecture or staging.

The owner-selected target is Node.js 24 and maintained MySQL 8.4 LTS, conditional on availability at the same approximately USD 35/year budget. The owner approved that version direction on 2026-10-17 after the MySQL 8.0 lifecycle finding; actual account availability/cost and version pins remain unverified. This supersedes the earlier 8.0 working baseline, not any existing site's database. No existing site/database, subscription, DNS, runtime, credentials or cron configuration was changed during inspection. No support message was sent.

## Evidence levels

- **Public documentation:** provider/runtime/CI documentation and an observed public price page. These establish advertised capabilities, not account entitlement or application compatibility.
- **Read-only panel inspection:** navigation, selectors and unsaved forms. This establishes that configuration interfaces exist, not that a selected runtime, database or scheduled job successfully runs.
- **Execution proof:** no account runtime/database/background/SSE/deployment proof has been performed. A [concrete verification plan](hostland-verification.md) describes the required isolated tests.

Account identifiers, internal endpoints, paths, version inventory, existing sites/jobs, billing and control-panel captures are excluded from this public report. The only financial values below are publicly advertised offers and the owner-approved project budget.

## Capability matrix

| Capability | Public evidence | Actual proof still required |
| --- | --- | --- |
| Node.js application | Provider documents a `server.js` entry, `public/`, Passenger logs and `tmp/restart.txt` restarts [H2] | Actual patched Node.js 24 process, compatible Passenger loader/port binding, Fastify request, restart and cold start |
| MySQL | Shared-hosting listing includes 5.7/8.0/8.4 [H1]; 8.4 availability announced 2026-05-28 [H3] | New isolated database on maintained release, actual server/configuration, auth/TLS, privileges, transactions and limits; public availability is not account access |
| SSH/SFTP/SCP | Advertised [H1] | Noninteractive GitHub-runner access, approved scoped credential and host-key pinning; no new persistent access created during research |
| TLS | SSL listed [H1] | Dedicated test hostname/certificate, HTTPS origin, redirect/proxy handling, secure cookies and renewal |
| Scheduled work | Provider describes minute-based cron [H4] | Actual Node CLI execution and timing with no website visitors, non-overlap, resource use, durable resume after failure |
| Web process lifetime | Passenger manages application processes [P1] | Host configuration, idle/recycle behavior and shutdown grace; persistent in-process workers/timers are not assumed |
| Notifications | Owner approved minute cron and 30-second visible-site polling, approximately 90 seconds under healthy/no-backlog conditions | Actual polling/cron latency, chained jobs, catch-up and authorization; SSE remains optional and unverified |
| Runtime resources | Provider publishes separate script and shell/cron limits [H5] | Which limits apply to Passenger and the account; measure Fastify memory, CPU and file descriptors |
| Persistence/uploads | Application/static directories and backup facilities documented [H2/H6] | Private persistent evidence outside public releases, permissions, capacity, deployment survival and verified access control |
| Email | Hosting advertises mail facilities [H1] | Authenticated outbound HTTPS email adapter or SMTP, provider limits and deliverability; no test messages sent |
| Backup/restore | Files and MySQL backup/download flows documented [H6] | Exact cadence/retention/coverage, independent backup destination/cost, restore into isolated targets; existing content must never be used as the restore target |
| CI delivery | Standard GitHub-hosted runners are free for public repositories; storage/larger runners have separate billing rules [G1] | Implement protected build/deploy jobs, bounded artifact retention and an actual target-compatible release/rollback rehearsal |

## Runtime lifecycle finding

Oracle states that MySQL 8.0 entered Sustaining Support on **2026-04-21**, and the 8.0 release notes mark 8.0.46 as EOL [M1/M2]. Merely seeing "8.0" is not evidence of ongoing security fixes. Hostland publicly advertises MySQL 8.4 [H1/H3], but use on the intended account and within the existing budget must be confirmed. The owner approved maintained MySQL 8.4 LTS at the same budget. If it is unavailable at acceptable cost, return for a concrete hosting/version decision; do not silently revert to 8.0 or choose a different database. Provider support evidence about 8.0 would inform that decision, not establish a new approval.

Node.js 24 is an LTS line; the official schedule lists maintenance from **2026-10-20** and end of life **2028-04-30** [N1]. Support for the major line does not make every old patch suitable. Node's June 2026 security release included fixes for the 24.x line [N2]. Pin and test an adequately patched release and its ongoing update mechanism; a panel selector is neither execution proof nor a patch-maintenance policy. Actual account runtime inventory remains private.

## Resource implications

The public limits page distinguishes script processes from shell/cron jobs: both list 512 MB/process, 20 tasks and 50 open files; shell/cron additionally lists only 5 CPU seconds, while normal scripts list 15 CPU seconds [H5]. It also lists 100 MySQL connections and 50 HTTP connections. These are published defaults, not measured application capacity or proof that Passenger is governed identically. Ask the provider before sizing pools/workers. A cold start, screenshot processing, dependency installation or backup can exceed a CPU allowance even if average traffic is low.

The conservative design is a single deployable web application with small database pools and an independently scheduled, bounded MySQL-backed job runner. Do not require PM2, Docker, Redis, a permanently alive Passenger process, or adjustable global proxy settings. The [deployment decision](../decisions/hosting.md) records the recommendation and pending approvals/proofs.

## Public cost worksheet

The rendered public hosting page showed these annual-payment offers on the observation date [H1]; they are **not the current account's tariff or a renewal quote**:

| Public offer | Advertised annual hosting fee | Calculation against USD 35 hosting-only |
| --- | --- | --- |
| GREEN | RUB 2,364 | Fits only if the applicable conversion is at least 67.54 RUB/USD, before all other costs |
| RED | RUB 3,372 | Requires at least 96.34 RUB/USD before other costs |

No live exchange rate or all-in USD price is claimed. Current-account annual renewal, domain renewal, tax/payment conversion, backup storage, email and any runtime/database/site add-ons still require a private total in VTC-041. Avoid selecting a more expensive plan from a marketing price alone. The final production cutover remains unapproved until that total is within the annual budget. A separate USD 20/month development/testing ceiling is now approved; it is not part of this production worksheet.

For current development, use local Node/MySQL plus CI and a separate hosted staging account within the newly approved USD 20/month ceiling. The [development comparison](development-hosting.md) and [revised deployment direction](../decisions/hosting.md) supersede the initial local-only hosting recommendation. VTC-011 implements and tests the staging plan; passing it does not prove Hostland compatibility.

## Evidence storage and backups

Keep screenshots for at least one year after the latest decision and throughout review, as required by the concept. Estimate retained evidence separately from database, releases, temporary image files and backup overhead. A planning example, **not measured workload**: 30 members × 1 manual report/day × 2 screenshots × 0.6 MiB × 365 days = 13,140 MiB, before overhead. Telemetry-only reports need no screenshots, so actual manual volume matters. Storage sufficiency cannot be asserted from member count alone or resolved by shortening retention.

The public feature page describes seven snapshots over fourteen days, while the backup guide describes seven-day defaults [H1/H6]. Cadence/retention therefore need confirmation. Neither snapshot schedule satisfies application evidence retention by itself. Establish an independent backup/export procedure and restore drill with consistent database/file boundaries. Provider restore actions can overwrite current data [H6]; never test them against existing sites or production databases.

## Open gates and ownership

| Gate | Evidence needed | Owner |
| --- | --- | --- |
| HOST-01 | Owner approved MySQL 8.4 at the annual production budget; actual availability, maintenance and cost remain unverified | Project owner + provider; VTC-041 |
| HOST-02 | Patched Node.js 24/update mechanism; actual Fastify/Passenger execution | Provider + isolated proof; VTC-041 |
| HOST-03 | Private all-in annual production cost/capacity, including retained screenshots/backups | VTC-039/041 |
| HOST-04 | Isolated Hostland runtime/database/cron/TLS/storage/outbound proof | Authorized production account operator; VTC-041 |
| HOST-05 | Owner-approved cron/polling and approximate healthy 90-second target: prove on staging first, then on Hostland | VTC-011/021/036/037, final proof VTC-041 |
| HOST-06 | Hostland-compatible artifact, SSH deployment and rollback/restore/transfer rehearsal | VTC-041, reusing VTC-009/011 tooling |

Provider questions are [prepared and unsent](hostland-provider-questions.md); the [proof plan](hostland-verification.md) is not run. VTC-041 owns them after integrated testing. VTC-004 can deliver its reviewed staging plan and VTC-005 can finalize locally/CI-tested development contracts without Hostland access. Keep the final production compatibility claim unverified until those later checks pass.

## Primary sources

- **H1:** [Hostland shared-hosting features and public offers](https://www.hostland.ru/hosting), including the rendered annual-payment cards.
- **H2:** [Hostland Node.js setup](https://www.hostland.ru/ru/docs/manual/avtomaticheskaya-ustanovka-nodejs).
- **H3:** [Hostland news, 2026-05-28 MySQL 8.4 announcement](https://www.hostland.ru/newslist).
- **H4:** [Hostland cron instructions](https://www.hostland.ru/ru/docs/useful/kak-ispolzovat-cron-i-vse-chto-s-nim-svyazano-u-nas-na-khostinge).
- **H5:** [Hostland resource limits](https://www.hostland.ru/ru/docs/useful/ogranicheniya-na-potreblenie-resursov-servera).
- **H6:** [Hostland backup and restoration guide](https://www.hostland.ru/ru/docs/useful/kak-sdelat-vosstanovit-backup).
- **M1:** [MySQL EOL announcements](https://www.mysql.com/support/eol-notice.html).
- **M2:** [MySQL 8.0 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/).
- **N1:** [Official Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json).
- **N2:** [Node.js June 2026 security releases](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases).
- **P1:** [Passenger Apache configuration reference](https://www.phusionpassenger.com/docs/references/config_reference/apache/), including startup/runtime/idle controls; not Hostland's actual configuration.
- **G1:** [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
