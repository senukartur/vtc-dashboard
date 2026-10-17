---
name: deliver
description: Deliver one VTCDashboard task through planning, implementation, verification and independent review, then open a draft PR. Use when the owner invokes $deliver with a VTC card or task description.
---

# Deliver

Adapted from the owner's [ETS2Telemetry deliver skill](https://github.com/senukartur/ets2telemetry/tree/main/.claude/skills/deliver). Preserve its sequential pipeline:

```text
architect -> implementer -> verifier -> reviewer -> draft PR
                 ^              |           |
                 +-- fixes -----+-----------+
```

Invoke with `$deliver VTC-023`, `$deliver VTC-023 --review-plan`, or `$deliver <task description>`. Take the task from the owner's message; Codex does not expand Claude's `$ARGUMENTS`. Creating or editing this skill is not an instruction to run delivery.

Read root `AGENTS.md` and `CONCEPT.MD` before planning. Read `docs/planning/mvp-trello-backlog.md`, `docs/planning/trello-card-index.md`, `CONTRIBUTING.md` and relevant implementation contracts. Resolve these paths from the task repository root. They own requirements, dependencies, ownership and verification; this skill does not supersede them.

Speak Russian unless the owner chooses another language. Write plans, commits, reports saved in the repository, and PR text in English.

## Orchestration and authority

The main session owns Git setup, state, pushes, PRs and any CI dispatch. This skill requests sequential delegation to an architect, implementer, verifier and independent reviewer when invoked for delivery. Use the host's available subagent tools, not user-visible chats. Do not create new chats or message existing chats as a substitute for subagents.

Read [role instructions](references/roles.md) and include the relevant role's full instructions in each assignment. Start roles with fresh context where supported (for example, `collaboration.spawn_agent` with `fork_turns: "none"`); inherit the session's model settings unless the owner requests otherwise. Give absolute paths and all needed inputs. Wait for each role before starting its dependent step. Reuse the implementer and reviewer for follow-ups within a session through the available follow-up tool. Never ask subagents to delegate further. Architect, verifier and reviewer are read-only; these are instructions, not tool-enforced permissions. Check Git state after each.

Use one scoped implementation branch/worktree. Only the implementer writes there; read-only roles inspect it sequentially. This does not authorize simultaneous edits or additional card owners. If subagents are unavailable or prohibited, complete safe preparation and report the missing review capability; do not call self-review independent review or publish as if that gate passed.

Invoking delivery authorizes the scoped local work, commits, branch push and draft PR described here. It does not authorize marking ready, merging, deploying, provisioning paid services, modifying the telemetry repository or live systems, writing to Trello, or sending messages to people. Existing explicit authorization in the conversation still applies. Use configured credentials through normal tools; respect the host's approval policy without prescribing sandbox bypasses.

## 1. Resolve the task and resume state

1. If there is no task, ask for a VTC card or brief. If the message names a card, read it and its checklist read-only through the available Trello connector. Locate its stable ID and dependencies in the backlog/index. If Trello is unavailable, use the checked-in brief when sufficient and record that current card state was not verified; ask only for missing information that prevents a sound plan. Never infer prerequisite completion from a card's existence.
2. Use the lowercase card ID as the run key. For a free-text task use `NO-CARD` and `nc-` plus a short lowercase ASCII hyphenated slug; use a short unique suffix if transliteration is empty or keys collide. Explain the absence of a card in the PR rather than inventing a VTC ID.
3. Store sanitized state in `.local/deliver/<run-key>/` under the original checkout. Verify `.local/` is ignored before writing. Keep `state.md`, `plan.md`, verifier/reviewer reports and `pr-body.md` there. Do not retain secrets, real reports, telemetry or private hosting inventory even in pipeline state.
4. Look for an unfinished run with the same brief. Resume a matching task automatically when ownership is clear. Ask only if multiple runs or conflicting ownership make the choice ambiguous. Verify its recorded base, branch, worktree, HEAD and PR against Git/GitHub before relying on them. A previous agent ID may no longer exist; recreate the role with the saved plan, reports and current diff.
5. Track the brief, card/criteria, base SHA, worktree, branch, step, candidate SHA, check results, review coverage, findings/dispositions, fix-round count, review-pass count, published SHA, PR and CI links. Update state after each step. Resume never resets the budgets below.

## 2. Prepare the base and tools

1. Inspect status, worktrees and open PRs. Preserve the original checkout's branch, staged changes and unrelated files. Reuse an unambiguously task-owned worktree/PR; do not take over another card's checkout. Snapshot the original HEAD/status before planning.
2. Fetch `origin` and record the verified `origin/main` SHA as the base for a new run. Use an explicitly requested dependency branch/base when authorized, and disclose the dependency in the plan/PR. Do not silently base a task on unrelated unmerged work. A resume retains its verified recorded base unless a deliberate update requires re-verification.
3. Inspect the current manifest, `config/runtime.json`, contributor instructions and actual `.github/workflows/`. Do not assume CI, automated review or repository rules are configured. VTC-009/VTC-010 own those gates.
4. For code checks, use the repository's pinned runtime (currently Node.js 24.22.0 and pnpm 12.14.0). Docker is the preferred app/MySQL environment. Record the chosen commands and worktree-specific Compose configuration in the plan. Never reuse another worktree's running app container as evidence for this candidate. Isolate Compose project names, loopback ports and volumes where needed; keep generated `.env` private. Do not copy production configuration or remove existing data volumes.
5. Use `pnpm install --frozen-lockfile` for native dependency installation when needed. Do not substitute telemetry's npm/CMake workflow, change pins to fit the machine, install global tools without authorization, disable TLS verification, or print credentials to diagnose access. Documentation/skill-instruction changes need no application dependency installation.

## 3. Plan

1. Run the architect with the brief, criteria/dependencies, applicable owner decisions, repository root and base SHA. It must inspect the recorded base, using `git show <base>:<path>`/`git ls-tree` if the original checkout differs, rather than planning against unrelated branch or working-tree changes. An isolated checkout of the base may be prepared early and reused in step 4. Save the plan as `plan.md`.
2. Confirm that planning did not change the original checkout's HEAD, index or working files.
3. If `--review-plan` was supplied, save `step: awaiting plan approval`, show the concrete plan and wait for approval. Also ask when a product decision, conflicting requirement, unapproved major architecture/contract/security change or out-of-scope action actually needs the owner. Name the unresolved decision and its source.
4. Routine implementation within the approved card, including planned schema or permission work, does not itself require another approval. Summarize the plan and continue when scope is sound and existing authorization covers it. Keep independent review and migration ownership gates intact.

## 4. Prepare the implementation worktree

1. Choose a `codex/<run-key>-<summary>` branch. Check local branches, remote heads and PRs before creating it. Reuse a matching owned run; choose a distinct name for an unrelated name collision instead of overwriting it. Stop only for unresolved ownership or conflicting changes.
2. Prefer the app's worktree tools when available: inspect attached worktrees, create with the verified base as `ref`, and wait for final paths. Otherwise use `git worktree add --no-track -b <branch> <ignored-worktree-path> <base-sha>`. Validate the actual branch/base before assignment; create the scoped branch if the managed checkout starts detached. Do not switch the original checkout's branch.
3. Record the absolute worktree and branch. Inspect actual hooks; do not require telemetry's `.githooks`. Prepare only the dependencies/local test environment the plan requires.

## 5. Implement

Assign the implementer the full accepted plan, brief/criteria, applicable owner decisions, worktree, branch, base SHA, owned/shared files, toolchain/environment commands and any required commit attribution (otherwise none). It commits locally only; no push, PR, CI, Trello or other external writes.

Check its report against commits since the base, status and the full diff. Confirm scope and absence of private/generated data. Review the exact staged diff before each commit and the exact committed diff before pushing; never stage unrelated files with a blanket add. Record the clean HEAD as the candidate. Send ordinary implementation issues back within the same bounded assignment; surface genuinely missing owner decisions.

## 6. Verify

1. Run the verifier with the worktree, base/candidate SHA, plan's exact checks and chosen environment. Its report must identify the candidate and distinguish `PASS`, `FAIL`, `FLAKY`, `NOT RUN`, `CI ONLY` and `NOT APPLICABLE` checks.
2. Confirm HEAD and tracked/untracked status are unchanged after verification, allowing only expected ignored build/test output. Unexpected changes produce `INVALID`; investigate without overwriting them.
3. On `FAIL`, send sanitized failure excerpts to the implementer, consume one fix round, record the new candidate, then repeat verification. On `INVALID`, stop dependent work and resolve the invalid state before restarting checks.
4. `INCOMPLETE` may proceed to review/draft publication with every missing/flaky check visibly pending. It is never acceptance, a CI pass or permission to merge. A required safety condition for publishing itself cannot be deferred this way.
5. The entire run has **two fix rounds total**, shared by verification failures and review fixes. Persist the count across resumes. If a necessary further fix exceeds the budget, report the concrete remaining issue and wait for the owner's direction.

## 7. Independent review

1. Start a fresh reviewer with the brief/criteria, plan, base/candidate SHA, worktree and verifier report. Do not pass the implementer's conversation or a desired verdict. Review must cover the exact candidate, including documentation-only changes.
2. Evaluate each supported finding. Record its severity and disposition: fixing commit, evidence-based rejection, or explicit deferral. Accepted blocker/major findings must be fixed before publication. Minor/nit findings may remain visibly listed in the draft PR.
3. Batch accepted fixes into one implementer assignment and consume one fix round. Re-verify the new candidate and send its delta to the same reviewer. Even a minor post-review change invalidates coverage of the old SHA until reviewed again.
4. Allow **at most two review passes** in the run. Persist the count. Stop for direction if unresolved blocker/major findings or an unreviewed changed candidate would need another pass.
5. Confirm the reviewer changed neither HEAD nor working files. A self-check or an unconfigured automated reviewer is not independent evidence. Record review identity/source, candidate SHA and limitations without private conversation content.

## 8. Publish a draft

1. Require a clean worktree whose HEAD equals the final candidate, verification `PASS` or disclosed `INCOMPLETE` for that SHA, independent review covering that SHA, and no unresolved accepted blocker/major findings. Inspect public-data safety in the final diff and prepared PR text. Record the intended published SHA.
2. Push only the task branch, using its configured credentials. Never force-push main. If a rewrite of an owned PR branch is genuinely necessary and authorized, use an exact force-with-lease guard; do not use a blind force push.
3. Use the repository PR template if one exists; otherwise write a concise body with the problem/result, card link or `NO-CARD` reason, scope, actual verification commands/results and candidate SHA, independent review/findings, and remaining acceptance/CI/integration/deployment gates. Include migration/recovery notes when relevant. Use `gh pr create --draft --base main --head <branch> --title "[<ID>] <type>: <summary>" --body-file <absolute-pr-body-path>` or an equivalent available connector. Use the planned dependency base when applicable. Follow current attribution instructions; do not copy Claude branding or invent an attribution requirement.
4. Before retrying an uncertain push/PR outcome, inspect the remote branch and existing PRs to avoid duplicates. Attach every created PR with the app's PR attachment tool when available; attach a reused PR when continuing its work.
5. Inspect actual CI triggers and check runs for the published SHA. If PR checks run automatically, record them without duplicate dispatch. Dispatch at most once only when a relevant existing workflow supports manual dispatch, its inputs are known, and it runs checks only. A workflow that can deploy or provision needs that separate authorization. Bound discovery of the matching run to about a minute; require its `headSha` to equal the published SHA. Record the link and pending outcome. No configured workflow means `NOT CONFIGURED`, never a pass. Do not invent `windows-ci.yml` or claim VTC-009 enforcement.

## 9. Report and preserve handoff

Tell the owner what changed, PR link/published SHA, checks actually run, independent review and finding outcomes, CI link/status, remaining gates and absolute worktree path. If external publication is unavailable, retain the reviewed local commits and prepared PR body, and report the exact missing capability without claiming a PR exists.

Record `step: draft published` only after publication succeeds. Preserve the worktree and state for follow-up. This is pipeline delivery, not the backlog's Definition of Done: review/CI/merge/integration/production evidence remain distinct. Never move a card to Done or write to Trello without the owner's explicit instruction and the required evidence.

## Stop and escalation conditions

Stop dependent work for an unresolved owner decision, exhausted fix/review budget, invalid or unexpectedly modified checkout, unresolvable role blocker, missing independent review, or an unauthorized external/destructive action. Make safe independent progress first where possible. Missing production access, a routine tool choice, ordinary approved schema work, or a harmless branch-name collision is not automatically a reason to request approval. Do not launch games, change game directories, use production identities, send real mail/webhooks, or modify live infrastructure merely because access exists.
