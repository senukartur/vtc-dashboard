---
name: deliver
description: Deliver one VTCDashboard task through planning, implementation, verification and independent review, then open a draft PR. Use when the owner invokes $deliver with a VTC card or task description.
---

# Deliver with Codex

Invoke with `$deliver VTC-023`, `$deliver VTC-023 --review-plan`, or `$deliver <task description>`. Take the task from the owner's message. Creating or editing this skill is not an instruction to run delivery. Remove `--review-plan` from the brief and preserve it as a planning-approval flag.

Read and execute the [shared delivery workflow](references/workflow.md) and [role instructions](references/roles.md), including their task-data/trusted-decision distinction. They own sequencing, state, evidence-led continuation, recovery and publication gates; keep these rules common to the [Claude entrypoint](../../../.claude/skills/deliver/SKILL.md). Delivery fixes, independent-review passes and justified verification reruns have no numerical cap; retain every attempt and continue within authorized scope until the gates pass or a concrete blocker needs resolution.

Use the host's available subagent tools, for example `collaboration.spawn_agent` with `fork_turns: "none"`. Inherit the session's model settings unless the owner requests otherwise. Supply complete shared/role instructions from the pinned runtime bundle; do not depend on native role definitions or relative paths at the task base. Use the supported follow-up tool for the same implementer/reviewer within a session. Wait for each complete report before continuing.

Codex subagents inherit the parent permissions. Calling a role read-only in a prompt does not disable its shell/write tools, and a custom agent file cannot override the parent sandbox. Record that limit and use supplied source/diff snapshots for planning/review. Use stronger host controls when actually available; if enforced read-only execution is required but unavailable, follow the shared missing-capability stop. Do not claim parity with Claude's tool allowlists. See [official subagent permission guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls).

Use `codex` as the branch prefix unless the owner specifies another. Prefer the app's attached-worktree and PR-attachment tools when available; otherwise use the shared workflow's Git/CLI alternatives. Invoking delivery requests the scoped delegation, local commits, task-branch push and draft PR; it does not authorize merge, deployment or Trello writes.

Manual-only invocation is configured in `agents/openai.yaml`. Do not add Claude-specific frontmatter or `$ARGUMENTS` substitution to this entrypoint.
