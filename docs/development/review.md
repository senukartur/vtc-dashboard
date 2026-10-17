# Review, repository rules and dependency hygiene

[VTC-010](https://trello.com/c/czpF65wG) owns this process. Read [AGENTS.md](../../AGENTS.md) and the [Definition of Done](../planning/mvp-trello-backlog.md#definition-of-done). Product approval, independent review, passing CI, merge and production acceptance are separate evidence.

## Review before merge

Use one card and scoped branch at a time. The [PR template](../../.github/pull_request_template.md) records behavior, exact candidate SHA, actual checks, review, impact/rollback and pending gates. [CODEOWNERS](../../.github/CODEOWNERS) routes all files to `@senukartur`; ownership is not independent approval.

Authentication, permissions, migrations, qualification rules, deduplication/reconciliation and deployment changes require review independent of the author, appropriate to risk and covering the final SHA. A separate reviewer can be an authorized independent agent; self-review is insufficient. Record its identity/source, scope, limitations and finding dispositions. Obtain a human specialist or stop when the available review cannot assess the risk. The solo-maintainer path has zero mandatory GitHub approval votes, avoiding an unavailable second-human requirement without waiving independent review.

Before every merge, inspect the latest-head Copilot review, inline comments and unresolved threads. Fix supported actionable findings or record an evidence-based rejection/explicit deferral; accepted blocker/major findings prevent delivery. After a fix, rerun affected checks and obtain review covering the new SHA. Resolving a conversation alone does not establish a fix. Require green **Required CI**, a current base comparison, resolved conversations and independent review; use normal guarded merge without bypass. If review access or required checks are unavailable, leave the PR pending.

## Native Copilot review

The owner selected the existing GitHub Copilot code reviewer. The captured native `Protect main` rule requests reviews on new pushes and excludes drafts. Mark a normal PR ready when review is intended; use the Reviewers control to request/re-request Copilot. The documented REST reviewer is `copilot-pull-request-reviewer[bot]`. Do not use a coding-agent comment or accept generated changes without inspection. See [GitHub's request/review guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review).

Native review reads repository/PR context and publishes review comments through GitHub's existing integration. This change adds no review Action, repository secret, credential or write-token workflow and enables no coding-agent fixes. Do not infer a read-only sandbox or universal prompt-injection protection from that setup. Review only public-safe synthetic material; identify a private-value finding by location/category without repeating it. Follow [CI diagnostic restrictions](ci.md#safe-diagnostics).

As checked on 2026-10-17, existing access is demonstrated by [PR #14's finding](https://github.com/senukartur/vtc-dashboard/pull/14#discussion_r4304350491) and [later review](https://github.com/senukartur/vtc-dashboard/pull/14#pullrequestreview-5559980818). Access is subject to the applicable Copilot plan and usage limits. [GitHub's current billing documentation](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/code-review) describes AI-credit consumption and Actions minutes for agentic capabilities. Actual invoice/remaining allowance is not verified here; no free, unlimited or fixed-price claim is made. No paid upgrade or additional service is authorized by this document. Copilot comments supplement tests and maintainer judgment; no Copilot approval-counting rule is added.

## Main rules and application

[main.json](../../.github/rulesets/main.json) is the desired request body for existing repository ruleset `25301218`, **Protect main**. Committing it does not apply settings. It preserves deletion/force-push protection, PR requirement, resolved conversations, existing native Copilot behavior, zero mandatory approvals and no bypass actors. It adds strict **Required CI**, bound to the verified GitHub Actions app ID `15368`, and enforces it on branch creation. [CI](ci.md) produces that stable aggregate; no advisory reviewer replaces it.

An authorized maintainer must first fetch the current ruleset and compare its name, conditions, rules and bypass actors with the reviewed snapshot. Stop and reconcile concurrent changes before updating it. Review the exact request body independently, then update that existing ruleset through repository Settings → Rules → Rulesets or `PUT /repos/senukartur/vtc-dashboard/rulesets/25301218` with the JSON file. Read back both the ruleset and `GET /repos/senukartur/vtc-dashboard/rules/branches/main`; retain public-safe evidence of the effective rules. [GitHub's rules API](https://docs.github.com/en/rest/repos/rules) documents these operations. Access limitations must remain explicit; never compensate by bypassing protection.

For acceptance, use an independently reviewed temporary synthetic PR marked **DO NOT MERGE**. Exercise a defect caught by existing tests and request native review; record the exact finding/check SHA. With the PR non-draft and other merge conditions accounted for, observe server-reported blocking by failed **Required CI**. Never attempt a merge of defective code to test protection. Close the fixture unmerged, retaining links and the actual outcome; a successful review run without an actionable finding is not seeded-defect proof.

## Dependency checks and exceptions

[dependabot.yml](../../.github/dependabot.yml) requests weekly Monday checks, capped at three open version-update PRs per ecosystem: GitHub Actions under `.github/workflows`, Dockerfiles at `/` and `/deploy/test`, and Compose files in those same directories. The [supported ecosystem/options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) lists `github-actions`, `docker` and `docker-compose`. No auto-merge is configured. Scheduled execution, alerts and generated PRs require hosted evidence after the configuration reaches the default branch; YAML alone does not prove them.

Review dependency/image changes through a scoped PR and the normal checks. Keep immutable Action/image references and the shared runtime pins synchronized; review release provenance, compatibility and relevant MySQL/browser behavior. Do not accept a bot PR merely because it is generated. Security fixes need prompt triage; deferrals require an owner, affected range/reason, compensating measure where relevant and a dated revisit in the linked card/PR. Do not publish private registry credentials or audit payloads.

**Temporary root pnpm exception, owner `@senukartur`, reviewed 2026-10-17, next review 2026-10-24:** upstream [#16169](https://github.com/dependabot/dependabot-core/pull/16169) and [#16170](https://github.com/dependabot/dependabot-core/pull/16170) merged pnpm 12 support/download changes on 2026-09-15, while the published support table still lists pnpm 7–10. Hosted updating of this repository's pnpm 12 multi-document lockfile has not been verified. This is an evidence gap, not a claim that upstream pnpm 12 is unsupported. Keep Node 24.22.0 / pnpm 12.14.0 and the lockfile format unchanged.

Until a controlled hosted npm-ecosystem update demonstrates correct parsing, resolution and frozen installation of this workspace's complete lockfile, the maintainer runs the following read-only checks weekly and records a sanitized summary/date and dispositions in the relevant card/PR:

```sh
pnpm outdated
pnpm -r outdated
pnpm audit
```

Use the pinned runtime from [CONTRIBUTING.md](../../CONTRIBUTING.md). `outdated` covers the root and recursive packages separately; audit advisories and registry updates are different signals. Record network/tool failures as missing evidence, never as no vulnerabilities. Apply fixes in reviewed PRs with normal checks; do not use automatic fix/force commands. Remove this manual exception only after that hosted proof and add the reviewed root npm entry. Historical research spikes are outside the root runtime; reassess their manifests before promoting any spike to supported code.

## Evidence and remaining gates

On 2026-10-17, PR #14 demonstrated native review finding/correction and working hosted CI. The VTC-010 controlled seeded-defect finding, applied required-check rule/readback and blocked-merge observation remain **pending**. CODEOWNERS recognition and Dependabot hosted acceptance/first scheduled result also remain **pending**, alongside final-candidate verification, independent review, latest-head Copilot, merge and main CI. Do not mark VTC-010 Done from the prepared files.

The former advisory Claude workflow was removed. [PR #7](https://github.com/senukartur/vtc-dashboard/pull/7) records its [automatic run](https://github.com/senukartur/vtc-dashboard/actions/runs/39047321260) and [on-demand follow-up](https://github.com/senukartur/vtc-dashboard/actions/runs/39047561364), with bounded historical findings/tool-denial evidence. Those runs do not establish current review, required CI or merge protection. Historical credentials are outside this configuration; their lifecycle remains an owner operation.
