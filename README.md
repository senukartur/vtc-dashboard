# vtc-dashboard

A company dashboard for an ETS2/ATS virtual trucking community: driver and trip analytics, qualification checks, manual reporting, convoys, and member administration.

Start with [CONCEPT.MD](docs/CONCEPT.MD). It describes the project idea, roles and main features. Detailed approved rules, the permission matrix and 42 acceptance scenarios are in the [MVP product policies](docs/product/mvp-policies.md). The repository now includes the VTC-006 API/web scaffold, root tooling and local Docker environment alongside planning/contracts and isolated research probes. Domain features remain future work.

Read [AGENTS.md](AGENTS.md) before contributing. This is a public repository: secrets, real member data, private diagnostics, and hosting-account details must stay out of Git, PRs, and public logs.

## Local development

Use Docker Desktop with Linux containers or Docker Engine/Compose 2.32+. Create private configuration, then start the app and MySQL:

```sh
node scripts/setup-local.mjs
docker compose up --build --watch
```

Open [the local UI](http://127.0.0.1:5173). The setup helper only needs host Node 18+; a Docker-only equivalent is in [CONTRIBUTING.md](docs/CONTRIBUTING.md). The application itself uses pinned Node 24.22.0, pnpm 12.14.0 and MySQL 8.4.11 inside containers. No credentials or seed accounts are committed.

Run `docker compose exec app pnpm check`, `pnpm db:check`, `pnpm smoke:local` or `pnpm build` inside that container. See [the command reference](docs/CONTRIBUTING.md) and [workspace evidence](docs/development/workspace.md) for portable native builds, health/readiness, data persistence and pending gates. The initial page is a bilingual connection screen, not an implemented company dashboard.

## Planning

- [Trello board](https://trello.com/b/NwhwurSM/vtcdashboard): implementation cards, acceptance checklists, dependencies and status. Delivery rules are in the [agent rules](docs/development/agent-rules.md).
- [VTC-001 approval record](docs/product/mvp-policies.md): requirements sign-off and links to the canonical concept. Product decisions are approved; [PR #1](https://github.com/senukartur/vtc-dashboard/pull/1) and the linked Trello card record documentation delivery and review/merge evidence.
- [VTC-002 catalog investigation](docs/research/catalogs.md): measured source comparison, [official-DLC audit](docs/research/dlc-coverage-2026-10-17.md), [approved downstream hand-off](docs/research/catalog-source-follow-up.md), and [offline experiment commands](spikes/catalogs/README.md).
- [VTC-003 telemetry investigation](docs/research/telemetry.md): frozen client-source findings, [agreed HTTP contract/schema](docs/contracts/telemetry-v1.md), [synthetic examples](docs/contracts/examples/README.md), and [client/server acceptance matrix](docs/contracts/telemetry-v1-acceptance.md). Initial upload of all retained local game trips is required; [PR #3](https://github.com/senukartur/vtc-dashboard/pull/3) tracks final independent review/merge, while real integration remains pending.
- [VTC-004 rapid testing deployment](docs/research/development-hosting.md): DigitalOcean/AWS Lightsail/Railway comparison and [development-first deployment proposal](docs/decisions/hosting.md), within the owner-approved USD 20/month ceiling. VTC-011 implements staging on a separate account. [Hostland research](docs/research/hosting.md), [verification plan](docs/research/hostland-verification.md) and [unsent questions](docs/research/hostland-provider-questions.md) are deferred VTC-041 production inputs, not blockers for architecture/staging. No hosting change was performed.

- [VTC-005 architecture](docs/architecture/README.md): [stack/version direction](docs/decisions/stack.md), module/data/adapter ownership and [browser API v1](docs/contracts/dashboard/README.md), with [route inventory](docs/contracts/dashboard/routes.md), fictional UI fixtures and [bounded compatibility evidence](docs/research/stack-compatibility.md). [PR #5](https://github.com/senukartur/vtc-dashboard/pull/5) and its [review correction record](docs/architecture/review-vtc-005.md) track adoption; real application/MySQL/session/deployment integration remains separate work.

The selected database is MySQL. Develop/test with maintained MySQL 8.4 LTS and Node.js 24. Final Hostland availability, maintenance, transfer and approximately USD 35/year cost are VTC-041 release gates after integrated testing; account-specific evidence is not published here.

## Code review

GitHub Copilot code review is disabled. An advisory Claude Sonnet 5.5 workflow is configured for pull requests. Inspect available review comments before merge, require green **Required CI** and resolved conversations, and retain independent review appropriate to risk. AI comments do not replace CI or independent review.

The [public landing and membership application](docs/development/public-landing.md) use `/` (RU) and `/en` (EN). The real application/MySQL connection screen is at `/status`; live admissions activation remains separately controlled and disabled by default.
