---
name: deliver
description: Deliver one VTCDashboard task through planning, implementation, verification and independent review, then open a draft PR. Use when the owner invokes $deliver with a VTC card or task description.
---

# Deliver with Codex

Invoke with `$deliver VTC-023`, `$deliver VTC-023 --review-plan`, or `$deliver <task description>`. Take the task from the owner's message. Creating or editing this skill is not an instruction to run delivery. Remove `--review-plan` from the brief and preserve it as a planning-approval flag.

Read and execute the [shared delivery workflow](references/workflow.md) and [role instructions](references/roles.md). These contain the complete sequence, state/resume rules, verification/publication gates and two-fix/two-review budgets. Keep them common to the [Claude entrypoint](../../../.claude/skills/deliver/SKILL.md).

Use the host's available subagent tools, for example `collaboration.spawn_agent` with `fork_turns: "none"`. Inherit the session's model settings unless the owner requests otherwise. Include the shared instructions and role section in each assignment; do not assume an agent definition named architect or reviewer already exists in Codex. Use the supported follow-up tool for the same implementer/reviewer within a session. Wait for each role's complete report before continuing.

Use `codex` as the branch prefix unless the owner specifies another. Prefer the app's attached-worktree and PR-attachment tools when available; otherwise use the shared workflow's Git/CLI alternatives. Invoking delivery requests the scoped delegation, local commits, task-branch push and draft PR; it does not authorize merge, deployment or Trello writes.

Manual-only invocation is configured in `agents/openai.yaml`. Do not add Claude-specific frontmatter or `$ARGUMENTS` substitution to this entrypoint.
