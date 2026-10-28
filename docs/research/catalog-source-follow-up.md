# VTC-002 — Catalog source and delivery hand-off

**Recorded:** 2026-10-17. This records the research outcome and concrete follow-up; it is not a legal determination or a claim that production imports are ready.

## Decisions and responsibilities

The owner approved both games and all official DLCs at the pinned launch baseline, project-maintained RU/EN labels with visible English fallback, and the following update responsibility split:

- The project's technical maintainer prepares source inventories, versioned data and change reports.
- The Director or Deputy Director reviews and publishes a catalog revision through the future administration workflow.
- Technical maintenance is an operational responsibility, **not a sixth dashboard role**. Application publication remains server-authorized and audited.

The owner also approved completing VTC-002 discovery with three explicitly unavailable ATS sources transferred to VTC-019. Louisiana, Illinois and South Dakota remain required launch coverage. Their absence must not reduce the scope or be represented as retired/nonexistent entities. The [coverage audit](dlc-coverage-2026-10-17.md) and [public baseline](data/official-dlc-baseline-2026-10-17.json) identify the exact observed gap.

## Research recommendation

Use first-party game definitions as the technical input for an offline, reviewed importer; persist versioned normalized facts in MySQL. VTC-005 finalizes the contracts and VTC-019 implements actual source/registry/include/overlay handling. The research proves access to representative fields and records coverage limits; it does not implement that importer.

Trucky is an optional comparison/mapping aid and is not required to operate the MVP catalog. Do not make production reliability depend on an undocumented quota, unverified reuse grant or assumed update SLA. No authenticated VTC integration, external account creation or paid API is needed for this discovery deliverable.

Maintain project-authored translations instead of redistributing a base-game localization corpus. The expanded DLC audit did not attempt deep/raw extraction or decoding of locale archives. A later approved translation source is replaceable behind the same label model.

## Current implementation hand-off — 2026-10-20

The owner's selected delivery scope is now authoritative in the [owner-approved source-use scope](../product/mvp-policies.md#catalog-source-use-basis). The historical source-provider questions below remain a record of the 2026-10-17 research, not a requirement to obtain a separate reply before this closed non-commercial use. No outreach or provider grant is claimed. Actual full-source preparation, reviewed private artifacts and current acceptance limits are recorded in the [catalog implementation guide](../development/catalogs.md#migration-and-evidence); public Git still excludes the corpus and bulk labels.

## Reuse verification result (historical 2026-10-17 finding)

The official [SCS extraction documentation](https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Extractor) establishes a modding tool, not a specific catalog distribution agreement. The [SCS video-sharing licence](https://www.scssoft.com/video_sharing_licence.pdf) addresses footage and does not establish a metadata/database licence. The SDK's code licence and the separate extractor's GPL-2.0 licence likewise do not settle rights in game-derived datasets. We found no source-specific permission that conclusively settles the planned catalog distribution in the materials inspected; this is not a statement that the use is prohibited.

This PR's deliverables are original code/synthetic examples, public release-title/ID inventory, aggregate observations and documentation. Extracted definitions, entity-label corpora, binaries, models, textures, translations and private diagnostics stay outside public Git. A public source inventory is separate from the actual game-derived catalog.

The 2026-10-17 hand-off required a documented use/attribution basis before bulk publication or production imports, and proposed source-provider clarification if that basis remained unresolved. The owner's later selected scope above supersedes the separate-reply prerequisite for this delivery. It does not establish an unverified provider grant or public bulk distribution right.

## Questions prepared for source verification

These questions are prepared for the owner; **no outreach has been sent** and no private account or installation information is needed.

For SCS, if clarification is required:

1. May a small community dashboard use a versioned, derived catalog of internal city/cargo/trailer identifiers, city-region relationships, body/chain types, ADR classification and unit mass, generated from an authorized game/DLC installation?
2. Are storing that normalized catalog on a VTC server, serving selector/validation responses to members and publishing a reusable derived JSON dataset treated differently? Our proposed public repository contains importer code and synthetic fixtures, not original definition files or assets.
3. What attribution and redistribution restrictions apply? The plan excludes models, textures, logos, map geometry and extracted localization dictionaries; display translations are project-maintained.
4. Is there a recommended supported metadata source or update mechanism for official DLCs and game builds?

For Trucky, only if a production city-data import is selected:

1. Are persistent caching, reviewed internal mapping and redistribution of city metadata permitted, and with what attribution?
2. What request limits, cache/revalidation policy and update cadence should a small VTC use?
3. Are provider IDs stable, how are missing SCS IDs handled, and is there a versioned official/mod/build/DLC coverage contract?

## Downstream acceptance gates

| Owner | Required evidence |
| --- | --- |
| VTC-005 | Final catalog/source/mapping contracts, per-game region/body/chain model, versioned import manifest and permission boundary for publication |
| VTC-019 | Authorized source evidence for all three ATS gaps; full launch release inventory; active-registry/include/overlay validation; checked per-pack contributions; permitted-use/attribution basis; reviewed English labels and versioned publication |
| VTC-020 | Director/deputy publication UI; reviewed Russian labels where available; visibly marked English fallback; selectors preserve canonical IDs |
| VTC-003/018/024 | Verified client/source-ID mapping and real missing-field/build-context behavior; a definition-unit token is not automatically a telemetry ID |
| VTC-042 | Launch checklist confirms all-official-DLC coverage for the actual launch baseline and all VTC-019 source gates; the research sample is insufficient release evidence |

VTC-002 is ready for documentation/code review once its sample, source comparison, measured coverage and hand-off checks pass. The common Definition of Done still requires resolved review and a merged PR. Research completion does not close VTC-019, perform a production import or relax the launch target.
