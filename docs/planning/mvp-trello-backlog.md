# VTC Dashboard — MVP Trello Backlog

**Status:** proposed backlog, not implementation status.

**Prepared:** 2026-10-16.

**Repository:** https://github.com/senukartur/vtc-dashboard

**Target board:** https://trello.com/b/NwhwurSM/vtcdashboard

**Telemetry repository:** https://github.com/senukartur/ets2telemetry

**Telemetry board:** https://trello.com/b/ZF3E5ggm/ets2-telemetry


This file contains **42 MVP cards and 11 deferred cards** and is the planning baseline for implementation agents. All 53 cards were imported into Trello on 2026-10-16 with descriptions, native acceptance checklists, and linked dependencies; see the [Trello card index](trello-card-index.md). Importing cards does not mark implementation work complete. No repository settings, paid resources, or deployments were created by preparing this document. All repository documentation is written in English; the product supports Russian and English.

Start with the root [CONCEPT.MD](../../CONCEPT.MD) for the project idea, authoritative approved requirements, architecture direction, and acceptance scenarios. This backlog owns execution scope, dependencies, and module ownership.

## 1. Scope and decisions

### Confirmed product scope

- One VTC with approximately 10–30 members; ETS2 and ATS; no migration of legacy users or trips.
- Responsive public landing, application to join, login, member dashboard, driver directory/profiles, trips, administration, and public/private events.
- Email/password sign-in after application approval and an invitation; Steam is a linked identity, not the primary login method.
- Multiple additive roles per user (Trainee, Driver, Dispatcher, Deputy Director, Director), server-side permissions, and separate per-game qualification levels. A deputy has director permissions except director-only leadership transfer and protected changes to the serving director's account; exactly one director serves the company.
- Own telemetry and manual reporting in MVP. Manual-only reports need dispatcher approval; sufficiently supported telemetry trips are checked automatically.
- Flexible, versioned qualification limits; proven violations are rejected with reasons, missing/ambiguous facts require review.
- One canonical trip with preserved source evidence; retries, manual/telemetry overlap, and later provider overlap must not multiply statistics or progress.
- Local, versioned game catalogs with canonical IDs, RU/EN labels, DLC/build scope, provider mappings, and an explicit update workflow.
- Public/private convoys, upcoming/past views, RSVP, mandatory decline reasons, upcoming-event header, and reminders.
- In-app notification history and real-time updates while the site is open. Web Push is deferred.
- Company-administrator-owned integrations (director/deputy) for future Trucky/VTCBase webhooks; drivers configure only their own telemetry token.
- Source adapters, durable events, and extensible rule types are foundations. Full external adapters, visas, reputation formulas, and spendable points are deferred.
- MySQL is the selected database for local development, CI, temporary hosting, and production. The earlier PostgreSQL proposal is superseded; no legacy database migration is required.

### Updated hosting constraint — supersedes the earlier monthly estimate

The owner-approved production budget is **approximately USD 35 per year**. The intended provider is **Hostland (https://www.hostland.ru/)**. Verify the full deployment/renewal cost and included database, backups, file storage, domain, and taxes privately. This public repository records the project budget and compatibility requirements, not account-specific tariffs, billing, identifiers, or inventory. Public advertised offers are not evidence of an existing account's terms.

Development may use a different, convenient host before a later transfer. Its budget is a separate pending decision; use free/local options by default until paid development spending is explicitly agreed.

Hostland publicly documents Node.js on shared hosting, so do not classify this provider as PHP-only. The project targets Node.js 24 and MySQL 8.0; verify actual supported patches, maintenance, process limits, and SSE behavior privately before deployment. **VTC-004 is an early compatibility gate, not a final deployment afterthought.** A transfer must be rehearsed; changing only environment variables is not a proven migration strategy.

Free development hosting can sleep, expire databases, or discard local files. Those limits may delay webhooks and reminders. Such an environment is not proof of production reliability. Render's free-service documentation is a research reference, not a selected hosting plan.

### Hostland preliminary findings (2026-10-16)

- **Public-safe capability summary:** MySQL is owner-selected, with MySQL 8.0 and Node.js 24 as the target compatibility baseline. Exact supported versions, maintenance, account quotas, existing services, and billing remain private verification inputs for VTC-004. Do not publish control-panel captures or inventory to substantiate them.
- [Shared-hosting specifications](https://www.hostland.ru/hosting) list Node.js, MySQL, SSH access, cron, and SSL. These public features do not confirm the existing account's exact limits or legacy tariff.
- [Node.js setup documentation](https://www.hostland.ru/ru/docs/manual/avtomaticheskaya-ustanovka-nodejs) describes a server.js entry point, a public directory, Passenger logs, and restart.txt-based restarts. Verify the supported runtime version and Fastify startup behavior with a minimal deployment. Building in GitHub Actions and deploying a compatible artifact over SSH is a candidate workflow, not a verified integration.
- [PostgreSQL documentation](https://www.hostland.ru/ru/docs/manual/postgresql) describes automatic installation on **VDS**. Shared-hosting specifications list MySQL; PostgreSQL availability on the existing account is **not confirmed**. Do not infer that the VDS PostgreSQL offering is included in the current annual fee.
- [Resource-limit documentation](https://www.hostland.ru/ru/docs/useful/ogranicheniya-na-potreblenie-resursov-servera) describes execution, memory, and process limits. Confirm their applicability to Passenger-managed Node.js, shell/cron jobs, and long-lived SSE requests rather than treating the limits for one process class as universal.
- **Decision:** use MySQL directly from the first schema and migration. Do not introduce a PostgreSQL development environment or plan a later dialect conversion. A separately priced database/VDS is not part of the approved budget.
- If persistent workers or SSE are unsupported, evaluate bounded cron-driven jobs and authenticated notification polling. Record timing/latency trade-offs and update the contracts and affected cards before adopting either change.

VTC-004 remains open: actual runtime/database patches and maintenance, a host deployment test, background-task/SSE support, and full cost compatibility require verification. The temporary development budget also remains unanswered. Read-only account access does not authorize changing settings, applications, databases, or subscriptions. Keep verification evidence private and publish only a sanitized compatibility conclusion.

### Proposed stack, subject to VTC-004 and VTC-005

React + TypeScript + Vite; shadcn/ui + Tailwind; Recharts; TanStack Query; React Hook Form + Zod; i18next. Backend: **Node.js 24 LTS + Fastify, MySQL 8.0 + Drizzle (mysql2 driver)**, Better Auth with its MySQL Drizzle adapter, a transactional email adapter (Resend candidate), and SSE. MySQL is confirmed by the owner; the remaining library versions and host execution model are finalized in VTC-004/VTC-005.

Use a modular monolith, one deployable application where supported, database-backed durable jobs/outbox, and replaceable email/blob/source adapters. A worker may initially run in-process, but jobs must survive restart and be safe under multiple consumers. No Redis, microservices, or per-second telemetry storage is required for MVP.

If host discovery changes this choice, update the architecture ADR and all affected card assumptions **before** infrastructure-dependent implementation. Do not quietly implement two backend stacks.

### MySQL implementation baseline

- Use InnoDB, foreign keys, explicit unique constraints, and short transactions for domain changes plus outbox writes. Keep searchable trip facts in typed columns; JSON stores source payloads and versioned rule configuration, not the whole relational model.
- Use utf8mb4 for localized text. External IDs, source event keys, token hashes, and other opaque identities need explicit exact comparison semantics; do not let case/accent-insensitive label collation merge distinct IDs. Normalize display-name aliases separately with game/locale context.
- Store timestamps with documented UTC and fractional-second conventions; use lossless handling for large external IDs and exact decimal quantities. Pin SQL modes, isolation level, connection timezone, and a small bounded pool appropriate to shared hosting.
- Implement durable jobs through MySQL tables, transactional claims/leases, and idempotent effects. Test MySQL 8.0 locking behavior, including a candidate FOR UPDATE SKIP LOCKED claim strategy, on the selected server. Persistent workers versus bounded cron execution remains a hosting decision; neither requires Redis.
- Pin real MySQL test instances to the verified production version/configuration, or document and test a deliberate patch difference. SQLite, MariaDB, and PostgreSQL are not substitute integration-test engines. Use the same Node.js major line and check the actual production patch in compatibility CI.
- Use reviewed, serialized migrations and rehearsed backup/restore. MySQL DDL may implicitly commit: rolling back an application transaction is not a schema rollback strategy. Prefer additive migrations and documented forward repair; validate recovery after a partially applied migration.

The relevant implementation details are tracked in VTC-004–009, VTC-011, VTC-013, VTC-019, VTC-021, VTC-023, VTC-026, and VTC-041. Card IDs, ownership boundaries, and dependencies remain stable.

## 2. How to use these cards in Trello

Board lists: **Backlog → Ready → In Progress → Review → Done**, plus **Blocked** and **Later**. The import placed all 42 MVP cards in Backlog and all 11 deferred cards in Later. Dependencies and product decisions must be checked before moving a card to Ready.

Use the full heading as the card title, for example `[VTC-023] Implement personal telemetry tokens and durable ingestion`. Copy the goal, ownership, dependencies, checklist, validation, and notes into its description.

Suggested labels: Discovery, Architecture, Foundation, Backend, Frontend, Quality, Delivery, Operations, External, Release, Later.

- IDs are stable and independent of Trello's own numbering. Preserve them in branches, commits, PR descriptions, and cross-repository links.
- **Depends on** means prerequisites to start implementation against stable interfaces. Research/drafts may begin sooner; they are not completed implementations.
- Frontend cards may start with reviewed contract fixtures. Their additional **integration gates** must be complete before the card moves to Done.
- A pending product decision, missing host capability, unavailable credential, or external client work is a visible blocker with an owner, not an implicit assumption.
- Keep one active owner per card. Split oversized cards into suffixed child IDs, such as VTC-030A, preserving the parent scope and updating dependencies.
- No duration estimates are promises. Size and scheduling should be revisited after discovery.

### Definition of Ready

- Dependencies or approved contract versions are available.
- The required product decisions are approved or explicitly deferred with a safe specified behavior.
- Ownership, interfaces, affected tables, and shared-file changes are understood.
- Fixtures and acceptance scenarios are available; external prerequisites have named owners.

### Definition of Done

- Acceptance checklist is satisfied against real integrations where required; mock-only UI is not Done.
- Relevant unit, integration, contract, and/or E2E checks pass; choose tests by behavior and risk.
- English developer/operations documentation and RU/EN UI strings are updated where applicable.
- Migration and permission changes are reviewed; secrets and private production data are absent from code/fixtures/logs.
- An independent review appropriate to risk is completed, findings are resolved, and required CI passes.
- The PR is merged with evidence, deployment impact, and rollback notes. Copy the PR link into the Trello card.
- Infrastructure cards distinguish prepared configuration from actually applied and verified settings.
- No feature is counted complete solely because a shell command or deployment trigger returned successfully.

## 3. Parallel-agent implementation protocol

1. Establish interfaces first in VTC-003/VTC-005. Commit schemas, examples, event names, reason codes, and module ownership before parallel feature implementation.
2. Give each agent a dedicated branch/worktree and one bounded card. Never run multiple agents editing the same checkout or silently overwrite another agent's work.
3. Use the ownership paths below as proposed boundaries. Scaffold actual directories in VTC-006 and update this document if naming changes.
4. The foundation/integration owner controls root manifests, lockfiles, shared contracts, app composition/router entry points, CI, and the migration journal. Feature agents request additive changes rather than simultaneously editing these files.
5. Feature agents own their module schema files. The migration owner generates/serializes the final migrations after rebasing; migration IDs and journal entries must not collide.
6. Frontend agents use feature-local routes, translations, and contract mocks. Backend agents implement the same contract; neither invents a competing response shape.
7. Review and merge small contract/core PRs before dependent features. Cross-cutting changes require a short coordinated integration PR.
8. The quality owner owns test infrastructure and cross-module journeys; every feature owner still adds its own meaningful tests.
9. The telemetry client card runs in its own repository and supplies linked verification evidence here. Do not duplicate existing telemetry-board work without checking it.
10. After each merge, rebase dependent branches and run their relevant integration checks. A clean dependency graph does not eliminate shared-file conflicts.

### Suggested workstreams

| Phase | Parallel work | Coordination / exit gate |
| --- | --- | --- |
| Discovery | VTC-001 product policy; VTC-002 catalogs; VTC-003 telemetry contract; VTC-004 hosting | Resolve critical assumptions before stack-dependent implementation |
| Shared foundation | VTC-005 then VTC-006; after that DB VTC-007 and UI VTC-012 can diverge | Freeze contract examples and shared-file ownership |
| Early quality/delivery | VTC-008 → VTC-009 → VTC-010; VTC-011 after its prerequisites | Required tests, review process, and a verified development deploy |
| Platform/services | VTC-013 identity, VTC-019 catalogs, VTC-021 jobs; frontend contract-driven cards can run alongside | Merge stable module APIs, then their integrations |
| Feature lanes | Onboarding VTC-014–018; trips VTC-022–026; rules VTC-027–028; events VTC-034–035 | One owner per module; respect actual card dependencies, not numeric order |
| Integration | VTC-029 decisions; VTC-030/031 UI integration; VTC-032/033 analytics; VTC-036–038 notifications/admin | Verify no double-counting and all UI gates |
| Release | VTC-039 hardening, VTC-040 regression, VTC-041 production rehearsal | VTC-042 requires all MVP cards and owner-approved launch criteria |

Numbers are identifiers, not a strictly sequential schedule. For example, durable jobs VTC-021 are needed before email VTC-014.

## 4. MVP card index

| Card | Track | Start dependencies |
| --- | --- | --- |
| [VTC-001: Confirm MVP policies, permissions, and acceptance scenarios](#vtc-001) | Discovery | None |
| [VTC-002: Investigate and prototype versioned game catalogs](#vtc-002) | Discovery | None |
| [VTC-003: Agree the versioned telemetry ingestion contract](#vtc-003) | Discovery | None |
| [VTC-004: Verify the existing host and select a portable deployment approach](#vtc-004) | Discovery | None |
| [VTC-005: Define architecture, module ownership, and API contracts](#vtc-005) | Architecture | VTC-001, VTC-002, VTC-003, VTC-004 |
| [VTC-006: Bootstrap the repository and local development environment](#vtc-006) | Foundation | VTC-005 |
| [VTC-007: Create database, migration, and audit foundations](#vtc-007) | Foundation | VTC-006 |
| [VTC-008: Set up unit, database integration, contract, and browser test tooling](#vtc-008) | Quality | VTC-006, VTC-007 |
| [VTC-009: Configure pull request CI and required test checks](#vtc-009) | Quality | VTC-008 |
| [VTC-010: Configure code review, repository rules, and dependency hygiene](#vtc-010) | Quality | VTC-006, VTC-009 |
| [VTC-011: Deploy an early development environment](#vtc-011) | Delivery | VTC-004, VTC-006, VTC-007, VTC-009 |
| [VTC-012: Build the responsive UI foundation and localization](#vtc-012) | Frontend | VTC-005, VTC-006 |
| [VTC-013: Implement account authentication, sessions, and server-side permissions](#vtc-013) | Backend | VTC-005, VTC-007, VTC-008 |
| [VTC-014: Implement transactional email and invitation delivery](#vtc-014) | Backend | VTC-013, VTC-021 |
| [VTC-015: Implement application review and invitation onboarding APIs](#vtc-015) | Backend | VTC-013, VTC-014 |
| [VTC-016: Build the public landing and application experience](#vtc-016) | Frontend | VTC-012 |
| [VTC-017: Build login, invitation, recovery, and account settings screens](#vtc-017) | Frontend | VTC-012 |
| [VTC-018: Link Steam and resolve TruckersMP identities](#vtc-018) | Backend | VTC-013 |
| [VTC-019: Implement versioned catalogs, imports, and identity normalization](#vtc-019) | Backend | VTC-002, VTC-007, VTC-008 |
| [VTC-020: Build catalog administration and localized selectors](#vtc-020) | Frontend | VTC-012 |
| [VTC-021: Implement durable jobs and transactional domain events](#vtc-021) | Backend | VTC-005, VTC-007, VTC-008 |
| [VTC-022: Implement canonical trip records and source adapter boundaries](#vtc-022) | Backend | VTC-003, VTC-007, VTC-019, VTC-021 |
| [VTC-023: Implement personal telemetry tokens and durable ingestion](#vtc-023) | Backend | VTC-013, VTC-018, VTC-022 |
| [VTC-024: Implement and verify the desktop telemetry upload integration](#vtc-024) | External | VTC-003, VTC-023 |
| [VTC-025: Implement manual report submission and evidence storage](#vtc-025) | Backend | VTC-013, VTC-022 |
| [VTC-026: Implement deduplication and reversible reconciliation](#vtc-026) | Backend | VTC-022, VTC-025 |
| [VTC-027: Implement the extensible qualification rule evaluator](#vtc-027) | Backend | VTC-001, VTC-019, VTC-008 |
| [VTC-028: Implement qualification configuration, assignment history, and progress](#vtc-028) | Backend | VTC-013, VTC-021, VTC-027 |
| [VTC-029: Implement acceptance orchestration and dispatcher review](#vtc-029) | Backend | VTC-023, VTC-025, VTC-026, VTC-028, VTC-034 |
| [VTC-030: Build trip lists, manual forms, details, and review workspace](#vtc-030) | Frontend | VTC-012, VTC-020 |
| [VTC-031: Build qualification and rule administration screens](#vtc-031) | Frontend | VTC-012, VTC-020 |
| [VTC-032: Implement company and driver analytics APIs](#vtc-032) | Backend | VTC-029 |
| [VTC-033: Build company dashboard and driver profiles](#vtc-033) | Frontend | VTC-012 |
| [VTC-034: Implement events, visibility, and RSVP APIs](#vtc-034) | Backend | VTC-013, VTC-021 |
| [VTC-035: Build event management, public listings, and participation UI](#vtc-035) | Frontend | VTC-012 |
| [VTC-036: Implement notification history, SSE, and event reminders](#vtc-036) | Backend | VTC-021, VTC-029, VTC-034 |
| [VTC-037: Build notifications UI and real-time connection behavior](#vtc-037) | Frontend | VTC-012 |
| [VTC-038: Build member administration and source connection settings](#vtc-038) | Frontend | VTC-012 |
| [VTC-039: Harden security, observability, retention, and recovery](#vtc-039) | Operations | VTC-011, VTC-029, VTC-036 |
| [VTC-040: Complete cross-module E2E and failure regression coverage](#vtc-040) | Quality | VTC-016, VTC-017, VTC-024, VTC-030, VTC-031, VTC-033, VTC-035, VTC-037, VTC-038 |
| [VTC-041: Configure production deployment, backups, and host transfer rehearsal](#vtc-041) | Delivery | VTC-004, VTC-010, VTC-011, VTC-039 |
| [VTC-042: Run the VTC pilot and complete the MVP release](#vtc-042) | Release | VTC-040, VTC-041 |

## 5. MVP card descriptions

<a id="vtc-001"></a>

### [VTC-001] Confirm MVP policies, permissions, and acceptance scenarios

- **Track:** Discovery
- **Depends on:** None
- **Primary ownership:** CONCEPT.MD, docs/product/, docs/planning/
- **Status:** Requirements approved by the owner; [PR #1](https://github.com/senukartur/vtc-dashboard/pull/1) and the [Trello card](https://trello.com/c/GE2YTTXT/1-vtc-001-confirm-mvp-policies-permissions-and-acceptance-scenarios) track documentation delivery and review/merge evidence.

**Goal:** Turn the agreed plan into explicit rules before implementing business decisions.

**Approved requirements:** Root [CONCEPT.MD](../../CONCEPT.MD) is the authoritative project and product baseline. It includes the project idea, working architecture, permission matrix, source-specific timing, account lifecycle, events, retention, and 42 acceptance scenarios. The [VTC-001 approval record](../product/mvp-policies.md) preserves the earlier document path. These requirements supersede earlier proposals and narrower summaries in implementation cards.

**Key decisions**

- Five additive roles: trainee, driver, dispatcher, deputy director, director. Exactly one director; deputy permission parity excludes leadership transfer and changes to the serving director's email/login credentials. No role may approve its own manual report.
- Only the serving director transfers leadership atomically to another active member, using a one-time code sent to their verified email, valid for ten minutes and bound to the selected successor. Protected email/login changes require confirmation via the current verified email.
- Applications and seven-day one-time invitations support email and manual copy-link delivery. Departure revokes access/tokens without losing history; return reuses the account with newly assigned roles/qualifications. Steam replacement is an audited administrative action that revokes telemetry tokens.
- Manual reports require game, cities, cargo/mass, trailer type, actual distance, and screenshot; event/comment are optional and no trip date is entered. No submission deadline. Authors edit pending/rejected revisions; accepted changes go through staff. Preserve screenshots at least one year after the latest decision and throughout review.
- Telemetry uses actual completion for analytics and actual start for qualification/rule selection and progress period. Undated manual reports use confirmation time for analytics, qualification/rules, and current-level progress.
- Per-game levels: Trainee → III → II → I. Count accepted trips and actual distance since level assignment; authorized administrators confirm promotion. Event-prescribed loads bypass ordinary qualification restrictions for confirmed participants and count toward progress. Corrections recalculate totals and notify administrators without automatic demotion.
- Accepted canonical trips and actual distance drive headline analytics. Late telemetry is another source for the same trip; changes to a confirmed result, reporting period, or progress require staff review.
- Events are voluntary, responses editable until the revised start, decline reasons private to author/director/deputies, and actual participation confirmed separately. Open-site reminders target signed-up members one hour before start; changes/cancellation notify them and reschedule/cancel reminders.
- Company reporting timezone and numeric qualification thresholds/limits are configured before launch. Provider/catalog/runtime verification and upload-capacity checks remain in their own cards. Trucky/VTCBase adapters, visas, reputation/points, Web Push, and custom role authoring are deferred.

**Scope and acceptance checklist**

- [x] Record one VTC, 10–30 users, ETS2/ATS, RU/EN, no legacy migration, manual review and automatic telemetry validation.
- [x] Publish the multi-role permission matrix, initial qualification levels, trainee requirements, promotion approval, and event exceptions; keep unanswered values explicitly pending.
- [x] Decide rule effective-time policy, report evidence/editing/deadlines, user deactivation/deletion, event visibility/attendance, and metric definitions.
- [x] Separate roles, per-game qualifications, future reputation, and future spendable points; record the $35/year production hosting target.

**Validation:** The owner confirmed the policy decisions in the requirements conversation, including the final succession mechanism. The requirements document records 42 acceptance scenarios for later implementation tests; these are not executed feature tests.

**Boundaries / integration gates:** Product requirements are approved. Independent documentation PR review, merge, and a linked PR remain required by the common Definition of Done before delivery is marked Done. Application implementation, hosting verification, and production configuration belong to their own cards.

<a id="vtc-002"></a>

### [VTC-002] Investigate and prototype versioned game catalogs

- **Track:** Discovery
- **Depends on:** None
- **Primary ownership:** docs/research/catalogs.md, spikes/catalogs/
- **Research status:** [Source investigation](../research/catalogs.md), [full observed DLC audit](../research/dlc-coverage-2026-10-17.md) and [owner-approved hand-off](../research/catalog-source-follow-up.md) prepared for review on 2026-10-17. Research criteria are satisfied; review/merge evidence still gates Done. The owner approved transferring the three unavailable ATS source checks to VTC-019 without relaxing all-official-DLC launch coverage. This is not completed production catalog delivery.

**Goal:** Prove a reproducible source of game identifiers, cities, companies, cargo, and trailer classifications for both games.

**Scope and acceptance checklist**

- [x] Compare Trucky city endpoints with SCS game/DLC definition extraction; document access conditions, provenance, update effort, and redistribution constraints.
- [x] Produce a small representative ETS2/ATS dataset including RU/EN names, city-region relationships, cargo ADR/body types, and trailer body/chain types.
- [x] Record the exact game builds, DLC coverage, missing identifiers/translations, and how to detect added/renamed/retired entries.
- [x] Document the approved base-game/all-official-DLC launch target for both games and a repeatable update process, with project-maintained RU/EN labels and visible English fallback for missing Russian translations; do not label an incomplete sample as a complete current catalog.

**Validation:** Fourteen offline experiment checks pass, covering localized identity, missing translations, candidate additions/changes, mass separation and incomplete/failed DLC source protection. An ignored representative real-field sample for both games validates city-region references, hazardous cargo/body/unit mass and trailer body/chain compatibility; public examples are synthetic rather than extracted game data. The audit records all 169 observed public Steam DLC entries and 180 local archive inspections. See the linked evidence for exact source/coverage limits.

**Boundaries / integration gates:** The owner approved finishing discovery with Louisiana/Illinois/South Dakota source gaps assigned to VTC-019 and still mandatory before launch. Permitted-use verification, active registry/include/overlay handling and complete production labels/imports remain named downstream gates. Technical maintainer prepares updates; director/deputy publishes. Do not purchase DLC or redistribute game assets. Independent review and merged PR evidence remain required before Done.

<a id="vtc-003"></a>

### [VTC-003] Agree the versioned telemetry ingestion contract

- **Track:** Discovery
- **Depends on:** None
- **Primary ownership:** docs/contracts/telemetry-v1.md, docs/contracts/examples/

**Goal:** Align the dashboard with the existing ets2telemetry application before either side implements uploads.

**Agreed discovery baseline (2026-10-17):** [Source findings](../research/telemetry.md), [HTTP contract and structural schema](../contracts/telemetry-v1.md), [synthetic examples](../contracts/examples/README.md), and [acceptance matrix](../contracts/telemetry-v1-acceptance.md). The owner requires automatic initial upload of all retained local game trips, followed by ongoing updates; this is distinct from deferred server-to-client restore. The inspected telemetry source still disables real-game recording and implements no HTTP uploader. The owner authorized adoption of the independently reviewed/corrected contract; [PR #3](https://github.com/senukartur/vtc-dashboard/pull/3) records final review/merge. First-binding limitations, time/distance projection and transport defaults are explicit in the agreement; real-client/MySQL/hosting evidence remains VTC-023/024 and release work.

**Scope and acceptance checklist**

- [x] Inspect current telemetry types and Trello work; document existing fields and gaps instead of assuming unavailable data.
- [x] Specify driver token ownership, event/trip IDs, start/completion/cancellation, UTC event time versus receipt time, game version, source IDs, units, locale, and completeness.
- [x] Define durable acknowledgement, retryable/permanent errors, payload limits, version compatibility, and delayed/out-of-order event behavior.
- [x] Provide sanitized examples and a client/server acceptance checklist; explicitly exclude per-second upload and server-to-client history restore.

**Validation:** Review fixtures for offline replay, account/token change, completion-before-start, and partial recording with the telemetry maintainer.

**Boundaries / integration gates:** Implementation in the telemetry repository is VTC-024. Existing ET cards must be reconciled rather than duplicated blindly.

<a id="vtc-004"></a>

### [VTC-004] Verify the existing host and select a portable deployment approach

- **Track:** Discovery
- **Depends on:** None
- **Primary ownership:** docs/research/hosting.md, docs/decisions/hosting.md

**Goal:** Determine whether the proposed stack can run within approximately $35 per year on the current hosting.

**Scope and acceptance checklist**

- [ ] Verify full annual/renewal cost and included services against the owner-approved approximately USD 35/year budget; keep account-specific terms and raw evidence outside the public repository.
- [ ] Prove compatibility with a new MySQL 8.0 database and Node.js 24 using authorized account access; keep actual version/inventory evidence private and preserve existing websites/databases.
- [ ] Verify the exact MySQL server version, InnoDB, SQL modes, collations, connection limits, database size/backup limits, and migration privileges; confirm Node.js actual runtime, security patch/update policy for both products, and an upgrade path if the offered release line lacks appropriate maintenance.
- [ ] Verify Hostland's documented Node.js deployment on the actual account, including Fastify/server.js compatibility, Passenger process behavior, build artifacts, persistent storage, SSH/deployment access, TLS, cron, SSE/proxy limits, and outbound email API access.
- [ ] If persistent workers/SSE are unsupported, specify bounded cron jobs/authenticated polling and their latency; if the selected MySQL/Node.js combination cannot run reliably within budget, record a concrete blocker and seek a hosting decision before implementation.
- [ ] Select a temporary development environment separately; record any spending approval, expiry/sleep limits, backup/export procedure, and a reproducible launch method without assuming Docker is supported.

**Validation:** Produce a provider capability matrix and, when access is available, a minimal runtime/database/background-task proof. If details remain unknown, mark the production decision blocked and avoid claiming compatibility.

**Boundaries / integration gates:** The previous $15–25/month production proposal is superseded. A paid development service requires an explicit budget decision; no hosting purchase is authorized by this card.

<a id="vtc-005"></a>

### [VTC-005] Define architecture, module ownership, and API contracts

- **Track:** Architecture
- **Depends on:** VTC-001, VTC-002, VTC-003, VTC-004
- **Primary ownership:** docs/architecture/, docs/contracts/dashboard/, docs/decisions/stack.md

**Goal:** Freeze enough interfaces for independent frontend and backend work.

**Scope and acceptance checklist**

- [ ] Record React/TypeScript/Fastify with owner-selected MySQL in a modular monolith; baseline Node.js 24 and MySQL 8.0, then pin compatible library/driver versions after the host proof.
- [ ] Specify Drizzle's MySQL dialect/mysql2 driver, Better Auth adapter compatibility, transaction boundaries, unique-key semantics, UTC/ID handling, and job claim strategy; avoid PostgreSQL-only SQL, extensions, partial indexes, and notification mechanisms.
- [ ] Define module boundaries, IDs, units, UTC timestamps, statuses, permissions, pagination, errors, and versioned domain events.
- [ ] Specify endpoints and example responses for auth/admissions, catalogs, trips/review, qualifications, analytics, events/RSVP, notifications, and admin.
- [ ] Define blob storage, email, catalog source, and trip source interfaces; document schema/migration ownership and compatibility rules.

**Validation:** Check each planned UI against a contract example, including loading/empty/error/forbidden cases. Review trip status transitions and the dependency graph.

**Boundaries / integration gates:** Only this card establishes cross-module interfaces; later changes need an additive contract PR and consumer notification.

<a id="vtc-006"></a>

### [VTC-006] Bootstrap the repository and local development environment

- **Track:** Foundation
- **Depends on:** VTC-005
- **Primary ownership:** root tooling, apps/api/, apps/web/, packages/, CONTRIBUTING.md, AGENTS.md

**Goal:** Provide a reproducible workspace and English contributor instructions.

**Scope and acceptance checklist**

- [ ] Set up the chosen runtime/package manager with pinned versions, workspace layout, formatting, linting, and TypeScript checks.
- [ ] Create API/web entry points, health/readiness routes, validated environment configuration, and an example environment file without secrets.
- [ ] Document local startup with a real MySQL 8.0 database, fixtures, commands, module ownership, and one-card-per-branch workflow. Pin Node.js 24 and a verified MySQL patch/configuration; expose the same settings to CI and deployment tooling.
- [ ] Keep production build/start commands portable; provide an optional container build without making Docker a host requirement.

**Validation:** A clean checkout installs, starts locally, builds, and serves its health endpoint using the documented commands.

<a id="vtc-007"></a>

### [VTC-007] Create database, migration, and audit foundations

- **Track:** Foundation
- **Depends on:** VTC-006
- **Primary ownership:** packages/db/core/, packages/db/migrations/ (migration owner)

**Goal:** Establish safe persistence conventions without prebuilding every feature schema.

**Scope and acceptance checklist**

- [ ] Set up Drizzle/mysql2 with a bounded pool, InnoDB tables, explicit foreign/unique keys, documented isolation/SQL modes, UTC sessions, lossless ID/decimal handling, and test-only seed separation.
- [ ] Define utf8mb4 label storage and explicit byte-exact opaque identifier/hash storage or an equivalently tested comparison strategy; test case, accents, and trailing spaces rather than inheriting database defaults.
- [ ] Provide organization/user reference conventions and audit primitives with actor, operation, subject, time, and reason.
- [ ] Document forward-compatible migrations, indexes/constraints, and a single migration integration owner. Run migrations on a dedicated connection with no competing deploy; account for implicit DDL commits and recovery from partial schema changes.
- [ ] Ensure secrets, passwords, tokens, and unnecessary private payloads are excluded from audit records.

**Validation:** On real target-compatible MySQL, migrate an empty database and a previous fixture schema; verify failed DML transaction rollback, duplicate-key/foreign-key rejection, exact IDs, UTC round-trips, and useful audit records. Separately rehearse recovery from a failed migration; do not claim DDL rollback based on DML tests.

<a id="vtc-008"></a>

### [VTC-008] Set up unit, database integration, contract, and browser test tooling

- **Track:** Quality
- **Depends on:** VTC-006, VTC-007
- **Primary ownership:** test/support/, test/fixtures/, test/e2e/support/, test configuration

**Goal:** Make meaningful tests easy for each feature owner to add.

**Scope and acceptance checklist**

- [ ] Configure Vitest and isolated real MySQL 8.0 integration tests, with deterministic clocks and fixture builders; align patch, SQL modes, collation, timezone, and isolation with the verified target. Do not substitute SQLite/MariaDB for these tests.
- [ ] Provide concurrent-connection helpers for duplicate ingestion, job leases, deadlock retries, and transaction rollback; include migrations from an empty and prior fixture schema.
- [ ] Provide telemetry contract fixtures, local mail/blob fakes, and mocked external identity/provider adapters.
- [ ] Configure Playwright with a fresh test database and one real app smoke flow; document desktop/mobile viewport runs.
- [ ] Prevent tests from contacting production services, sending real email, or sharing mutable database state.

**Validation:** Run all test layers locally, including a deliberately failing assertion to verify non-zero failure reporting.

**Boundaries / integration gates:** Feature tests belong in their feature cards; VTC-040 adds cross-module journeys, not all testing at the end.

<a id="vtc-009"></a>

### [VTC-009] Configure pull request CI and required test checks

- **Track:** Quality
- **Depends on:** VTC-008
- **Primary ownership:** .github/workflows/ci.yml, docs/development/ci.md

**Goal:** Run repeatable quality gates for every pull request and protected-branch change.

**Scope and acceptance checklist**

- [ ] Add lint/format/type/build checks, unit tests, real-MySQL integration/contract tests, and a small Playwright smoke suite against MySQL.
- [ ] Pin Node.js 24 and the verified MySQL 8.0 image version/digest, configure database readiness and target SQL settings, and apply migrations before tests. Check the actual host Node.js patch as well if the primary CI patch differs; document intentional differences instead of using floating latest tags.
- [ ] Use clean dependencies, isolated databases, stable check names, timeouts, cancellation of obsolete runs, and failure artifacts.
- [ ] Run untrusted PR code without deployment credentials; give workflow tokens minimum permissions and pin action revisions.
- [ ] Keep a required aggregate result from silently passing skipped or failed critical jobs; publish diagnostic reports without secrets.

**Validation:** Exercise a passing PR and intentional unit/integration/E2E failures; each required failure must block the gate and expose useful logs.

<a id="vtc-010"></a>

### [VTC-010] Configure code review, repository rules, and dependency hygiene

- **Track:** Quality
- **Depends on:** VTC-006, VTC-009
- **Primary ownership:** .github/CODEOWNERS, .github/pull_request_template.md, .github/dependabot.yml, docs/development/review.md

**Goal:** Make reviews and merge protection explicit for humans and coding agents.

**Scope and acceptance checklist**

- [ ] Define review ownership, PR template with card ID/behavior/validation, protected main branch, required CI, and resolved review conversations.
- [ ] Select an available automated code-review integration with the owner; record permissions and cost, and test it on a seeded defect.
- [ ] Require independent review for auth, migrations, rules, deduplication, and deployment changes; an author must not self-approve a critical change.
- [ ] Set up dependency update checks and document exception handling; configure repository rules when access allows, otherwise provide exact setup steps and mark setup pending.

**Validation:** Demonstrate that failing checks prevent merge and a review finding is surfaced. Verify account/repository plan limitations and a solo-maintainer review path.

**Boundaries / integration gates:** Do not choose a paid review service or require an unavailable second human without an explicit decision. AI review supplements tests and maintainer responsibility.

<a id="vtc-011"></a>

### [VTC-011] Deploy an early development environment

- **Track:** Delivery
- **Depends on:** VTC-004, VTC-006, VTC-007, VTC-009
- **Primary ownership:** deploy/development/, .github/workflows/deploy-development.yml, docs/operations/development.md

**Goal:** Get a reviewable deployment early while keeping development costs separate from production.

**Scope and acceptance checklist**

- [ ] Deploy the chosen temporary environment with HTTPS, MySQL 8.0 and Node.js 24 compatible with the production target, persistent database/blob storage or explicitly disposable fixtures, and separate test credentials. A free PostgreSQL service is not a substitute for the selected database.
- [ ] Deploy only the exact revision that passed CI; use native Git integration or one deployment workflow, not competing triggers.
- [ ] Document database migrations, health checks, logs, export/restore, and redeployment from a clean environment.
- [ ] Document free-tier sleep/expiry effects on webhook delivery, SSE, and reminders; avoid uploading real user data into disposable environments.

**Validation:** Publish a small change after successful CI, reject a failed build, and verify data retention or documented reset behavior after restart.

**Boundaries / integration gates:** Until a development budget is approved, use a suitable free option or local preview. Local preview does not count as a completed remote-deployment card.

<a id="vtc-012"></a>

### [VTC-012] Build the responsive UI foundation and localization

- **Track:** Frontend
- **Depends on:** VTC-005, VTC-006
- **Primary ownership:** apps/web/src/app/, apps/web/src/shared/ui/, apps/web/src/i18n/core/

**Goal:** Give all feature agents a consistent, accessible RU/EN interface foundation.

**Scope and acceptance checklist**

- [ ] Create shadcn-based navigation, public/authenticated layouts, forms, tables/cards, dialogs, charts conventions, and design tokens.
- [ ] Implement language selection, localized dates/numbers/units, timezone display, and translation fallback.
- [ ] Provide accessible loading/empty/error/forbidden states and keyboard/focus behavior.
- [ ] Establish feature-scoped translation files and typed mock API responses so frontend development does not wait for every backend.

**Validation:** Review representative screens at phone/tablet/desktop sizes and with keyboard navigation; test locale switching without changing entity identifiers.

**Boundaries / integration gates:** Design is developed here and in feature cards; no complete visual mockup exists yet.

<a id="vtc-013"></a>

### [VTC-013] Implement account authentication, sessions, and server-side permissions

- **Track:** Backend
- **Depends on:** VTC-005, VTC-007, VTC-008
- **Primary ownership:** apps/api/src/modules/identity/, packages/db/schema/identity/

**Goal:** Secure account access and multi-role authorization.

**Scope and acceptance checklist**

- [ ] Implement email/password authentication, session lifecycle, password reset contracts, and no unrestricted signup; configure Better Auth's Drizzle adapter for MySQL and review its generated schema/migrations through the shared migration owner.
- [ ] Implement the five additive roles and approved permission matrix: deputy parity with director except succession/protected director-account changes, plus the universal prohibition on approving one's own manual report.
- [ ] Provide exactly-one-director bootstrap/protection, atomic director-only succession with a ten-minute one-time email code bound to the successor, and director-only email/login changes confirmed via the current verified email. Deactivate/reinstate ordinary accounts without losing history; keep revoked sessions/tokens invalid.
- [ ] Apply rate limits, safe cookies, CSRF/origin protections as appropriate, and non-enumerating authentication errors.

**Validation:** Test unauthorized/forbidden requests, combined roles, reset expiry/reuse, deactivated accounts, and session revocation using real API/database integration tests.

<a id="vtc-014"></a>

### [VTC-014] Implement transactional email and invitation delivery

- **Track:** Backend
- **Depends on:** VTC-013, VTC-021
- **Primary ownership:** apps/api/src/modules/messaging/, docs/operations/email.md

**Goal:** Send account emails reliably without coupling domain logic to one provider.

**Scope and acceptance checklist**

- [ ] Implement a mail adapter, RU/EN invitation/password-reset/application-rejection templates, director leadership-transfer verification codes, and local test delivery.
- [ ] Queue sends with retry limits and idempotency; expose failures and resend operations to authorized staff.
- [ ] Configure verified sender/DNS when credentials are available; record quotas and costs without purchasing an unapproved plan.
- [ ] Keep passwords and invite/reset secrets out of logs; do not use email for routine trip notifications in MVP.

**Validation:** Verify delivery through a test recipient, expired/replaced invite behavior, provider failure/retry, and quota exhaustion handling.

<a id="vtc-015"></a>

### [VTC-015] Implement application review and invitation onboarding APIs

- **Track:** Backend
- **Depends on:** VTC-013, VTC-014
- **Primary ownership:** apps/api/src/modules/admissions/, packages/db/schema/admissions/

**Goal:** Turn a public application into exactly one company membership.

**Scope and acceptance checklist**

- [ ] Require nickname, invitation email, Steam profile link, and ETS2/ATS selection; Discord and introduction are optional. Validate inputs and apply abuse controls.
- [ ] Allow director/deputy review, require an emailed rejection reason, preserve decision history, and allow reapplication.
- [ ] Acceptance issues a seven-day single-use invitation, with email delivery and staff copy-link delivery independent of mail success; reissuing invalidates the old link. Redemption creates the trainee account/membership.
- [ ] Handle duplicate submissions, concurrent acceptance, resend invalidation, and existing email identities without bypassing review.

**Validation:** Run the full application-to-account flow plus repeated acceptance/redemption, expiry, and insufficient-permission cases.

**Boundaries / integration gates:** Invitation lifetime and rejected-application retention follow VTC-001.

<a id="vtc-016"></a>

### [VTC-016] Build the public landing and application experience

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/landing/, apps/web/src/features/admissions/

**Goal:** Let prospective drivers learn about the VTC and apply from any device.

**Scope and acceptance checklist**

- [ ] Build the RU/EN landing with company information, requirements, contacts, and links to public events and login.
- [ ] Implement application form validation, submission feedback, accessibility, and duplicate/retry states.
- [ ] Make public content indexable with appropriate metadata and keep private account/application data out of rendered public pages.
- [ ] Use contract mocks during development; integrate the real admissions endpoint before completing the card.

**Validation:** Verify phone/desktop flows and RU/EN form errors; run a submission against VTC-015 in the integration environment.

**Boundaries / integration gates:** Integration gate: VTC-015. Public event content is delivered by VTC-035.

<a id="vtc-017"></a>

### [VTC-017] Build login, invitation, recovery, and account settings screens

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/account/

**Goal:** Provide the complete account lifecycle UI.

**Scope and acceptance checklist**

- [ ] Build login, invitation redemption, password recovery/reset, logout, and expired-link states.
- [ ] Implement language/account preferences, session expiry handling, and member-facing connection status.
- [ ] Respect permission-driven navigation while relying on server authorization.
- [ ] Use contract mocks first and connect real identity/admissions endpoints before completion.

**Validation:** Exercise valid/invalid/expired links, inactive accounts, RU/EN errors, and keyboard/mobile navigation.

**Boundaries / integration gates:** Integration gates: VTC-013 and VTC-015. Identity linking endpoints come from VTC-018; telemetry token UI belongs to VTC-038.

<a id="vtc-018"></a>

### [VTC-018] Link Steam and resolve TruckersMP identities

- **Track:** Backend
- **Depends on:** VTC-013
- **Primary ownership:** apps/api/src/modules/external-identities/, packages/db/schema/external-identities/

**Goal:** Identify a driver consistently across telemetry and future providers.

**Scope and acceptance checklist**

- [ ] Implement verified Steam account linkage while retaining email/password login.
- [ ] Store stable external IDs and prevent one external identity from being silently attached to multiple users. Steam replacement is director/deputy-only on request, audited, and revokes telemetry tokens without changing historical local trip ownership.
- [ ] Fetch basic TruckersMP profile and VTC-membership data with caching and explicit unavailable/stale states.
- [ ] Do not make provider downtime remove a valid local membership; exclude automatic disciplinary actions.

**Validation:** Test linkage/relink conflicts and mocked provider failures; verify a real linkage using an authorized test account.

<a id="vtc-019"></a>

### [VTC-019] Implement versioned catalogs, imports, and identity normalization

- **Track:** Backend
- **Depends on:** VTC-002, VTC-007, VTC-008
- **Primary ownership:** apps/api/src/modules/catalogs/, packages/db/schema/catalogs/, scripts/catalogs/

**Goal:** Serve local game catalogs and resolve provider entities independently of display language.

**Scope and acceptance checklist**

- [ ] Import reviewed datasets for both base games and all official DLCs at the pinned launch baseline, with per-pack contribution/coverage evidence, provenance, game build, DLC/map scope, localized labels, aliases, external mappings, and publication status. Missing local packs remain coverage gaps, not exclusions from the approved scope.
- [ ] Resolve the Louisiana, Illinois and South Dakota source gaps transferred from VTC-002; record permitted-use evidence and validate their catalog contributions before production publication or launch.
- [ ] Provide search/filter APIs and draft-diff-publish workflow with transactional publication and audit records.
- [ ] Preserve retired entities and historical versions; separate canonical identity from version-specific attributes.
- [ ] Resolve known source IDs first; handle name-only matching using game/region/locale context and surface unknown/ambiguous entities for review.
- [ ] Enforce scoped unique source-ID mappings with exact MySQL comparison semantics; keep localized label search and normalized aliases separate from identity lookup, including case/accent/trailing-space fixtures.

**Validation:** Test RU/EN aliases, identical city names in different regions/maps, missing translations, DLC additions, retirement, failed import, and publication during concurrent reads.

**Boundaries / integration gates:** Actual shipment mass must never be inferred from cargo unit mass; provider coordinates are not assumed to be geographic latitude/longitude.

**VTC-002 hand-off:** Resolve the unavailable Louisiana, Illinois and South Dakota sources before launch; retain all official DLCs in scope. Refresh the [observed inventory](../research/dlc-coverage-2026-10-17.md) for the actual launch baseline, validate active registry/include/overlay behavior, record permitted metadata use/attribution, and prepare reviewed English labels plus the Russian translation queue. The technical maintainer prepares updates; director/deputy publishes. See [source questions and acceptance gates](../research/catalog-source-follow-up.md). Discovery's archive audit is not production catalog completeness.

<a id="vtc-020"></a>

### [VTC-020] Build catalog administration and localized selectors

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/catalogs/, apps/web/src/shared/catalog-selectors/

**Goal:** Give forms reusable entity selectors and directors a controlled update interface.

**Scope and acceptance checklist**

- [ ] Build searchable game/region-aware selectors that submit IDs and display project-reviewed RU/EN labels; visibly fall back to the English label when Russian is missing, without changing identity or creating a matching alias.
- [ ] Show import status, added/changed/retired entries, mapping exceptions, and publication confirmation.
- [ ] Support staff resolution of missing/ambiguous entities without silently creating trusted catalog data from user input.
- [ ] Keep editing of catalog facts separate from qualification permissions.

**Validation:** Verify a language switch preserves selected IDs and that a retired historical value remains readable; integrate against VTC-019.

**Boundaries / integration gates:** Integration gate: VTC-019. Consumers coordinate selector changes rather than editing shared components independently.

**Catalog publication policy:** The Director or Deputy Director reviews/publishes a maintainer-prepared revision. This is not a new application role. Missing Russian labels visibly use reviewed English names; source tokens remain diagnostics rather than finished English labels.

<a id="vtc-021"></a>

### [VTC-021] Implement durable jobs and transactional domain events

- **Track:** Backend
- **Depends on:** VTC-005, VTC-007, VTC-008
- **Primary ownership:** apps/api/src/platform/jobs/, apps/api/src/platform/outbox/

**Goal:** Make retries, reminders, and notifications survive process restarts.

**Scope and acceptance checklist**

- [ ] Persist domain events in the same MySQL/InnoDB transaction and connection as domain state changes and provide versioned event envelopes.
- [ ] Implement transactional job claims/leases, retry/backoff, idempotency, failure inspection, and duplicate-worker protection. Verify FOR UPDATE SKIP LOCKED on the target MySQL version or document an atomic alternative; commit the lease before doing network work and guard completion with the lease token.
- [ ] Define indexes, bounded batches/pool size, deadlock retry behavior, and unique consumer-effect keys; duplicate delivery must remain safe after lease expiry or process restart.
- [ ] Support the host-approved execution model: an in-process/independent runner when persistent execution is verified, or bounded cron invocations with overlapping runs protected by leases and an explicit latency bound.
- [ ] Document time handling, shutdown/restart behavior, and recovery of expired leases.

**Validation:** Crash/restart between commit and processing, run two consumers, and verify no lost work or duplicated business effect.

**Boundaries / integration gates:** Requires persistent execution or a compatible scheduler on the chosen host; sleeping development hosting cannot guarantee timely reminders.

<a id="vtc-022"></a>

### [VTC-022] Implement canonical trip records and source adapter boundaries

- **Track:** Backend
- **Depends on:** VTC-003, VTC-007, VTC-019, VTC-021
- **Primary ownership:** apps/api/src/modules/trips/, apps/api/src/modules/sources/contracts/, packages/db/schema/trips/

**Goal:** Represent one company trip with multiple original source records.

**Scope and acceptance checklist**

- [ ] Persist immutable source messages with retention controls and normalized facts/provenance alongside canonical trip records.
- [ ] Separate game lifecycle, company acceptance, recording completeness, and source connection states.
- [ ] Define adapters for own telemetry and manual reports, plus a provider-independent interface for future webhooks.
- [ ] Provide authorized list/detail APIs, normalized metric units, unknown-entity flags, and versioned update events.

**Validation:** Test out-of-order lifecycle input, incomplete records, conflicting values, source retention boundaries, and authorization of trip details.

**Boundaries / integration gates:** Do not add provider metrics together or emit accepted-trip events merely because a raw message arrived.

<a id="vtc-023"></a>

### [VTC-023] Implement personal telemetry tokens and durable ingestion

- **Track:** Backend
- **Depends on:** VTC-013, VTC-018, VTC-022
- **Primary ownership:** apps/api/src/modules/telemetry/, packages/db/schema/telemetry/

**Goal:** Accept authenticated trip events from the desktop application safely and idempotently.

**Scope and acceptance checklist**

- [ ] Issue scoped personal tokens only to eligible linked members; display once, store hashes, and support revoke/rotate/last-used.
- [ ] Derive user ownership from authentication, validate versioned payloads, bound request sizes/rates, and reject unsupported versions clearly.
- [ ] Acknowledge only after durable storage; enforce non-null scoped source/event identity uniqueness using MySQL unique keys and a transaction, including duplicate-key races. Do not use check-then-insert as the only guard or acknowledge before commit.
- [ ] Handle start/completion/cancellation and offline delivery without fabricating live activity or double-emitting transitions.

**Validation:** Test forged ownership, revoked tokens, malformed/oversized input, duplicate concurrent requests, restart after acknowledgement, and completion-before-start.

<a id="vtc-024"></a>

### [VTC-024] Implement and verify the desktop telemetry upload integration

- **Track:** External
- **Depends on:** VTC-003, VTC-023
- **Primary ownership:** senukartur/ets2telemetry (external repository); docs/integrations/telemetry-verification.md here

**Goal:** Complete the client half of the dashboard integration and prove it against real gameplay.

**VTC-003 hand-off:** Automatically synchronize every retained local game trip on first connection, then new/changed trips, including partial/cancelled/closed records. Prove bounded resumable enumeration, overlap with ongoing recording, stable identities/revisions, immutable owner/identity-epoch binding and full-queue drain/resume. Do not silently reassign old history on token/account change. Implement the [agreed contract](../contracts/telemetry-v1.md), including native money/mode invariants; the real-game recording gate must be cleared in the telemetry project. This expands initial upload, not VTC-110's later server-to-client restore. Contract agreement is not real-client acceptance.

**Scope and acceptance checklist**

- [ ] Coordinate with existing telemetry cards; implement start/end summary upload using the agreed contract and personal token.
- [ ] Persist an offline retry queue, handle durable acknowledgements/permanent errors, and retain stable event/trip IDs.
- [ ] Prevent queued data from being reassigned to another driver after account/token changes; avoid sensitive token logging.
- [ ] Capture representative ETS2 and ATS recordings including partial recording and unavailable fields, and feed sanitized fixtures back to dashboard tests.

**Validation:** Drive a test trip, disconnect/reconnect, restart the client, replay the queue, and verify one canonical trip and correct owner.

**Boundaries / integration gates:** Do not implement desktop code inside this repository. Link the external PR/card and verification evidence; dashboard MVP release depends on this work.

<a id="vtc-025"></a>

### [VTC-025] Implement manual report submission and evidence storage

- **Track:** Backend
- **Depends on:** VTC-013, VTC-022
- **Primary ownership:** apps/api/src/modules/manual-reports/, apps/api/src/platform/blob-storage/, packages/db/schema/manual-reports/

**Goal:** Preserve role-play reporting through reviewed submissions.

**Scope and acceptance checklist**

- [ ] Require game, origin/destination cities, cargo, mass, trailer type, actual distance, and a screenshot; event/comment are optional and no trip date is collected. Support versioned pending/rejected edits and staff-managed accepted corrections with recalculation and no self-approval.
- [ ] Use canonical catalog IDs; allow clearly marked unresolved values to enter review rather than auto-approval.
- [ ] Store screenshots through a portable authorized blob adapter with tested limits/type checks; retain images at least one year after the latest decision and throughout any review. Image expiry must preserve structured trip data and decision history.
- [ ] Support attaching a manual report to an existing telemetry trip; retain submitted values and edit history.

**Validation:** Test duplicate submission, unauthorized evidence access, invalid uploads, interrupted upload cleanup, and correction after submission.

**Boundaries / integration gates:** Follow approved VTC-001 evidence, source-specific timing, and self-approval policies; no production files on ephemeral app storage.

<a id="vtc-026"></a>

### [VTC-026] Implement deduplication and reversible reconciliation

- **Track:** Backend
- **Depends on:** VTC-022, VTC-025
- **Primary ownership:** apps/api/src/modules/reconciliation/, packages/db/schema/reconciliation/

**Goal:** Count a journey once while preserving every source and the reasons for matching.

**Scope and acceptance checklist**

- [ ] Implement exact replay/origin-ID matching and a configurable candidate matcher using verified driver, game, actual times, route, cargo, and comparable distance.
- [ ] Auto-link only a unique high-confidence candidate; do not merge distinct same-source trips or ambiguous/identity-missing records.
- [ ] Implement audited merge/unmerge, field-level provenance, and quality-aware source selection without summing metrics.
- [ ] Version match rules and emit correction events so downstream acceptance/progress/statistics can recompute safely.
- [ ] Serialize conflicting canonical-trip updates using MySQL row locks or optimistic versions and scoped unique source links; retry bounded transaction conflicts and atomically record correction events. Test both concurrent match and merge/unmerge races.

**Validation:** Test manual-plus-telemetry duplicates, different-language names, repeated same-route trips, overlapping candidates, delayed reports, concurrent matches, and unmerge.

**Boundaries / integration gates:** Calibrate MVP matching on own/manual data. Trucky/VTCBase production thresholds are deferred to VTC-103; do not claim they are validated yet.

<a id="vtc-027"></a>

### [VTC-027] Implement the extensible qualification rule evaluator

- **Track:** Backend
- **Depends on:** VTC-001, VTC-019, VTC-008
- **Primary ownership:** apps/api/src/modules/qualification-rules/, test/fixtures/qualification-rules/

**Goal:** Evaluate typed, versioned qualification rules with explainable outcomes.

**Scope and acceptance checklist**

- [ ] Support initial approved limits for actual cargo mass, allowed body/chain types, and other approved MVP fields with reliable data.
- [ ] Separate company acceptance rules from qualification-progress conditions and event-specific exception rules.
- [ ] Return pass/fail/insufficient-data with rule IDs, observed values, expected limits, and localizable reason codes.
- [ ] Validate rule configuration and provide a registry for new rule types; no arbitrary executable admin expressions.

**Validation:** Test boundary values, kg/ton conversion, missing data, unsupported trailer type, ADR mapping, locale independence, and approved exception precedence.

**Boundaries / integration gates:** New rule types may require code and additional source fields. Unknown data must not be treated as proof of a violation.

<a id="vtc-028"></a>

### [VTC-028] Implement qualification configuration, assignment history, and progress

- **Track:** Backend
- **Depends on:** VTC-013, VTC-021, VTC-027
- **Primary ownership:** apps/api/src/modules/qualifications/, packages/db/schema/qualifications/

**Goal:** Track independent ETS2/ATS qualifications and reproducible progress.

**Scope and acceptance checklist**

- [ ] Provide audited admin APIs for levels, rule-set versions, publication/effective dates, and per-game driver assignments.
- [ ] Use trip-start qualification/rules and progress assignment for telemetry; use confirmation-time qualification/rules and current-level progress for undated manual reports. Preserve per-game assignment and rule history.
- [ ] Update progress once per eligible accepted trip; reverse/recompute it after merge, rejection, or correction.
- [ ] Implement Trainee → III → II → I progression using accepted-trip count and actual distance since current-level assignment, with director/deputy confirmation. Passing either game's trainee stage grants global Driver membership while preserving other roles and the other game's qualification. Recalculate corrections, alert administrators, and never automatically demote.

**Validation:** Test qualification changes during a trip, late delivery of events, rule publication, replayed progress events, and revoked acceptance.

**Boundaries / integration gates:** Detailed automatic downgrades, recurring recertification, rating formulas, and visa rules remain outside MVP.

<a id="vtc-029"></a>

### [VTC-029] Implement acceptance orchestration and dispatcher review

- **Track:** Backend
- **Depends on:** VTC-023, VTC-025, VTC-026, VTC-028, VTC-034
- **Primary ownership:** apps/api/src/modules/trip-decisions/, packages/db/schema/trip-decisions/

**Goal:** Apply one decision pipeline to every canonical trip.

**Scope and acceptance checklist**

- [ ] Automatically accept sufficiently supported telemetry trips that pass rules; reject proven violations with reasons; route uncertain records to review.
- [ ] Keep manual-only reports pending human review even when rule checks pass. If late telemetry would change a confirmed decision, reporting period, or progress, retain the confirmed result until dispatcher/deputy/director review; keep one canonical trip.
- [ ] Provide dispatcher accept/reject and authorized override/correction with a required explanation, concurrency protection, and audit history.
- [ ] Persist decision transitions and outbox events atomically; downstream progress/analytics change exactly once.

**Validation:** Test a manual report approved while telemetry arrives, two dispatchers acting concurrently, changed normalized facts, override, merge/unmerge, and stale decision attempts.

**Boundaries / integration gates:** Staff overrides must not silently rewrite source evidence; the owner-approved policy controls whether and how a violation can be overridden.

<a id="vtc-030"></a>

### [VTC-030] Build trip lists, manual forms, details, and review workspace

- **Track:** Frontend
- **Depends on:** VTC-012, VTC-020
- **Primary ownership:** apps/web/src/features/trips/, apps/web/src/features/manual-reports/, apps/web/src/features/review/

**Goal:** Expose the complete driver and dispatcher trip workflow.

**Scope and acceptance checklist**

- [ ] Build responsive filterable trip lists/details showing lifecycle, acceptance, sources, completeness, normalized values, and reason history.
- [ ] Implement manual report drafts, evidence upload, submit/correct flows, and attachment to an existing trip.
- [ ] Build dispatcher queue, decision/override actions, and reconciliation review with a clear merge/unmerge explanation.
- [ ] Use permission-aware views, RU/EN labels, safe retry/conflict handling, and catalog selectors that submit IDs.

**Validation:** Verify representative mobile and desktop flows against VTC-025, VTC-026, and VTC-029, including unresolved cargo and duplicate reports.

**Boundaries / integration gates:** Integration gates: VTC-025, VTC-026, VTC-029. Split this card into UI subcards if implementation exceeds one coherent reviewable PR.

<a id="vtc-031"></a>

### [VTC-031] Build qualification and rule administration screens

- **Track:** Frontend
- **Depends on:** VTC-012, VTC-020
- **Primary ownership:** apps/web/src/features/qualifications/

**Goal:** Show drivers their limits and let authorized staff publish controlled changes.

**Scope and acceptance checklist**

- [ ] Display per-game qualification, allowed work, progress, and requirements for promotion.
- [ ] Build level/rule editors using supported typed conditions, validation, draft preview, and effective dates.
- [ ] Expose assignment/promotion actions and audit history; distinguish a role change from a qualification change.
- [ ] Preview why sample trips pass/fail before publishing rules, without changing historical decisions automatically.

**Validation:** Verify RU/EN reason rendering, boundary validation, per-game independence, unauthorized access, and integration with VTC-028.

**Boundaries / integration gates:** Integration gate: VTC-028.

<a id="vtc-032"></a>

### [VTC-032] Implement company and driver analytics APIs

- **Track:** Backend
- **Depends on:** VTC-029
- **Primary ownership:** apps/api/src/modules/analytics/

**Goal:** Produce consistent statistics from accepted unique trips.

**Scope and acceptance checklist**

- [ ] Expose approved metrics, date/game/driver filters, time-series, and company/member summaries.
- [ ] Exclude pending/rejected/superseded trips from accepted totals while exposing separate counts where useful.
- [ ] Sum actual distance separately from planned route length. Use telemetry completion time or undated-manual confirmation time and the director/deputy-configured company reporting timezone; confirmed corrections update the affected periods.
- [ ] Ensure corrections/merges affect aggregates without adding provider totals or requiring permanent snapshots.

**Validation:** Compare API totals to a small known dataset with duplicate, rejected, corrected, cross-midnight, ETS2, and ATS trips; check query indexes.

<a id="vtc-033"></a>

### [VTC-033] Build company dashboard and driver profiles

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/dashboard/, apps/web/src/features/drivers/

**Goal:** Present company and personal performance across screen sizes.

**Scope and acceptance checklist**

- [ ] Build overview cards/charts, date/game filters, driver directory, profiles, and personal statistics.
- [ ] Show qualifications, trip links, and clearly labeled metric definitions and units.
- [ ] Provide empty/loading/error states for a new company starting at zero.
- [ ] Keep private account data out of member-visible profile responses and views.

**Validation:** Verify matching filters yield matching totals across charts/lists and test narrow-screen layouts against VTC-032.

**Boundaries / integration gates:** Integration gates: VTC-028 and VTC-032.

<a id="vtc-034"></a>

### [VTC-034] Implement events, visibility, and RSVP APIs

- **Track:** Backend
- **Depends on:** VTC-013, VTC-021
- **Primary ownership:** apps/api/src/modules/events/, packages/db/schema/events/

**Goal:** Manage convoys with explicit public/private visibility and attendance intent.

**Scope and acceptance checklist**

- [ ] Provide authorized creation/edit/cancel operations with game/server, meeting/start times, route/location, organizer, and description.
- [ ] Expose public events without private participants/reasons; provide member upcoming/past views.
- [ ] Allow voluntary attending/declined/no-response with no automatic penalties; require a decline reason private to author/director/deputies. Allow response changes until the revised start, and have administrators confirm actual attendance separately.
- [ ] Emit versioned create/update/cancel/RSVP events and provide event references for trip association and authorized rule exceptions.

**Validation:** Test public data filtering, decline reason validation, role checks, rescheduling, cancellation, timezone/DST boundaries, and duplicate RSVP requests.

<a id="vtc-035"></a>

### [VTC-035] Build event management, public listings, and participation UI

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/events/

**Goal:** Let staff organize events and drivers respond from desktop or mobile.

**Scope and acceptance checklist**

- [ ] Build public landing widgets/list/detail and authenticated upcoming/past event views.
- [ ] Add organizer forms, visibility selection, meeting/start time display, and edit/cancel feedback.
- [ ] Implement RSVP with mandatory decline explanation and permission-limited response lists.
- [ ] Provide an upcoming-event header component and links from trip forms to events.

**Validation:** Verify public visitors cannot see private events or decline reasons; complete RSVP and organizer flows against VTC-034.

**Boundaries / integration gates:** Integration gate: VTC-034; event exception linking is also verified with VTC-029.

<a id="vtc-036"></a>

### [VTC-036] Implement notification history, SSE, and event reminders

- **Track:** Backend
- **Depends on:** VTC-021, VTC-029, VTC-034
- **Primary ownership:** apps/api/src/modules/notifications/, packages/db/schema/notifications/

**Goal:** Deliver durable in-app updates without duplicate or stale live alerts.

**Scope and acceptance checklist**

- [ ] Consume canonical trip and decision events; support start/end, rejection, event updates, and the approved admin/promotion categories.
- [ ] Persist per-user notification/read state and category preferences; expose authenticated SSE with reconnect recovery.
- [ ] Schedule the one-hour reminder for attending members; invalidate/reschedule it on time changes, cancellation, or RSVP change.
- [ ] Suppress stale offline-replay toasts, enforce recipient permissions, and make retries idempotent.

**Validation:** Test two workers, SSE reconnect/session revocation, delayed trip events, cancelled/rescheduled events, preference changes, and missed reminder windows.

**Boundaries / integration gates:** No Web Push or closed-browser delivery in MVP. Do not send obsolete reminders after a long outage.

<a id="vtc-037"></a>

### [VTC-037] Build notifications UI and real-time connection behavior

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/notifications/

**Goal:** Make current activity and saved notifications usable without flooding the user.

**Scope and acceptance checklist**

- [ ] Build bell/unread count, history, read actions, category preferences, and navigable notification targets.
- [ ] Connect SSE with authenticated reconnect/fallback behavior and avoid repeated toasts after reload.
- [ ] Coordinate upcoming-event header state with the event feature.
- [ ] Handle deleted/inaccessible targets and preserve localized reason rendering.

**Validation:** Verify open-site delivery, reconnect, multiple tabs, delayed history, unread state, and RU/EN against VTC-036.

**Boundaries / integration gates:** Integration gates: VTC-035 and VTC-036.

<a id="vtc-038"></a>

### [VTC-038] Build member administration and source connection settings

- **Track:** Frontend
- **Depends on:** VTC-012
- **Primary ownership:** apps/web/src/features/admin/, apps/web/src/features/connections/

**Goal:** Expose director/deputy administration and personal telemetry setup, with serving-director-only succession.

**Scope and acceptance checklist**

- [ ] Build application review, invitation email/copy/resend states, member deactivation/reinstatement, additive role assignment, qualification/reporting settings, and audit views. Provide protected atomic leadership transfer with director-email verification; deputies cannot access succession or change the serving director's email/login credentials.
- [ ] Build personal token creation/show-once/revoke/last-used and Steam/TruckersMP linkage status.
- [ ] Document and render only implemented source connection capabilities; reserve company-owned integration settings for future adapters.
- [ ] Directors/deputies configure company-wide Trucky/VTCBase webhooks when adapters exist; drivers configure personal telemetry tokens.

**Validation:** Test permission boundaries, token display/revocation, invitation failure handling, and inactive accounts against the real APIs.

**Boundaries / integration gates:** Integration gates: VTC-013, VTC-015, VTC-018, VTC-023. No nonfunctional 'connected' controls for deferred providers.

<a id="vtc-039"></a>

### [VTC-039] Harden security, observability, retention, and recovery

- **Track:** Operations
- **Depends on:** VTC-011, VTC-029, VTC-036
- **Primary ownership:** apps/api/src/platform/observability/, docs/operations/, security configuration

**Goal:** Make failures diagnosable and protect real users before a pilot.

**Scope and acceptance checklist**

- [ ] Add structured redacted logs, request/correlation IDs, health/readiness, job failure inspection, and actionable error monitoring.
- [ ] Review auth/permission boundaries, upload handling, webhook/token abuse, CSRF/origin handling, and rate/payload limits.
- [ ] Implement approved retention/cleanup for raw messages, evidence, applications, and audit data without breaking canonical history.
- [ ] Document alert recipients, secrets rotation, incident response, backup scope, and expected restoration targets.

**Validation:** Exercise external-service failure, failed jobs, invalid uploads, unauthorized access, and recovery without leaking credentials.

**Boundaries / integration gates:** Review findings are concrete and prioritized; unresolved launch blockers must remain visible.

<a id="vtc-040"></a>

### [VTC-040] Complete cross-module E2E and failure regression coverage

- **Track:** Quality
- **Depends on:** VTC-016, VTC-017, VTC-024, VTC-030, VTC-031, VTC-033, VTC-035, VTC-037, VTC-038
- **Primary ownership:** test/e2e/journeys/, test/integration/scenarios/, docs/testing/release-matrix.md

**Goal:** Verify actual user journeys and failure boundaries beyond isolated module tests.

**Scope and acceptance checklist**

- [ ] Cover application/invite/login/link/token/upload/acceptance/statistics and manual-report/dispatcher flows.
- [ ] Cover localized identity mapping, source duplication and unmerge, rule changes, unknown DLC cargo, and reversed acceptance.
- [ ] Cover public/private events, RSVP, reminders, notification reconnect, and unauthorized access attempts.
- [ ] Run desktop and representative mobile E2E; keep a fast required PR subset and a broader scheduled/pre-release suite.

**Validation:** Use real local API/database with controlled external adapters, plus separate real-client telemetry evidence. Persist traces on failure and prohibit arbitrary retries that hide deterministic failures.

**Boundaries / integration gates:** Quality owner reviews assertions; feature owners fix their modules. These tests extend, not replace, VTC-008 and per-card tests.

<a id="vtc-041"></a>

### [VTC-041] Configure production deployment, backups, and host transfer rehearsal

- **Track:** Delivery
- **Depends on:** VTC-004, VTC-010, VTC-011, VTC-039
- **Primary ownership:** deploy/production/, .github/workflows/deploy-production.yml, docs/operations/production.md

**Goal:** Deploy reproducibly to a verified production host within the agreed annual budget.

**Scope and acceptance checklist**

- [ ] Reconfirm provider compatibility and full annual/renewal cost; if incompatible or over budget, obtain a decision instead of assuming transfer is possible.
- [ ] Configure TLS/domain, secrets, a new MySQL 8.0 database with least-privilege application access, Node.js 24, persistent evidence storage, mail sender, and the supported background/SSE execution model. Verify actual runtime/database patches and maintenance policy against VTC-004 before release.
- [ ] Deploy only a CI-verified revision/artifact, serialize migrations/deployments, run readiness/smoke checks, and document code/database rollback limitations.
- [ ] Rehearse clean installation and transfer of the new system's MySQL database and blobs using compatible dump/restore tools and target privileges. Take a consistent InnoDB snapshot without concurrent DDL, coordinate it with evidence files, and verify restored counts, constraints, migrations, and file references.
- [ ] Configure automated backups with documented retention and an independent recoverable copy within budget; verify restore and partial-migration recovery. An application artifact rollback must not be described as automatically reversing MySQL DDL.
- [ ] Document dev versus production environment ownership and teardown of temporary paid resources after successful cutover.

**Validation:** Run a failed-deploy recovery and restore drill on the target-compatible environment. Prove reminders, token ingestion, and persistent files work after restart.

**Boundaries / integration gates:** No import from the old websites. Moving newly created pilot data is an infrastructure transfer, not legacy migration. Production credentials/host access are external prerequisites.

<a id="vtc-042"></a>

### [VTC-042] Run the VTC pilot and complete the MVP release

- **Track:** Release
- **Depends on:** VTC-040, VTC-041
- **Primary ownership:** docs/releases/mvp.md, docs/user-guide/, docs/operations/launch-checklist.md

**Goal:** Validate real use before onboarding the entire company.

**Scope and acceptance checklist**

- [ ] Run a small authorized ETS2/ATS pilot covering offline uploads, manual reviews, qualification failures, and a convoy reminder.
- [ ] Check reported totals against original trips and resolve all launch-blocking defects.
- [ ] Verify all-official-DLC catalog coverage at the actual launch baseline, including closure of the Louisiana, Illinois and South Dakota source gaps assigned to VTC-019; the VTC-002 archive audit alone is not release evidence.
- [ ] Publish English maintainer documentation and user-facing RU/EN guidance for joining, tokens, reports, qualifications, and participation.
- [ ] Record actual hosting/storage/email usage against the annual budget and rehearse account bootstrap/support procedures.
- [ ] Confirm the release checklist, deploy the verified revision, and preserve rollback/backup evidence.

**Validation:** Owner signs off on the agreed scenarios with links to PRs, CI results, pilot evidence, deployed revision, and restore verification.

**Boundaries / integration gates:** Release requires all MVP cards complete, including early research decisions and UI integration gates; transitive dependencies alone are not the whole release checklist.

**Catalog release gate:** VTC-019 must resolve the three ATS source gaps recorded by VTC-002 and demonstrate coverage for all official DLCs at the actual launch baseline, along with permitted-use evidence, validated source mappings and readable English labels. VTC-002 discovery completion does not satisfy this production gate.

## 6. Deferred cards — Later

These are not MVP launch requirements. Refine scope, current provider contracts, dependencies, and acceptance evidence before moving them to Ready.

<a id="vtc-101"></a>

### [VTC-101] Connect the company-wide Trucky webhook feed

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Implement the Trucky adapter and director-owned company connection settings.

**Future acceptance checklist**

- [ ] Verify current payloads, authentication, retries, event IDs, edits/deletions, and plan/access requirements.
- [ ] Map drivers by verified external identity, expose unmatched-driver/replay diagnostics, and retain raw source records.
- [ ] Exercise start/end/cancel delivery and source conflicts; roll out automatic cross-provider matching only after VTC-103.

<a id="vtc-102"></a>

### [VTC-102] Connect the company-wide VTCBase webhook feed

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Implement VTCBase through the same source adapter boundary.

**Future acceptance checklist**

- [ ] Use the owner's confirmation that Discord-documented hooks support service integration; verify the actual contract with sample messages.
- [ ] Establish authentication, event/replay IDs, delivery timing, edits/deletions, driver mapping, and director-controlled setup/disable/rotation.
- [ ] Keep uncertain records out of automatic multi-source totals until VTC-103 validates matching.

<a id="vtc-103"></a>

### [VTC-103] Calibrate and release automatic cross-provider deduplication

- **Track:** Later
- **Depends on:** VTC-101, VTC-102

**Scope:** Validate automatic merging on real parallel recordings from all enabled sources.

**Future acceptance checklist**

- [ ] Collect sanitized same-trip and similar-but-distinct-trip examples, including name-only and missing timestamp cases.
- [ ] Version thresholds, quality precedence and conflict handling; measure false merges/splits against reviewed fixtures.
- [ ] Prove reversible merges and no double acceptance/progress/notifications; stage rollout and provide review/reprocessing controls.

<a id="vtc-104"></a>

### [VTC-104] Define and implement reputation and spendable points

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Introduce quality reputation and an independent points ledger after formulas are approved.

**Future acceptance checklist**

- [ ] Agree formulas, periods, missing-data behavior, manual-versus-telemetry evidence, and corrections.
- [ ] Create auditable idempotent accrual/reversal entries per canonical accepted trip.
- [ ] Keep spending separate from quality reputation; test merged/rejected trips and concurrent operations.

<a id="vtc-105"></a>

### [VTC-105] Implement territory visas and unlocks

- **Track:** Later
- **Depends on:** VTC-104

**Scope:** Add per-game territory access and purchases after the rules are known.

**Future acceptance checklist**

- [ ] Decide initial territories, prices, duration, refunds and whether only endpoints or actual transit matter.
- [ ] Use atomic point spending/visa grants, historical validity, and localized catalog territory IDs.
- [ ] Do not infer transit through a country from origin/destination alone; require sufficient route evidence for transit restrictions.

<a id="vtc-106"></a>

### [VTC-106] Add Web Push and optional external notification channels

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Deliver selected notifications when the dashboard is closed.

**Future acceptance checklist**

- [ ] Implement explicit opt-in, subscriptions, preference controls, expiry/revocation, and delivery retries.
- [ ] Reuse existing domain events and deduplication; agree email/Discord channels and budgets separately.

<a id="vtc-107"></a>

### [VTC-107] Add custom roles and advanced policy authoring

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Extend the fixed permission set and typed qualification conditions when concrete needs exist.

**Future acceptance checklist**

- [ ] Add role lifecycle, safe permission delegation, validation and audit without allowing privilege escalation.
- [ ] Extend supported condition types with tests and capability requirements; do not expose arbitrary code execution.

<a id="vtc-108"></a>

### [VTC-108] Extend catalogs to selected map and cargo mods

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Support named mod packs and game combinations beyond the approved base/DLC coverage.

**Future acceptance checklist**

- [ ] Record mod/load-order provenance, identifier collisions and compatibility with source adapters.
- [ ] Validate catalogs and localized matching against real modded trips; never promise support for every arbitrary mod.

<a id="vtc-109"></a>

### [VTC-109] Add contracts, company economy, and achievements

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Design additional role-play mechanics after separate product discovery.

**Future acceptance checklist**

- [ ] Specify metrics, transactions, roles and correction behavior before implementation.
- [ ] Reuse accepted canonical trips and audited events; do not award rewards multiple times on provider replay.

<a id="vtc-110"></a>

### [VTC-110] Add server-to-client telemetry history restore

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Restore a driver's recorded history to the desktop client under an explicit contract.

**Future acceptance checklist**

- [ ] Coordinate existing telemetry restore plans, ownership checks, pagination, schema compatibility and merge behavior.
- [ ] Never restore or upload one member's local history under another member's token.

<a id="vtc-111"></a>

### [VTC-111] Evaluate leave, activity quotas, and advanced qualification lifecycle

- **Track:** Later
- **Depends on:** VTC-042

**Scope:** Decide which remaining legacy workflows are worth rebuilding.

**Future acceptance checklist**

- [ ] Separately approve leave requests, mandatory attendance, recertification, demotions and disciplinary actions.
- [ ] Specify exceptions and auditability; do not inherit old-site rules automatically.

## 7. Open decisions and owners

No unanswered item below authorizes an implementation agent to invent a production rule.

| Decision | Responsible card | Needed before |
| --- | --- | --- |
| Private verification of Hostland MySQL 8.0 / Node.js 24 maintenance, execution limits, and full annual cost; publish only a sanitized compatibility conclusion | VTC-004 | Stack ADR VTC-005 and production provisioning |
| Temporary development spending limit; free/local until agreed | VTC-004 | Paid development services in VTC-011 |
| VTC-001 concept/requirements PR review and merge; product policies including director-email confirmation/protection are approved | VTC-001 | Documentation delivery completion |
| Production qualification limits and numeric promotion thresholds: configured by the director before launch; initial restriction types and correction behavior are confirmed in product policies | VTC-028, VTC-031, VTC-042 | Production configuration and launch |
| Upload format/size limits and storage implementation; manual-report fields, source-specific timing, editing, and at least one-year screenshot retention are confirmed in product policies | VTC-025, VTC-039 | Upload implementation and production capacity validation |
| Refresh the launch release inventory and close Louisiana/Illinois/South Dakota source gaps; prove all-official-DLC production coverage, permitted use and active-source validation. VTC-002 discovery hand-off and maintainer/director-deputy update ownership are approved | VTC-019, VTC-020, VTC-042 | Production import/publication and launch |
| Reliable telemetry fields, actual timestamps, partial recordings, and ownership on account switch | VTC-003 | VTC-023, VTC-024 |
| Steam ownership verification and external IDs absent from provider messages; director/deputy-only audited replacement with telemetry-token revocation is agreed | VTC-003, VTC-018 | VTC-023; later VTC-101/102 |
| Production reporting timezone value: configured by the director before launch; common company reporting boundaries and user-local event display are agreed | VTC-032, VTC-038, VTC-042 | Production configuration and launch |
| Domain/sender, blob storage, file limits, retention, backup scope and restore targets | VTC-004, VTC-039 | VTC-025, VTC-041 |
| Available review tool, account permissions, costs, and solo-maintainer review path | VTC-010 | Enforced repository rules |
| Pilot participants and final acceptance evidence | VTC-042 | Public production launch |
| Reputation formula, points, visa prices/territories and transit policy | VTC-104, VTC-105 | Deferred implementation only |

### Explicitly not included

- Legacy data migration from either existing website.
- Full Trucky/VTCBase adapters and validated three-provider automatic matching at MVP launch.
- Visas, spendable points, quality-rating formulas, company economy, contracts, achievements, live maps, or per-second server telemetry.
- Closed-browser Web Push, desktop history restore, multi-company SaaS, universal mod support, and a general-purpose executable rules editor.
- Leave, activity quotas, recertification, and disciplinary automation unless separately approved.

## 8. Requirement-to-card traceability

| Requirement | Main cards |
| --- | --- |
| Public landing, applications and invitations | VTC-014, VTC-015, VTC-016 |
| Email/password access and multi-role ACL | VTC-013, VTC-017, VTC-038 |
| Steam / basic TruckersMP linkage | VTC-018 |
| RU/EN, mobile/tablet/desktop and shadcn UI | VTC-012 and all frontend cards |
| Game catalogs, DLC updates and language-independent normalization | VTC-002, VTC-019, VTC-020 |
| Own telemetry, token lifecycle and offline retries | VTC-003, VTC-023, VTC-024 |
| Manual reporting, evidence and dispatcher acceptance | VTC-025, VTC-029, VTC-030 |
| Canonical trips, provenance, deduplication and correction | VTC-022, VTC-026, VTC-029 |
| Flexible per-game qualifications and progress | VTC-027, VTC-028, VTC-031 |
| Company/personal analytics and drivers | VTC-032, VTC-033 |
| Public/private convoys and RSVP | VTC-034, VTC-035 |
| Durable events, reminders and open-site notifications | VTC-021, VTC-036, VTC-037 |
| Director administration and company integration ownership | VTC-038; later VTC-101/102 |
| Unit, real-database integration, contract and E2E tests | VTC-008, VTC-009, VTC-040 plus feature-level validation |
| Code review and merge protection | VTC-010 |
| MySQL selected from the first schema; target Node.js 24 / MySQL 8.0 and consistent local/CI/production behavior | VTC-004, VTC-005, VTC-006, VTC-007, VTC-008, VTC-009, VTC-011, VTC-041 |
| Development deployment, target-host compatibility and production deployment | VTC-004, VTC-011, VTC-041 |
| Approximately $35/year production budget | VTC-004, VTC-041, VTC-042 |
| Security, logs, backups and release readiness | VTC-039, VTC-040, VTC-041, VTC-042 |

## 9. Research and integration references

These links are inputs for discovery, not a promise of complete data, unchanged API contracts, or free production hosting. Recheck current service terms and costs when implementing the relevant card.

- Existing production site: https://ykn-u.ru/
- Existing test site: https://test.ykn-u.ru/
- Existing qualification examples: https://ykn-u.ru/portal/qualify_driver and https://ykn-u.ru/portal/qualify_3
- UI components: https://github.com/shadcn-ui/ui
- Node.js release lifecycle: https://nodejs.org/en/about/previous-releases — use a supported LTS line and verify available patches; a host form default is not a lifecycle recommendation.
- Drizzle MySQL/mysql2 integration: https://orm.drizzle.team/docs/mysql/get-started-mysql
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- MySQL locking reads and queue considerations: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html
- MySQL implicit DDL commits: https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html
- Trucky API documentation: https://api.truckyapp.com/docs/
- Trucky city endpoints: https://api.truckyapp.com/v2/map/cities/ets2 and https://api.truckyapp.com/v2/map/cities/ats
- Trucky company API/webhooks: https://truckyapp.com/kb/vtc-hub-api-and-external-drivers-hub-integration/
- VTCBase guide: https://vtcbase.com/guia — the owner confirmed that Discord-documented webhooks can target ordinary services; payload/auth/retry behavior still requires verification.
- TruckersMP API documentation: https://github.com/TruckersMP/Docs
- SCS telemetry SDK: https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry
- SCS archive extractor: https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Extractor
- SCS cargo definitions: https://modding.scssoft.com/wiki/Documentation/Engine/Units/cargo_data
- SCS trailer/body/chain model: https://modding.scssoft.com/wiki/Games/ETS2/Modding_guides/1.32
- Example game-definition extraction project: https://github.com/AlexOQ/trucker
- Render free-service limitations: https://render.com/docs/free — services can sleep; free databases expire; application files are ephemeral.
- Resend quotas: https://resend.com/docs/knowledge-base/account-quotas-and-limits

The existing sites were inspected with member-level access; their complete administrator interfaces and internal formulas were not verified. Do not treat displayed examples or legacy rules as approved specifications for this implementation.
