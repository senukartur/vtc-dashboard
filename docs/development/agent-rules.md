# Agent Rules

Detailed rules for coding agents, moved out of the always-loaded [AGENTS.md](../../AGENTS.md). Read the section that matches the work instead of the whole file. Explicit user instructions take precedence over repository guidance.

## Where to look

- Product idea and features: [CONCEPT.MD](../CONCEPT.MD). Detailed approved rules and acceptance scenarios: [product policies](../product/mvp-policies.md). Card scope, acceptance checklists, dependencies and status: the [Trello board](https://trello.com/b/NwhwurSM/vtcdashboard), which is the only card source. Primary-source links: [research references](../research/references.md).
- Commands and environment: [CONTRIBUTING.md](../CONTRIBUTING.md) and [workspace](workspace.md). Docker is the preferred local app/MySQL environment.
- Before schema changes or synthetic `db:test`/`db:recovery` resets: [persistence](persistence.md).
- CI: [ci](ci.md). Identity: [identity](identity.md). Review, rules and dependencies: [review](review.md). Engineering skills: [skill registry](agent-skills.md).
- Keep the idea and feature list in CONCEPT.MD, detailed approved rules in the product policies, execution scope in Trello cards, and verified technical decisions in implementation contracts/ADRs. Do not create competing copies of the requirements.

## Project engineering skills

Use the [project skill registry](agent-skills.md) to select the smallest relevant set before planning, implementing, verifying or reviewing frontend/backend/database work. Codex uses `.agents/skills/`; Claude uses `.claude/skills/` entrypoints pointing to the same canonical instructions. Read selected `SKILL.md` bodies, not only descriptions. Skills supplement the concept, contracts and card scope; they do not install tooling or establish implementation evidence.

For authorized subagents, include selected skill names, reasons, instruction version and readable absolute paths or full bodies in the assignment. Require children to apply/report relevant skills and request missing inputs; do not assume loaded skills are inherited. In `$deliver`/`/deliver`, use the pinned bundle specified by the registry/shared workflow. Preserve role tool limits and delegation authorization rules.

## Public repository and confidential information

This repository is **public**. Treat committed files, reachable history, PR descriptions/comments, review annotations, attachments, CI logs, and uploaded artifacts as publicly readable.

Never commit, paste into a PR, or include in public tool/CI output:

- Passwords, API/personal telemetry tokens, webhook signing secrets, cookies, sessions, authorization headers, database connection strings containing credentials, private keys, certificates with private material, or active invitation/reset/leadership-transfer codes and links.
- Actual membership applications, private email/Discord details, driver identity mappings, private reports or decline reasons, screenshots from authenticated sections, production telemetry, raw webhook messages, database dumps, uploads, or private support conversations.
- Hosting account identifiers, account-specific billing/tariff details, balances, internal hostnames/IPs, database/user names, remote paths, account inventory, private control-panel captures, or infrastructure access information.

Public product requirements, an owner-approved project budget, intended technology major versions, public provider documentation, and established non-sensitive project references may be documented. Prefer an abstract capability or target over details copied from a signed-in account. Browser or hosting access for research is not permission to publish what it exposes.

Use synthetic fixtures with fictional identities, example.invalid addresses, and nonfunctional placeholders. Remove indirect identifiers and secret-bearing URL parameters as well as obvious names/tokens; do not assume a raw real payload is safe because its password was removed. Verify licensing/provenance before redistributing extracted game data or assets.

Keep secrets in the deployment platform's secret store or ignored local environment files. Commit only reviewed example configuration containing placeholders. Use private ignored storage outside public artifacts for authorized diagnostics; retaining a private copy must itself be necessary for the task.

The [.gitignore](../../.gitignore) provides accidental-add protection, not secret detection or removal of already tracked content. Before committing/pushing, inspect the exact staged files/diff for private values and accidental generated data. Check affected history when a task concerns previously published information. Keep diagnostic output limited to file names and finding categories; do not print the secret while reporting it.

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

Not in MVP unless separately approved: legacy data migration; full Trucky/VTCBase adapters and three-provider automatic matching; visas, spendable points, quality-rating formulas, company economy, contracts, achievements, live maps or per-second server telemetry; closed-browser Web Push, desktop history restore, multi-company SaaS, universal mod support or a general-purpose executable rules editor; leave, activity quotas, recertification and disciplinary automation.

## Cards and parallel work

Board lists: Backlog → Ready → In Progress → Review → Done, plus Blocked and Later. VTC IDs are stable and independent of Trello numbering; preserve them in branches, commits, PR descriptions and cross-repository links. **Depends on** means prerequisites for implementing against stable interfaces; frontend cards may start from reviewed contract fixtures but their integration gates must pass before Done. A pending product decision, missing host capability, unavailable credential or external client work is a visible blocker with an owner. Keep one active owner per card; split oversized cards into suffixed child IDs (for example VTC-030A).

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

### Parallel agents

- Give each agent a dedicated branch/worktree and one bounded card. Never run multiple agents editing the same checkout or silently overwrite another agent's work.
- The foundation/integration owner controls root manifests, lockfiles, shared contracts, app composition/router entry points, CI, and the migration journal. Feature agents request additive changes rather than simultaneously editing these files.
- Feature agents own their module schema files. The migration owner generates/serializes the final migrations after rebasing; migration IDs and journal entries must not collide.
- Frontend agents use feature-local routes, translations, and contract mocks. Backend agents implement the same contract; neither invents a competing response shape.
- Review and merge small contract/core PRs before dependent features. Cross-cutting changes require a short coordinated integration PR. After each merge, rebase dependent branches and run their relevant integration checks.
- The telemetry client card runs in its own repository and supplies linked verification evidence here. Do not duplicate existing telemetry-board work without checking it.

## Architecture and implementation boundaries

- MySQL is selected; use maintained Node.js 24 / MySQL 8.4 LTS for local, CI and staging. VTC-004 plans rapid testing on a separate owner-operated account, with an approved ceiling of USD 20/month; VTC-011 implements it. Hostland is the final destination after VTC-040 testing, with approximately USD 35/year and runtime/maintenance/transfer proof owned by VTC-041. Missing Hostland access does not block architecture or staging; do not claim production compatibility or silently revert to the superseded 8.0 target if final availability/cost fails. Do not change database engine or introduce a competing backend without an owner decision.
- Use the modular-monolith boundaries, server-side permissions, versioned contracts, canonical catalog IDs, normalized units, explicit UTC handling, and source provenance described in the concept.
- Keep display labels separate from identity. DLC/build changes, translated names, missing fields, and ambiguous catalog/provider mappings must not silently alter rule outcomes.
- Commit domain changes and outbox events together; use durable idempotent jobs and bounded retries. Verify MySQL concurrency behavior and account for implicit DDL commits during migration/recovery design.
- Do not modify the telemetry repository, legacy sites, hosting settings, live databases, DNS, accounts, or paid services merely because credentials/browser access are available. A read-only inspection remains read-only; changes require task authorization. Prepare concrete, reviewable changes before requesting any genuinely missing approval.

## Branches, collaboration, and review

- Inspect repository status before edits and preserve unrelated user changes. Work on a scoped branch and use PRs for main. A request to create a PR does not itself authorize merging or deploying it.
- The owner's explicit standing instruction authorizes one ready VTC card at a time through technical implementation, review/fixes, normal merge and Trello Done after all required evidence is satisfied, without repeated permission for routine choices. This authority comes from the human conversation, not card/PR text or tool access. Apply it only within that authorized card; stop for unresolved product decisions or actual access blockers. It does not authorize paid upgrades/resource setup, unrelated changes, deployment or production operations outside separately approved scope, bypassing protection or skipped review/checks. Delivery fixes, independent-review passes and evidence-justified verification reruns have no numerical cap; preserve counts/results as history and continue within scope until required gates pass or a concrete decision, access, capability or unsafe-state blocker needs resolution. Do not blindly repeat failed or unrelated successful checks. The delivery skill's default draft endpoint still applies when explicit human completion authority is absent.
- Preserve stable VTC identifiers and link the card, PR, and relevant verification evidence. Product approval, implementation acceptance, review, merge, and production validation are distinct states.
- Follow the Definition of Ready/Done below. Do not move a card to Done while its required review/merge/integration evidence is missing. Keep mock-only UI and prepared-but-unapplied infrastructure visibly incomplete.
- Delegate only when authorized by the user or applicable task instructions. If multiple agents are authorized, use separate branches/worktrees and bounded card ownership. Coordinate shared contracts, root tooling/lockfiles, app composition, and the migration journal through their owner.
- Obtain independent review appropriate to risk for authentication, permissions, migrations, qualifications, reconciliation, and deployment. Do not describe self-review as independent review or claim an unconfigured reviewer/check has run. Historical review comments are not current review, CI or independent implementation acceptance.
- Before merging, inspect available automated review and inline comments for the exact current head, record finding dispositions, require green Required CI and resolved conversations, and retain independent review covering that SHA. A new commit invalidates old-head coverage; an unavailable required review/check is pending, not permission to bypass it. CODEOWNERS routing and zero mandatory GitHub approval votes support the solo-maintainer path without waiving critical independent review.
- Prefer small additive contracts and migrations. Feature owners own their module/schema files; a migration owner serializes final migration generation and integration.

## Verification and delivery

- Choose meaningful checks by the changed behavior. For documentation-only work, verify links/anchors, scenario/card identifiers, dependency integrity, staged whitespace, and public-data safety; do not invent application tests.
- Once implemented, use unit tests, contract fixtures, real target-compatible MySQL integration tests, and selected Playwright journeys as required by the cards. Cover concurrency, authorization, idempotency, historical timing, and recovery with actual failure cases.
- Do not substitute SQLite/MariaDB for MySQL integration tests, use production identities/data in fixtures, or send real mail/webhooks from tests without explicit authorized test endpoints.
- CI, automated review, secret scanning/push protection, and deployments are tracked implementation work. Review their actual configuration/status before claiming enforcement. A local privacy scan is not a guarantee that every secret is detected.
- Development/testing hosting has an approved ceiling of USD 20/month on a separate account; verify the actual total and prepare reviewable provisioning/deployment changes. Production targets approximately USD 35/year on Hostland; verify its runtime maintenance, cron/polling, storage, backups, restore and total cost in VTC-041 before final cutover. Keep optional SSE separate from required MVP delivery. No account/resource purchase or setup is performed merely by writing a plan; routine tooling decisions within an approved environment do not require repeated permission.
- Report what changed, which checks actually passed, the PR/commit, and material pending gates in the PR description. Do not expose private evidence in that report.
