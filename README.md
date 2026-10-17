# vtc-dashboard

A company dashboard for an ETS2/ATS virtual trucking community: driver and trip analytics, qualification checks, manual reporting, convoys, and member administration.

Start with [CONCEPT.MD](CONCEPT.MD). It contains the project idea, approved MVP requirements and permission matrix, working stack/architecture, deployment constraints, delivery phases, and 42 acceptance scenarios. This repository contains planning/contracts and isolated catalog/architecture research probes; application implementation is future work.

Read [AGENTS.md](AGENTS.md) before contributing. This is a public repository: secrets, real member data, private diagnostics, and hosting-account details must stay out of Git, PRs, and public logs.

## Planning

- [MVP Trello backlog](docs/planning/mvp-trello-backlog.md): requirements, implementation cards, dependencies, parallel-agent workflow, CI/review gates, deployment, and deferred work.
- [Trello card index](docs/planning/trello-card-index.md): direct links to all 53 imported cards and their start dependencies.
- [VTC-001 approval record](docs/product/mvp-policies.md): requirements sign-off and links to the canonical concept. Product decisions are approved; [PR #1](https://github.com/senukartur/vtc-dashboard/pull/1) and the linked Trello card record documentation delivery and review/merge evidence.
- [VTC-002 catalog investigation](docs/research/catalogs.md): measured source comparison, [official-DLC audit](docs/research/dlc-coverage-2026-10-17.md), [approved downstream hand-off](docs/research/catalog-source-follow-up.md), and [offline experiment commands](spikes/catalogs/README.md).
- [VTC-003 telemetry investigation](docs/research/telemetry.md): frozen client-source findings, [agreed HTTP contract/schema](docs/contracts/telemetry-v1.md), [synthetic examples](docs/contracts/examples/README.md), and [client/server acceptance matrix](docs/contracts/telemetry-v1-acceptance.md). Initial upload of all retained local game trips is required; [PR #3](https://github.com/senukartur/vtc-dashboard/pull/3) tracks final independent review/merge, while real integration remains pending.
- [VTC-004 rapid testing deployment](docs/research/development-hosting.md): DigitalOcean/AWS Lightsail/Railway comparison and [development-first deployment proposal](docs/decisions/hosting.md), within the owner-approved USD 20/month ceiling. VTC-011 implements staging on a separate account. [Hostland research](docs/research/hosting.md), [verification plan](docs/research/hostland-verification.md) and [unsent questions](docs/research/hostland-provider-questions.md) are deferred VTC-041 production inputs, not blockers for architecture/staging. No hosting change was performed.

- [VTC-005 architecture](docs/architecture/README.md): [stack/version direction](docs/decisions/stack.md), module/data/adapter ownership and [browser API v1](docs/contracts/dashboard/README.md), with [route inventory](docs/contracts/dashboard/routes.md), fictional UI fixtures and [bounded compatibility evidence](docs/research/stack-compatibility.md). [PR #5](https://github.com/senukartur/vtc-dashboard/pull/5) and its [review correction record](docs/architecture/review-vtc-005.md) track adoption; real application/MySQL/session/deployment integration remains separate work.

The selected database is MySQL. Develop/test with maintained MySQL 8.4 LTS and Node.js 24. Final Hostland availability, maintenance, transfer and approximately USD 35/year cost are VTC-041 release gates after integrated testing; account-specific evidence is not published here.

## Code review

[Claude advisory review](docs/development/review.md) follows the telemetry repository's automatic PR and owner `@claude` workflow. Authentication, hosted verification and merge are separate setup gates; AI comments do not replace CI or the independent review required by VTC-010.
