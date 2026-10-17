# Agent Instructions

## Start here

Read [CONCEPT.MD](CONCEPT.MD) before planning or implementing changes. It is the authoritative project idea, approved product baseline, architecture direction, and set of acceptance scenarios. Use the [MVP backlog](docs/planning/mvp-trello-backlog.md) for card scope, dependencies, ownership, and delivery gates, and the [Trello index](docs/planning/trello-card-index.md) for task links.

Explicit user instructions take precedence over repository guidance. Resolve routine implementation choices within the authorized scope without repeatedly asking for permission. Ask about unresolved product decisions or actions outside that scope; do not invent business limits or treat unverified capabilities as facts.

## Documentation and current state

- Write all documentation and explanatory code comments intended for Git in English. Continue conversation in the user's preferred language. The product supports Russian and English; proper names and localized catalog labels may retain their original language.
- VTC-006 provides the root pnpm workspace, API/web entry points, generated browser contracts, local Docker Compose and narrow scaffold checks. Read CONTRIBUTING.md and docs/development/workspace.md for commands and measured versus pending evidence. Use pinned Node.js 24.22.0 / pnpm 12.14.0; the root TypeScript compiler is 5.9.3 for the OpenAPI generator's declared peer compatibility. Docker is the preferred local app/MySQL environment. Run pnpm check and pnpm build for affected scaffold work; real MySQL checks additionally require the running database. VTC-007 adds audit-only persistence, exact value/transaction primitives and explicit locked migrations; read docs/development/persistence.md before schema changes or synthetic db:test/db:recovery resets. VTC-009 adds [PR/main CI configuration](docs/development/ci.md) over the isolated VTC-008 runner; hosted green/red evidence and VTC-010 required-check enforcement remain separate gates. Do not claim domain/auth/company schemas, native authentication, deployment or automated review enforcement as implemented. The separate catalog/architecture spikes remain research, not the root runtime baseline.
- Advisory Claude review is disabled; read [its historical record](docs/development/review.md) for prior evidence and remaining VTC-010 gates. Historical advisory comments are not CI, independent implementation acceptance or merge protection.
- Keep approved behavior in CONCEPT.MD, execution scope in the backlog, and verified technical decisions in implementation contracts/ADRs. The approval record preserves earlier requirements links; do not create competing copies of the requirements.

## Project engineering skills

Use the [project skill registry](docs/development/agent-skills.md) to select the smallest relevant set before planning, implementing, verifying or reviewing frontend/backend/database work. Codex uses `.agents/skills/`; Claude uses `.claude/skills/` entrypoints pointing to the same canonical instructions. Read selected `SKILL.md` bodies, not only descriptions. The registry distinguishes frontend-patterns, react-patterns, react-performance, react-testing, frontend-design-direction, backend-patterns and mysql-patterns. These supplement the concept, contracts and card scope; they do not install tooling or establish implementation evidence.

For authorized subagents, include selected skill names, reasons, instruction version and readable absolute paths or full bodies in the assignment. Require children to apply/report relevant skills and request missing inputs; do not assume loaded skills are inherited. In `$deliver`/`/deliver`, use the pinned bundle specified by the registry/shared workflow, including when the task worktree predates the skills. Preserve role tool limits and delegation authorization rules.

## Public repository and confidential information

This repository is **public**. Treat committed files, reachable history, PR descriptions/comments, review annotations, attachments, CI logs, and uploaded artifacts as publicly readable.

Never commit, paste into a PR, or include in public tool/CI output:

- Passwords, API/personal telemetry tokens, webhook signing secrets, cookies, sessions, authorization headers, database connection strings containing credentials, private keys, certificates with private material, or active invitation/reset/leadership-transfer codes and links.
- Actual membership applications, private email/Discord details, driver identity mappings, private reports or decline reasons, screenshots from authenticated sections, production telemetry, raw webhook messages, database dumps, uploads, or private support conversations.
- Hosting account identifiers, account-specific billing/tariff details, balances, internal hostnames/IPs, database/user names, remote paths, account inventory, private control-panel captures, or infrastructure access information.

Public product requirements, an owner-approved project budget, intended technology major versions, public provider documentation, and established non-sensitive project references may be documented. Prefer an abstract capability or target over details copied from a signed-in account. Browser or hosting access for research is not permission to publish what it exposes.

Use synthetic fixtures with fictional identities, example.invalid addresses, and nonfunctional placeholders. Remove indirect identifiers and secret-bearing URL parameters as well as obvious names/tokens; do not assume a raw real payload is safe because its password was removed. Verify licensing/provenance before redistributing extracted game data or assets.

Keep secrets in the deployment platform's secret store or ignored local environment files. Commit only reviewed example configuration containing placeholders. Use private ignored storage outside public artifacts for authorized diagnostics; retaining a private copy must itself be necessary for the task.

The [.gitignore](.gitignore) provides accidental-add protection, not secret detection or removal of already tracked content. Before committing/pushing, inspect the exact staged files/diff for private values and accidental generated data. Check affected history when a task concerns previously published information. Keep diagnostic output limited to file names and finding categories; do not print the secret while reporting it.

If confidential material was already published, report the affected location without repeating its value. Removing a file or changing the branch tip does not guarantee removal from old commits, PR references, clones, or caches. Exposed credentials need revocation/rotation through an authorized owner workflow. Coordinate actual history cleanup; do not claim complete erasure from a text scan or rewrite someone else's work. Never force-push main; a necessary rewrite of an owned PR branch within the authorized task must use an exact force-with-lease guard.

## Product invariants

- One VTC, ETS2/ATS, responsive UI, RU/EN, no legacy data import. Own telemetry and reviewed manual reports are MVP sources; full Trucky/VTCBase adapters and visas/reputation/points/Web Push are deferred.
- Roles are additive and separate from per-game qualifications. Exactly one director; deputies have equivalent administration except protected director-account changes and leadership transfer. No role may approve its own manual report.
- Transfer leadership only through the serving director's verified-email flow, atomically, using a one-time ten-minute code bound to the successor. Protect the director's email/login channel against administrative bypass.
- Preserve one canonical trip and immutable source evidence. Replays, revisions, merges, and corrections must not duplicate trip counts, distance, progress, or notifications.
- Telemetry uses actual start for qualification/progress assignment and actual completion for analytics periods. Undated manual reports use staff-confirmation time for those decisions. Late telemetry that changes a confirmed result requires staff review.
- Accepted event trips with confirmed participation may carry the event-prescribed load outside ordinary qualification limits and count toward progress. Attendance is voluntary; private decline reasons and report evidence must stay permission-filtered.
- Keep report screenshots for at least one year after the latest decision and throughout review. Retain structured history after image expiry. Never silently shorten this policy to fit hosting limits.
- Numeric qualification limits, promotion thresholds, and the company reporting timezone are administrator-owned launch configuration. Production values must not be inferred from fixtures.

## Architecture and implementation boundaries

- MySQL is selected; use maintained Node.js 24 / MySQL 8.4 LTS for local, CI and staging. VTC-004 plans rapid testing on a separate owner-operated account, with an approved ceiling of USD 20/month; VTC-011 implements it. Hostland is the final destination after VTC-040 testing, with approximately USD 35/year and runtime/maintenance/transfer proof owned by VTC-041. Missing Hostland access does not block architecture or staging; do not claim production compatibility or silently revert to the superseded 8.0 target if final availability/cost fails. React/TypeScript, shadcn/ui, Fastify, Drizzle/mysql2, and auth/mail adapters still need local/CI compatibility checks. Do not change database engine or introduce a competing backend without an owner decision.
- Use the modular-monolith boundaries, server-side permissions, versioned contracts, canonical catalog IDs, normalized units, explicit UTC handling, and source provenance described in the concept.
- Keep display labels separate from identity. DLC/build changes, translated names, missing fields, and ambiguous catalog/provider mappings must not silently alter rule outcomes.
- Commit domain changes and outbox events together; use durable idempotent jobs and bounded retries. Verify MySQL concurrency behavior and account for implicit DDL commits during migration/recovery design.
- Do not modify the telemetry repository, legacy sites, hosting settings, live databases, DNS, accounts, or paid services merely because credentials/browser access are available. A read-only inspection remains read-only; changes require task authorization. Prepare concrete, reviewable changes before requesting any genuinely missing approval.

## Branches, collaboration, and review

- Inspect repository status before edits and preserve unrelated user changes. Work on a scoped branch and use PRs for main. A request to create a PR does not itself authorize merging or deploying it.
- Preserve stable VTC identifiers and link the card, PR, and relevant verification evidence. Product approval, implementation acceptance, review, merge, and production validation are distinct states.
- Follow the backlog's Definition of Ready/Done. Do not move a card to Done while its required review/merge/integration evidence is missing. Keep mock-only UI and prepared-but-unapplied infrastructure visibly incomplete.
- Delegate only when authorized by the user or applicable task instructions. If multiple agents are authorized, use separate branches/worktrees and bounded card ownership. Coordinate shared contracts, root tooling/lockfiles, app composition, and the migration journal through their owner.
- Obtain independent review appropriate to risk for authentication, permissions, migrations, qualifications, reconciliation, and deployment. Do not describe self-review as independent review or claim an unconfigured reviewer/check has run.
- Prefer small additive contracts and migrations. Feature owners own their module/schema files; a migration owner serializes final migration generation and integration.

## Verification and delivery

- Choose meaningful checks by the changed behavior. For documentation-only work, verify links/anchors, scenario/card identifiers, dependency integrity, staged whitespace, and public-data safety; do not invent application tests.
- Once implemented, use unit tests, contract fixtures, real target-compatible MySQL integration tests, and selected Playwright journeys as required by the cards. Cover concurrency, authorization, idempotency, historical timing, and recovery with actual failure cases.
- Do not substitute SQLite/MariaDB for MySQL integration tests, use production identities/data in fixtures, or send real mail/webhooks from tests without explicit authorized test endpoints.
- CI, automated review, secret scanning/push protection, and deployments are tracked implementation work. Review their actual configuration/status before claiming enforcement. A local privacy scan is not a guarantee that every secret is detected.
- Development/testing hosting has an approved ceiling of USD 20/month on a separate account; verify the actual total and prepare reviewable provisioning/deployment changes. Production targets approximately USD 35/year on Hostland; verify its runtime maintenance, cron/polling, storage, backups, restore and total cost in VTC-041 before final cutover. Keep optional SSE separate from required MVP delivery. No account/resource purchase or setup is performed merely by writing a plan; routine tooling decisions within an approved environment do not require repeated permission.
- Report what changed, which checks actually passed, the PR/commit, and material pending gates. Do not expose private evidence in that report.
