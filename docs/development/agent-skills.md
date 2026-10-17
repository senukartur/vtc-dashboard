# Project engineering skills

The seven ECC-derived engineering skills below are shared guidance for Codex and Claude Code. Product policy stays in [CONCEPT.MD](../../CONCEPT.MD), scope in the [backlog](../planning/mvp-trello-backlog.md), and permissions/ownership in [AGENTS.md](../../AGENTS.md). Skills do not implement features, install libraries, authorize delegation, or grant merge/deployment access.

## Discovery and selection

Canonical instructions live in `.agents/skills/<name>/SKILL.md`, with Codex UI metadata in `agents/openai.yaml`. Claude has small `.claude/skills/<name>/SKILL.md` entrypoints that read the canonical instructions. Maintain behavior in the canonical file and keep both descriptions synchronized. Plain files avoid Windows symlink requirements and duplicated bodies.

Main agents and subagents use the smallest relevant set before planning, implementation, verification or review. Do not load all seven for an unrelated task.

| Skill | Apply when | Common companions |
| --- | --- | --- |
| [frontend-patterns](../../.agents/skills/frontend-patterns/SKILL.md) | Feature structure, transport/query flows, forms and cross-component states | react-patterns; react-testing |
| [react-patterns](../../.agents/skills/react-patterns/SKILL.md) | Components, hooks, effects, composition and state placement | react-testing |
| [react-performance](../../.agents/skills/react-performance/SKILL.md) | Diagnosing performance or changing costly fetching/rendering | react-patterns; backend-patterns for API bottlenecks |
| [react-testing](../../.agents/skills/react-testing/SKILL.md) | Component/hook tests, browser journeys, network and accessibility assertions | The affected frontend skill |
| [frontend-design-direction](../../.agents/skills/frontend-design-direction/SKILL.md) | Visual hierarchy, design treatment and responsive layout | frontend-patterns; react-testing |
| [backend-patterns](../../.agents/skills/backend-patterns/SKILL.md) | Fastify routes, module use cases, permissions, ports and durable work | mysql-patterns for persistence/concurrency |
| [mysql-patterns](../../.agents/skills/mysql-patterns/SKILL.md) | Schema/migrations, SQL, indexes, pools, transactions and recovery | backend-patterns |

Codex can select these implicitly or use `$react-patterns review this component`. Claude can select them implicitly or use `/react-patterns review this component`. Start/reload the host session if new skills are not listed; existing sessions may have an older discovery snapshot. No global installation, plugin, hook, MCP server or paid service is required. If discovery is unavailable, read the canonical file explicitly and disclose that fallback.

A report form usually needs frontend-patterns, react-patterns and react-testing; layout work may also need frontend-design-direction. A durable-job claim needs backend-patterns and mysql-patterns. Documentation-only changes need document checks, not the React suite or all skills.

## Subagent handoff

For every authorized delegation, the parent includes a **Selected skills** section: names, reasons, instruction version and absolute paths in that assignment's checkout/snapshot or verified instruction bundle. Supply full selected bodies if the child cannot read those paths. Include needed references or answer requests from the same version. Do not assume a child inherits loaded skills, paths or skill tools.

The child reads/applies selected instructions before work, can request another relevant skill, and reports applied skills and missing inputs. Guidance stays within the role's allowed operations: architects/reviewers inspect and recommend checks; implementers edit; verifiers run assigned checks. No skill grants tools or further delegation.

For [$deliver](../../.agents/skills/deliver/SKILL.md) and [/deliver](../../.claude/skills/deliver/SKILL.md), pin this registry, both host entrypoints for the seven skills, their Codex metadata and the [license](../../third_party/ecc-skills/LICENSE) with the delivery instruction bundle. Supply only selected bodies to each role. Keep the instruction version separate from the task base/candidate; older worktrees may lack the skills. Additional selection during a run comes from that same verified bundle, without silently refreshing from `main`.

The native [Claude roles](../../.claude/agents/implementer.md) retain their explicit tool limits and consume supplied instructions or read provided files. They need neither the `Skill` tool nor unconditional `skills:` preloading. This is selective explicit loading, not a claim that a wrapper's linked body is automatically injected into a child. The [shared role instructions](../../.agents/skills/deliver/references/roles.md) apply the same handoff to Codex.

## Project adaptation

- React/Vite SPA, React Router, TanStack Query and i18next replace Next.js/RSC/Server Actions/SWR examples. Manifests determine available libraries; VTC-012 owns the full shadcn/ui/form/design foundation.
- Fastify commands/queries and approved contracts replace Express/Next.js handlers, Supabase/PostgreSQL and generic JWT/role examples. Additive roles, server filtering and historical timing remain authoritative.
- MySQL 8.4/InnoDB, mysql2, shared runtime configuration and migration ownership replace MariaDB/SQLAlchemy recipes and generic schema/pool/server presets. VTC-007 owns Drizzle/schema foundations.
- Durable MySQL outbox/jobs replace in-memory queues and Redis examples; VTC-021 owns implementation. Polling/cron remains required; optional SSE is separate work.
- Performance advice requires measurements rather than blanket memoization, arbitrary thresholds or imported benchmark claims. Tests use configured tooling; VTC-008 remains the broader test-tooling owner.
- Design guidance keeps content states and rendered review. ECC's checker script, authenticated reference service, external agents/commands/rules and unrelated skill dependencies are not imported. Local synthetic observations replace mandatory JSON; missing rendered evidence stays pending.

This adds instructions and metadata only. Syntax/link/selection checks do not prove live host invocation, subagent behavior, application tests, CI enforcement or independent review. Actual features follow their cards and [contributor commands](../../CONTRIBUTING.md).

## Provenance and license

Adapted on 2026-10-17 from [affaan-m/ECC](https://github.com/affaan-m/ECC/tree/76aaa77df6adc5b889e689007bf99b9a4f74af34), commit `76aaa77df6adc5b889e689007bf99b9a4f74af34`. These are curated adaptations, not verbatim mirrors or automatically updated files. ECC's MIT notice is preserved verbatim in [third_party/ecc-skills/LICENSE](../../third_party/ecc-skills/LICENSE) and applies to the ECC-derived instructions and Claude entrypoints.

| Local skill | Pinned upstream source |
| --- | --- |
| frontend-patterns | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/frontend-patterns/SKILL.md) |
| react-patterns | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/react-patterns/SKILL.md) |
| react-performance | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/react-performance/SKILL.md) |
| react-testing | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/react-testing/SKILL.md) |
| frontend-design-direction | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/frontend-design-direction/SKILL.md) |
| backend-patterns | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/backend-patterns/SKILL.md) |
| mysql-patterns | [SKILL.md](https://github.com/affaan-m/ECC/blob/76aaa77df6adc5b889e689007bf99b9a4f74af34/skills/mysql-patterns/SKILL.md) |

ECC credits Vercel Labs' React best practices for react-performance, and contributor `linus707` plus UIZZE's state/evidence workflow for frontend-design-direction. These origins remain credited; no external assets, reference-library materials, checker scripts or additional upstream packages are redistributed here.

For updates, inspect the source/license diff, reconcile project decisions, update the pinned revision/attribution and validate both host entrypoints. Do not blindly replace these adaptations.

## Validation record

On 2026-10-17, the skill-creator `quick_validate.py` passed for all 14 canonical/Claude entrypoints. Additional checks passed for synchronized names/descriptions, seven Codex UI metadata files and implicit-selection defaults, 112 local links/anchors, referenced VTC identifiers, verbatim upstream MIT notice, unchanged tool/model policies for all four Claude roles, and staged whitespace. The exact staged files were inspected with a targeted public-data scan; no checked categories matched. This is not a complete secret-detection guarantee.

No application code, dependencies or runtime configuration changed, so application/MySQL/browser suites were not run. Live Codex/Claude invocation and subagent execution were not exercised; the handoff checks establish instruction consistency only.

## Host references

- [Official Codex skill discovery](https://developers.openai.com/codex/skills/): repository `.agents/skills` and progressive loading.
- [Claude Code skills](https://code.claude.com/docs/en/skills): project `.claude/skills`, descriptions and invocation.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents): tool allowlists and optional preloading. This project supplies selected canonical instructions explicitly.
