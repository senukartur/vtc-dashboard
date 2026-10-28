# VTC-002 — Game catalog source investigation

**Investigated:** 2026-10-17. **Status:** discovery result and executable experiments prepared for review. The owner approved all-official-DLC coverage, own translations/English fallback, director/deputy publication and transfer of the three unavailable ATS sources to VTC-019 before launch. This is not a published production catalog; review and merged delivery evidence remain required for VTC-002 Done.

**Card:** [VTC-002](https://trello.com/c/c32UL1jR/2-vtc-002-investigate-and-prototype-versioned-game-catalogs). **Policy:** [product policies](../product/mvp-policies.md#game-catalogs-and-localization). **Experiment:** [catalog spike](../../spikes/catalogs/README.md).

## Recommendation

Use a **local, versioned catalog derived from reviewed game definitions**, with project-maintained RU/EN labels and explicit provider mappings. Build/import it outside the production host, review the diff, then publish an immutable revision into MySQL through VTC-019. Forms and qualification checks read the local published revision; they do not depend on a live external catalog request.

Use Trucky's public city API as an optional comparison/mapping aid, subject to confirmed reuse conditions. It is insufficient as the authoritative combined city/cargo/trailer/localization source. Keep the SCS Telemetry SDK for identifying entities actually observed in a trip, not for enumerating the whole catalog. Unknown entities are durable ingestion/review cases, never evidence of a qualification violation.

The expanded [official DLC audit](dlc-coverage-2026-10-17.md) inspected archives associated with all 103 released Steam-listed ETS2 packs and 54 of 57 ATS packs, plus supplementary/base containers. The three ATS source gaps remain explicit production prerequisites in the [owner-approved hand-off](catalog-source-follow-up.md). Full launch catalog validation and reuse/distribution verification belong to VTC-019; archive inspection does not establish production completeness. The owner approved maintaining our own translations rather than depending on an unverified bilingual feed. No existing source examined here establishes a complete, current, freely redistributable RU/EN catalog of all three entity families.

## Source comparison

| Source | Useful coverage | Version/DLC/localization | Access, maintenance and constraints | Proposed use |
| --- | --- | --- | --- | --- |
| SCS game definitions with the official extractor | City/region units, cargo fields, trailer definitions/body/chain tokens; selected base and DLC archives verified locally | Exact installed game build and per-archive provenance can be recorded; display fields may be localization references | Requires an authorized installation and available archives. Re-run after game/DLC updates; engine includes and load order need real parsing. Tool availability does not establish permission to republish extracted data | Primary technical source, conditional on approved reuse and validated scope |
| Trucky public map API | City rows with provider IDs, display names, map coordinates and DLC/region labels | Missing game IDs, no RU/EN label map or game-build declaration in observed responses; mod content can appear | Two unauthenticated GETs returned 200. Use an identifying User-Agent, infrequent cached refreshes and retry limits. Reuse terms, numeric quota and update guarantees are unconfirmed | Secondary city comparison and reviewed provider mapping |
| SCS Telemetry SDK 1.15 | Current job city/cargo IDs and labels, actual cargo mass, trailer body/chain attributes | Observes played trips rather than exhaustive game/DLC coverage; received labels do not form a bilingual dictionary | Official SDK/header inspection, no gameplay/plugin change needed for this research. Desktop forwarding remains VTC-003/024 work | Trip identity/evidence input; not catalog enumeration |
| AlexOQ/trucker | First-party repository describes an ETS2/ATS definition parser, DLC mappings and version manifests | Inspected manifests declare mixed coverage for ATS; parser does not establish a complete RU/EN translation source | MIT code, but no blanket game-data permission inferred. No code/data copied or executed | Implementation reference and independent comparison, not a trusted import feed |
| truckermudgeon/maps | Map parser for ATS/ETS2; README claims official map-DLC support | Potential source of city/map extraction techniques; not verified here against these installations | GPL-3.0 code; native build requirements and maintenance effort. Not copied, installed or executed | Alternative parser research if map geometry or richer city data is needed |
| TruckersMP / TruckersHub public documentation | Identity, jobs, events and related platform data | No complete versioned RU/EN city/cargo/trailer catalog was confirmed in the inspected current documentation | TruckersHub's current REST guide describes VTC/token access. Older cargo-data announcements are not proof of a current supported catalog contract | Do not add an account/provider dependency without a demonstrated endpoint |

Sources: [SCS extractor](https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Extractor), [Trucky API documentation data](https://api.truckyapp.com/docs/api_data.js), [SCS SDK](https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry), [AlexOQ/trucker](https://github.com/AlexOQ/trucker), [TruckSim Maps](https://github.com/truckermudgeon/maps), [TruckersMP docs](https://github.com/TruckersMP/Docs), [TruckersHub API](https://docs.truckershub.in/api/).

## Trucky: live observations

The following measurements are from 2026-10-17, not an SLA or proof of game completeness. Requests used the project-identifying User-Agent shown in [probe-trucky.mjs](../../spikes/catalogs/probe-trucky.mjs), without tokens. The documentation advertises the two city endpoints and `/v2/map/dlcs?game=:game`; no cargo/trailer catalog endpoint was found among its 43 documented entries. The separate VTC Hub API is a different interface and was not authenticated or exhaustively tested.

| Observed property | ETS2 | ATS |
| --- | --- | --- |
| Endpoint | [/v2/map/cities/ets2](https://api.truckyapp.com/v2/map/cities/ets2) | [/v2/map/cities/ats](https://api.truckyapp.com/v2/map/cities/ats) |
| HTTP status / rows | 200 / 372 | 200 / 304 |
| Missing or empty `in_game_id` | 102 | 291 |
| Nonempty game IDs with duplicate values in this response | 0 | 0 |
| RU/EN translation-map fields / game-version fields | None observed | None observed |
| Other observed limitation | One name has surrounding whitespace | Includes a `Promods Canada` DLC label despite empty `mod` fields |

Both responses contain `_id`, `realName`, `x`, `z`, `game`, `type`, `country`, `dlc`, `mod`, and sometimes `in_game_id`. Treat `_id` as a Trucky identity, not an SCS identity. Treat `country` as provider region text: in ATS it includes state/province values. Do not assume `x`/`z` are latitude/longitude or classify official content merely from an empty `mod` property.

Observed JSON SHA-256 fingerprints (UTF-8 `JSON.stringify` of the parsed response):

- ETS2: `48eb2e26fba5cdfe3d9bbd6692d79c52e472be96cae2d7e4b5940688c4a65685`.
- ATS: `d308229515710c7fc00375ca20178a83e0d3fe135f836413f535b83d85633d28`.

The provider requests descriptive User-Agents and warns against excessive calls/scraping in its [integrator guidance](https://truckyapp.com/blog/announcements/a-message-for-trucky-integrators/). Its [platform terms page](https://truckyapp.com/platform-terms-and-conditions/) did not expose a usable data-redistribution/cache licence in the inspected response. Ask about permitted persistent caching, redistribution, attribution, rate limits, update cadence, build coverage and game-ID stability before a production import. No message was sent to the provider.

## Local extraction experiment

With owner-provided installation access, the official `scs_extractor_1_55.zip` was downloaded from SCS and used only to read selected archives into ignored local storage. Installed game files were not modified, no game/save/profile was started or parsed, and no DLC was purchased. Raw definitions, binaries, source archives, translations and local installation paths are excluded from this public deliverable.

Extractor source: [official download](https://download.eurotrucksimulator2.com/scs_extractor_1_55.zip). Download SHA-256: `45385795fa830b975bd5c80a2076e17fa8398d8d23d679325e3b89b528b0229c`. This records the tested binary archive; it is not a publisher-signed integrity assertion. SCS documents [HashFS v1/v2 extraction](https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Packer); tool/archive compatibility must be rechecked for future builds.

Both executable product versions agreed with the extracted `version.sii`: **ETS2 1.61.1.9**, **ATS 1.61.3.18**. These are the tested installations, not a claim about the newest public release.

| Game/build | Extracted subset | City candidates | Cargo candidates | Trailer-definition candidates |
| --- | --- | --- | --- | --- |
| ETS2 1.61.1.9 | `def.scs` | 81 | 326 | 320 |
| ETS2 1.61.1.9 | `dlc_east.scs` (Going East!) | 16 | 0 | 0 |
| ETS2 1.61.1.9 | `dlc_heavy_cargo.scs` | 0 | 11 | 0 |
| ATS 1.61.3.18 | `def.scs` | 29 | 225 | 368 |
| ATS 1.61.3.18 | `dlc_heavy_cargo.scs` | 0 | 13 | 0 |

These are **raw unit candidates in inspected directories**, not counts of active or playable entities. The inventory does not resolve includes or load order. For example, ETS2 `city.sii` references 80 includes while the directory contains 81 `city_data` units; official seasonal/custom registry files also exist. A file named `mod_*` within an official archive does not establish that it is a third-party mod. Production import must inspect the supported game's registries/mount context instead of importing every file or excluding everything by filename.

This table records the initial official-extractor experiment. A subsequent selective-tool run inspected all 180 selected available archive inventories and extracted filtered definitions from 88 candidate-bearing archives; the complete per-pack evidence and limitations are in the [expanded audit](dlc-coverage-2026-10-17.md). The initial map and cargo DLCs each contain their own include registry, proving a practical source for additions and pack provenance. Base-map reachability and archive overlays are not fully validated. Presence of a definition, an archive or shared dependency does not alone establish player ownership, availability in a particular profile, or current job-market eligibility.

For reproducibility, [inspect-definitions.mjs](../../spikes/catalogs/inspect-definitions.mjs) reads an extracted `def` directory and reports candidate counts, classification tokens, registry include counts and a content fingerprint, without emitting local paths or copying labels. Record full archive hashes, build, extractor revision, selected archives and load order privately for a production import; VTC-019 must resolve that manifest and validate coverage.

## What the game definitions provide

The [SCS game-data layout](https://modding.scssoft.com/wiki/Documentation/Engine/Game_data) documents city/country/cargo registries. The experiment confirmed city units with a source token, literal name, localization reference and region reference. In ATS the game's country-style structure can represent a state; the dashboard needs a generic region model with optional parent/ISO metadata, not an assumption that every region is a sovereign country.

The card's company/depot context is available in the same definition family: the inspected base subsets contain a company registry and 138 ETS2 / 218 ATS `company_permanent` unit candidates. These are not validated counts of active depots. Company identity, localized display names and city-specific depot instances must remain distinct if later manual forms or matching use them.

[Cargo definitions](https://modding.scssoft.com/wiki/Documentation/Engine/Units/cargo_data) expose display references, ADR/Hazardous Materials classification, compatible body types and **unit** mass/volume. The inspector observed hazardous-class tokens 1, 2, 3, 4, 6 and 8 in each tested base definition subset. Do not derive a shipment's actual mass from the cargo unit mass alone or infer a confirmed non-hazardous classification from an unparsed/missing field. Game field defaults and ATS terminology require explicit adapter rules and fixtures.

[SCS's trailer model](https://modding.scssoft.com/wiki/Games/ETS2/Modding_guides/1.32) separates a body type from a chain/configuration. Retain those dimensions separately. The experiment observed **`b_double` in ETS2 and `bdouble` in ATS**; do not assume cross-game token equivalence. Named brand/models, body categories, chains and freight/cargo-market configurations are different entities. A body-compatible cargo is not automatically an available job or proof of an authorized company load.

Keep source-unit names and telemetry IDs as separate mapping domains until verified. An extracted unit such as `city.<token>` must not be equated to an SDK/provider city ID by a global string-prefix trick. VTC-003/018 must prove the emitted identity and missing-field behavior using real client records.

## Localization result and approved fallback

The [SCS localization guide](https://modding.scssoft.com/wiki/Games/ETS2/Modding_guides/1.33) documents localized city/country attributes, `@@...@@` keys and per-language localization modules. However, the official extractor **failed for `locale.scs` in both tested builds**, reporting a missing archive root. No RU/EN base-game dictionary was extracted, and no alternative unpacker/decoder was used. This is a measured limitation; the mod-localization documentation is not proof that the installed base dictionary is directly readable.

Owner-approved MVP approach (2026-10-17): author/review dashboard labels independently, start from literal city endonyms where appropriate, and keep translations in separate per-locale records. Complete Russian translation is not a launch prerequisite. Product `en`/`ru` map to an explicitly selected source locale (for example `en_gb` versus `en_us`, and `ru_ru`) if an approved translation import becomes available. Cargo tokens without a readable label enter a translation queue. An unknown key must not appear as a finished translation.

The approved display fallback is explicit: requested locale → reviewed English label, with a visible missing-translation indication. A missing English label remains a catalog-completeness issue; a source label/token can be shown diagnostically in unresolved-record review, not presented as a completed English translation. A fallback is not a trusted matching alias. The synthetic prototype demonstrates this without claiming bilingual production coverage. Provider permission, SCS clarification or another demonstrably reusable translation source could replace manual maintenance, but none is currently verified. No copied translation corpus is committed.

## Identity and snapshot model for VTC-005

This is a proposed discovery model, not a finalized application/schema contract:

- Keep an opaque canonical entity ID, with game, entity kind, map namespace and explicit source-ID mappings. Scope external IDs by provider and game/map; use byte-exact comparison. Preserve the original provider value.
- Store region relationships, source definition identifiers, label keys, reviewed RU/EN labels/aliases, retirement state and per-field provenance. Separate body types, chain types and optional concrete trailer definitions. Do not flatten all trailers into a translated string.
- Record snapshot ID, game build, archive/source hashes, extraction/importer version, tested map/DLC coverage, locale coverage, licensing/attribution evidence, publication date and reviewer. Distinguish unknown coverage from an explicitly tested absence.
- Store DLC membership/availability separately from identity; a source may require multiple packs or provide alternate ways to obtain an entity. Keep the owning pack, dependency/override facts and tested coverage rather than inventing one DLC per row.
- Keep rules and historical trips pinned to the facts/mappings used for the decision. An import must not silently relabel/reclassify an already adjudicated trip or mutate a published snapshot.

For a name-only source, use NFC normalization, whitespace normalization and case-insensitive **label** lookup within known game/kind/map/locale/region. Keep accents and transliteration differences unless a reviewed alias explicitly bridges them. Multiple matches return ambiguity. IDs are never lowercased/trimmed as if they were labels. An unknown explicit source ID does not become trusted just because its accompanying label resembles a known city.

## Update and publication workflow

1. A designated catalog maintainer notices a game patch or map/cargo/trailer DLC release. Track the installed/tested build and publish freshness in the dashboard; do not equate a release announcement with imported coverage.
2. On an authorized workstation, record a reproducible selected-archive manifest, extract into a new private directory, preserve per-archive provenance, and resolve the actual supported registry/include/mount behavior. Never depend on arbitrary alphabetical last-write-wins or mix unlabelled data from different builds.
3. Produce a draft normalized snapshot and translation queue. Validate unique scoped IDs, references, units, body/ADR/chain mappings, registry reachability, provider mapping ambiguity and coverage. Keep unresolved records marked as such.
4. Diff against the published revision: additions, label/fact changes, source-ID changes, potential retirements and mapping conflicts. **A missing DLC/archive, failed extraction or narrower source scope is not an entity retirement.** Withhold affected data from automatic publication rather than erasing historical entities.
5. The technical maintainer prepares the update; the Director or Deputy Director reviews the changes and missing translations and publishes the revision. Publish transactionally in MySQL through VTC-019; preserve earlier revisions. Technical maintenance is not a new dashboard role. Deployment only needs a compact reviewed import artifact, not Steam, game archives or native extraction tools on Hostland.
6. New trips use the selected compatible catalog context; older/unknown builds and unresolved identities follow the documented review path. Reprocessing accepted trips uses the existing human-reviewed correction policy. Keep last-known published data available during provider/import failure.

## Approved MVP coverage and remaining verification

The owner confirmed on 2026-10-17: target **both stock games and all official DLCs for ETS2 and ATS at the pinned launch build/release baseline**, not just the packs used by the VTC. Verify map, cargo and trailer-pack contributions and record other official packs as checked/non-contributing when they add no catalog entities. Arbitrary mods, scenery-only places and complete market-route generation remain outside the catalog scope. Official DLC coverage must not be silently narrowed to the available local archives. This does not limit future adapters: an unrecognized DLC city/cargo still retains its raw source identity and reaches review.

The [release inventory](data/official-dlc-baseline-2026-10-17.json) distinguishes inspected sources, three unavailable released ATS packs and nine upcoming products. The owner approved transferring the three unavailable source checks to VTC-019. Do not claim the approved full-DLC target has been achieved until every launch-baseline pack's contribution, identifiers, rules-relevant facts and usable English labels have been verified. Missing Russian labels may use the approved visible fallback. Obtaining additional authorized source access is a prerequisite, not permission to purchase DLC. A per-snapshot coverage manifest can expand without changing user/trip identity. Later DLC releases enter the update workflow rather than an unbounded promise about future content.

| Outstanding item | Proposed owner / next step | Gate |
| --- | --- | --- |
| Reuse of extracted metadata, provider data and translations | Owner selects a permitted source/distribution arrangement; prepare narrowly scoped questions for SCS/Trucky if needed. No outreach sent | Production import and public/shared data artifact |
| All-official-DLC launch validation | Discovery inventory recorded; VTC-019 resolves Louisiana/Illinois/South Dakota sources and validates every launch-baseline pack. Technical maintainer prepares updates; director/deputy publishes | VTC-019 production import and VTC-042 release; owner approved the discovery hand-off |
| Production labels and translation queue | Own translations and explicit English fallback approved; prepare reviewed English labels, available Russian labels and visible fallback indicators | Production sample and VTC-020 UI acceptance; complete Russian coverage is not required |
| SDK IDs, build/map context and trailer/ADR completeness | VTC-003/018/024 compare observed client fields to definition IDs | Trusted automatic mapping and qualification evaluation |
| Production parser and import contract | VTC-005 defines interfaces; VTC-019 implements real SII include/registry/overlay handling and transactional publication | Catalog implementation |

## Verification and card evidence

Completed here: live Trucky shape/quality comparison; official SDK/header inspection; successful selected definition/DLC extraction; measured localization failure; a proposed source/update/coverage model; a synthetic ETS2/ATS dataset with RU/EN city-region, hazardous/body and chain examples; and an executable normalization/diff experiment.

A representative real-field sample was also assembled privately for both tested games: eight source-entity examples spanning city, referenced region, hazardous cargo and compatible trailer definition. City-region references, cargo classification/body/unit mass and trailer body/chain compatibility were checked against the extracted source corpus. The bilingual descriptions in that sample are project-authored illustrative labels, not verified production cargo translations or a copied localization dictionary. No real-field sample is redistributed in this PR; the public synthetic sample exercises the same shape and failure cases.

The **14 offline experiment checks passed** on Node.js 24.19.0: the original nine cover RU/EN identity, region ambiguity, game-scoped IDs, exact-ID/unknown handling, map/kind/locale isolation, missing-translation fallback, draft changes, incomplete-DLC protection and actual versus unit mass. Five additional release-audit checks cover unavailable/upcoming packs, missing mappings, failed inspection, multi-archive packs and unverified metadata/path boundaries. These do not test a production SII parser, database, complete real catalog or application.

VTC-002's discovery criteria are ready for review: source comparison, executable sample, exact tested builds, exhaustive observed release inventory, explicit gaps and the update/ownership hand-off are documented. The owner approved passing the three unavailable ATS checks to VTC-019. Source/distribution verification, full production import validation and label preparation remain named VTC-019/release gates rather than claims of completed discovery implementation. The [hand-off](catalog-source-follow-up.md) includes prepared source-verification questions; no outreach was sent. Review and merged PR evidence are still required for Done. Fixtures are project-authored and synthetic; raw evidence stays ignored. See [experiment limitations and commands](../../spikes/catalogs/README.md).

## Additional pinned references

- [SCS SDK 1.15 archive](https://download.eurotrucksimulator2.com/scs_sdk_1_15.zip): inspected `readme.txt`, `sdk_license.txt` and common configuration headers. SDK code licensing is separate from the game-definition/localization data question.
- [AlexOQ/trucker inspected revision](https://github.com/AlexOQ/trucker/tree/414d5c85d0d844f061db49c6a3b669b7c72a6203): ETS2 manifest declares 1.61.1.1; ATS declares 1.61.3.1 with some carried-forward city data from 1.60.1.8. These are maintainer claims, not our validation or today's coverage guarantee. No dependency was added.
- [TruckersMP OpenAPI inspected revision](https://github.com/TruckersMP/Docs/blob/a4beb9653b9af24ce04169a368ab776c7930540c/openapi/OpenAPI-v2.yml): no general game-catalog contract established by this inspection. Event city fields do not constitute an enumerated catalog.
