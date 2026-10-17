# VTC-004: fast development deployment

**Date:** 2026-10-17. **Status:** researched recommendation, not provisioned. **Card:** [VTC-004](https://trello.com/c/OZ84Rfk4). The owner approved a separate testing budget of **up to USD 20/month** and will use a separate account. The approximately USD 35/year Hostland constraint applies only to final production.

## Recommendation

Use one **DigitalOcean Basic Regular bundled Droplet, 2 GiB RAM / 1 vCPU / 50 GiB SSD**, as the proposed staging platform. Its published base price is **USD 12/month** [D1]. This is a starting sizing hypothesis, not measured capacity. Build and run the full test suite in GitHub Actions, rather than competing with MySQL on this small server. VTC-011 must measure memory, disk, restart recovery and job delay before treating the environment as ready.

A small VPS requires initial OS/TLS/deployment setup and ongoing patching. It then gives one persistent staging URL and a predictable release flow. This recommendation favors a reproducible Node/MySQL environment and the approved minute scheduler. No deployment management product or managed database is required. AWS Lightsail remains a practical alternative if the owner prefers an AWS account; no provider account has been created or selected through a purchase.

## Compared options

These are public prices observed on the date above, before account-specific taxes, conversion, extras and overages. Trial credits are not a recurring-budget assumption.

| Option | Published starting point for this comparison | Suitability and trade-off |
| --- | --- | --- |
| **DigitalOcean Basic Regular, recommended** | USD 12/month; 2 GiB, 1 vCPU, 50 GiB SSD, bundled public IPv4 [D1] | One self-managed VM for app/database/files; normal Linux cron and Docker Compose can be configured. Requires server maintenance and an authorized HTTPS hostname. Actual application compatibility is VTC-011 evidence. |
| **AWS Lightsail Linux/Unix, public IPv4** | USD 12/month; 2 GB, 2 vCPUs, 60 GB SSD [A1] | Similar single-VM design and responsibilities; snapshots are extra at USD 0.05/GB-month. Prefer this fixed bundle over designing an EC2/RDS/load-balancer stack for this test environment. No AWS account configuration was inspected. |
| **Railway Hobby** | USD 5 minimum/month including USD 5 usage; additional resource usage is charged [R1] | Convenient GitHub deployment and service domains. Total app + MySQL + persistent storage cost is workload-dependent, not a USD 5 flat bundle. Native cron has a **five-minute minimum**, so the approved minute cadence would require a separately designed running scheduler [R2]. Compute hard limits stop workloads [R3]. Not the first recommendation for the current scheduler/cost requirements. |

Railway could reduce initial server administration, but switching to it would require a concrete scheduler, persistent-file and measured cost plan. Do not replace MySQL with a free PostgreSQL service or use ephemeral filesystem storage merely to simplify deployment.

## Budget worksheet

| Proposed item | Monthly estimate |
| --- | --- |
| One USD 12 bundled Droplet | USD 12.00 |
| Optional basic weekly VM backups at 20% of VM price [D2] | USD 2.40 |
| Infrastructure subtotal with that option | **USD 14.40 before tax/extras** |
| Remaining allowance within USD 20 | **USD 5.60**, shared by tax/conversion, domain/DNS, independent backup copy and any other costs |

This is not a guaranteed all-in quote. VTC-011 must verify the owner's actual checkout total and approved add-ons against the USD 20 ceiling before provisioning. Use an existing owner-controlled test subdomain if available; a new domain and its renewal are not assumed free. If the combined estimate exceeds the ceiling, adjust the plan or obtain a budget decision. No larger VM, second environment, paid preview per PR or managed database is approved by this recommendation.

Provider VM backups complement, but do not replace, consistent MySQL/evidence exports and an independent private recovery copy. Before pilot data is stored, name the backup destination, cadence, retention and restore check within the budget. An initial synthetic environment can be explicitly disposable; label that limitation and do not silently reset a pilot database.

DigitalOcean continues billing a powered-off VM; ending VM billing requires its removal [D3]. Removal is a later authorized teardown after verified exports, not part of this research. Alerts are advisory, not a provider-enforced all-in spending cap; control quantities, overages and actual spend.

## Implement in VTC-011

1. Confirm the separate account, selected region/bundle, final cost and owner-controlled test hostname; keep access details private. This plan does not create an account, subscription, server, DNS record or credential.
2. Prepare a reviewed repeatable server setup and Compose configuration: HTTPS reverse proxy, Node.js 24 application, real MySQL 8.4 and persistent private evidence. Keep MySQL on the internal network; expose only intended web routes. Pin maintained runtime/image patches and document resource limits.
3. Deploy the exact reviewed revision that passed CI to one shared staging environment. Use one protected GitHub Actions path over SSH, pinned host key and least-privilege deploy access; no deployment secrets in untrusted PR jobs. Automatic updates after successful main CI are the default; a manual reviewed-revision redeploy supports testing/rollback.
4. Keep migrations serialized. Verify readiness after switching the release and retain a compatible prior release; app rollback is separate from schema recovery. Preserve database/evidence across container recreation and server reboot.
5. Schedule the same bounded job CLI once per minute independently of HTTP requests; protect overlap through MySQL leases. Poll notifications every 30 seconds while visible. Measure chained-job delay against the accepted approximate healthy-operation 90-second target; surface backlog and preserve stale-toast suppression.
6. Prove HTTPS, actual Node/MySQL versions/settings, deployment failure recovery, database/file persistence, cron without web visitors, private-file authorization, and export/isolated restore. Record hosted test results separately from local/CI checks. Set mail to a local fake by default; real messages or identity-provider callbacks require their authorized test configuration.

No application, Compose file, workflow, probe artifact, account or hosted test has been implemented by this research. VTC-004 delivers the plan and ownership boundaries; VTC-005/006/008/009 define/test the runtime and CI, VTC-011 delivers staging, VTC-040 validates integrated journeys, and **VTC-041 performs the final Hostland compatibility/transfer work after VTC-040**. Hostland access is not required to complete the development architecture or deploy staging.

## Keep the final transfer possible

Use the same Node/MySQL families, explicit UTC/SQL modes/collations and portable application artifact across local/CI/staging. At VTC-041, compare actual Hostland patches/settings and test differences before cutover. Docker is a staging packaging choice, not a requirement on Hostland. Keep one standard Node HTTP entry, a standalone bounded jobs command, provider-neutral private file/mail adapters and recoverable MySQL/file exports. No development provider's successful run proves Passenger compatibility or the final annual price.

## Primary sources

- **D1:** [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets).
- **D2:** [DigitalOcean backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/).
- **D3:** [DigitalOcean billing, including powered-off VMs](https://docs.digitalocean.com/products/droplets/details/pricing/).
- **A1:** [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing/).
- **R1:** [Railway pricing](https://railway.com/pricing).
- **R2:** [Railway cron frequency](https://docs.railway.com/cron-jobs#frequency).
- **R3:** [Railway cost controls](https://docs.railway.com/pricing/cost-control).
