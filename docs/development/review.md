# Advisory Claude review (VTC-010)

[VTC-010](https://trello.com/c/czpF65wG/10-vtc-010-configure-code-review-repository-rules-and-dependency-hygiene) includes automated review, repository rules and dependency hygiene. This change supplies only the [Claude workflow](../../.github/workflows/claude-review.yml), adapted from the owner's [telemetry workflow](https://github.com/senukartur/ets2telemetry/blob/main/.github/workflows/claude-review.yml). It does not complete VTC-009/010, configure branch protection or dependency updates, or authorize a merge/deployment.

Claude posts advisory comments. A successful workflow means the reviewer ran; it is not implementation acceptance, a required quality gate, independent review, or evidence that tests passed. The owner remains responsible for evaluating findings and obtaining the independent review required by [AGENTS.md](../../AGENTS.md).

## Triggers and usage

| Event | Behavior |
| --- | --- |
| Same-repository, non-draft PR opened/reopened/marked ready | Automatic review |
| New commits pushed | No automatic re-review; this bounds usage |
| Owner PR conversation or review-line comment containing `@claude` | Answer or re-review; for example, `@claude review the latest changes` |
| Draft PR | Automatic review skipped; explicit owner mentions are allowed |
| Fork PR, non-owner mention, ordinary comment or issue | Claude is not invoked |

PR conversation comments use the workflow on the default branch, so `@claude` in the conversation works only after this workflow is merged to `main`. Automatic PR events and review-line comments use the PR merge ref and can exercise the workflow before merge. Reopen an existing non-draft PR after merge to request its initial automatic review, or use an owner mention.

Automatic reviews cancel earlier automatic reviews of the same PR. Mention reviews use a separate concurrency group with at most one running and one pending job per PR; a newer mention replaces an already pending mention, while the running job continues. This uses GitHub's [default single-pending concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Ordinary comments cannot cancel a review because concurrency is scoped to each eligible job. Both jobs have a 20-minute timeout.

## Authentication and usage costs

Configure exactly one repository Actions secret in [GitHub settings](https://github.com/senukartur/vtc-dashboard/settings/secrets/actions):

| Secret | Source and usage |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Use `claude setup-token` locally; consumes the associated Claude subscription allowance, subject to account limits |
| `ANTHROPIC_API_KEY` | Alternative Claude Console API credential; consumes separately billed API usage |

The selected authentication method matches telemetry's subscription-token setup. GitHub does not expose an existing repository secret's value for copying; the owner must provision the Dashboard secret separately. Never paste a credential into a chat, PR, issue, committed file or public log. With the GitHub CLI, run `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo senukartur/vtc-dashboard` interactively and enter the token privately.

Both jobs pin `claude-opus-5-5`, matching the verified telemetry workflow. Update both `claude_args` entries deliberately when changing the model. Review usage depends on diff size, documents read and owner-triggered reruns; no fixed per-PR cost or unlimited subscription usage is promised. This setup creates no subscription, API account or paid infrastructure.

The workflow uses the job's short-lived `GITHUB_TOKEN`; no Claude GitHub App installation or personal GitHub token is required for these comments. Missing/invalid Claude authentication fails the advisory job. Adding a secret does not rerun a failed job automatically; rerun that job from Actions.

## Permissions and public-data handling

Each job has `contents: read`, `pull-requests: write`, and `issues: write`. These scopes allow comments and review operations but no code push; the prompt prohibits approval and change requests. The explicit allowed tools cover file reading, PR views/diffs/comments and inline findings. In mention mode, the [pinned action also adds default tools and enables local edits](https://github.com/anthropics/claude-code-action/blob/756cc22e19660d20e8cc9496b4f242475a7f7790/src/modes/tag/index.ts), including progress-comment and CI-inspection tools and git operations. Both jobs therefore explicitly deny file-edit tools, git commands/the action's push wrapper and MCP file commits/deletions with `--disallowedTools`; the action's own setup still checks out the PR and prepares git authentication. This is a constrained reviewer, not a proof against prompt injection. The reviewer is instructed not to install project dependencies or run application code/tests.

The owner-only mention job checks that the target is an open, same-repository PR before checkout or Claude authentication. This closes telemetry's documented fork-conversation exception, which is unsuitable for this public repository. Fork automatic/review-line events are also excluded. No `pull_request_target`, extra non-write actors or bot allowlist is enabled.

Actions are pinned to telemetry's exact reviewed commits. Checkout does not persist credentials. The pinned Claude action restores its fixed configuration paths, including `CLAUDE.md` and `.claude/`, from the PR base branch before execution; [upstream security guidance](https://github.com/anthropics/claude-code-action/blob/756cc22e19660d20e8cc9496b4f242475a7f7790/docs/security.md) describes that boundary and its limits. The root [CLAUDE.md](../../CLAUDE.md) imports [AGENTS.md](../../AGENTS.md) to avoid duplicated repository instructions. The bootstrap PR's new `CLAUDE.md` may be removed by that restoration until merged; its explicit workflow prompt still directs the reviewer to AGENTS.md and CONCEPT.MD.

Full model output is disabled even during debug reruns: this is a public repository. Findings must identify the location/category of a private value without repeating it. Review only public-safe synthetic evidence. Never upload private runtime diagnostics to prove a finding.

## Verification and remaining gates

Prepared in [PR #7](https://github.com/senukartur/vtc-dashboard/pull/7). On 2026-10-17, actionlint 1.7.12, local documentation links and staged whitespace checks passed; staged changes were inspected with a targeted privacy scan. GitHub accepted the workflow and [skipped both jobs for the draft PR](https://github.com/senukartur/vtc-dashboard/actions/runs/39046116323), as intended.

After the owner provisioned the authentication secret, marking the PR ready triggered a [successful automatic review](https://github.com/senukartur/vtc-dashboard/actions/runs/39047321260) of commit `e414f2fc20bfb43e1b00650155f33177684033ab`. Claude posted [a summary and two inline findings](https://github.com/senukartur/vtc-dashboard/pull/7#issuecomment-6236220562). The follow-up corrects the concurrency documentation and adds explicit edit/git tool denials after confirming mention-mode defaults in the pinned action source. That successful run predates these fixes; it is not a clean review or hosted verification of the added denials. No seeded-defect finding, fork/non-owner hosted test, conversation mention or enforced merge gate is claimed.

- Validate workflow syntax/expressions with actionlint and inspect the exact staged diff for whitespace and public-data safety.
- After authentication is configured, open/mark ready a same-repository PR and verify actual advisory output. Before merge, an owner review-line mention can test on-demand behavior; after merge, verify a PR conversation mention as well.
- Verify that a controlled synthetic defect produces an actionable finding before claiming the VTC-010 seeded-defect acceptance criterion. A run completing without findings does not establish this.
- Check skipped drafts, fork and non-owner events, and absence of automatic re-review on push. Local condition checks supplement but do not replace hosted event evidence.
- Keep VTC-010 incomplete until its remaining ownership/template, protected-main/required-CI, resolved-conversation, dependency-update, independent-review and merge evidence exists. Never make this advisory job a substitute for VTC-009 quality checks.

To disable new invocations, disable **Claude code review** under GitHub Actions; cancel any already running reviews separately. Reverting the workflow removes the integration but does not revoke the underlying Claude credential. Credential revocation/rotation is a separate owner operation.
