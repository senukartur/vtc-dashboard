# vtc-dashboard

A company dashboard for an ETS2/ATS virtual trucking community: driver and trip analytics, qualification checks, manual reporting, convoys, and member administration.

Start with [CONCEPT.MD](CONCEPT.MD). It contains the project idea, approved MVP requirements and permission matrix, working stack/architecture, deployment constraints, delivery phases, and 42 acceptance scenarios. This repository currently contains planning documentation and an isolated catalog research spike; application implementation is future work.

Read [AGENTS.md](AGENTS.md) before contributing. This is a public repository: secrets, real member data, private diagnostics, and hosting-account details must stay out of Git, PRs, and public logs.

## Planning

- [MVP Trello backlog](docs/planning/mvp-trello-backlog.md): requirements, implementation cards, dependencies, parallel-agent workflow, CI/review gates, deployment, and deferred work.
- [Trello card index](docs/planning/trello-card-index.md): direct links to all 53 imported cards and their start dependencies.
- [VTC-001 approval record](docs/product/mvp-policies.md): requirements sign-off and links to the canonical concept. Product decisions are approved; [PR #1](https://github.com/senukartur/vtc-dashboard/pull/1) and the linked Trello card record documentation delivery and review/merge evidence.
- [VTC-002 catalog investigation](docs/research/catalogs.md): measured source comparison, [official-DLC audit](docs/research/dlc-coverage-2026-10-17.md), [approved downstream hand-off](docs/research/catalog-source-follow-up.md), and [offline experiment commands](spikes/catalogs/README.md).
- [VTC-003 telemetry investigation](docs/research/telemetry.md): frozen client-source findings, [candidate HTTP contract/schema](docs/contracts/telemetry-v1.md), [synthetic examples](docs/contracts/examples/README.md), and [client/server acceptance matrix](docs/contracts/telemetry-v1-acceptance.md). Initial upload of all retained local game trips is required; agreement and real integration remain pending.

The selected database is MySQL. The hosting compatibility baseline is MySQL 8.0 and Node.js 24 LTS. Runtime verification, maintenance policy, and deployment checks remain tracked in VTC-004; account-specific evidence is not published here.
