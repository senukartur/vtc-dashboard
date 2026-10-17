# VTC-002 catalog experiment

This isolated Node.js 24 experiment supports the [source investigation](../../docs/research/catalogs.md). It adds no application dependencies, database schema, production parser or CI workflow. VTC-005 owns final interfaces; VTC-019 owns the real importer.

## Offline example and checks

From the repository root:

```sh
node --test spikes/catalogs/*.test.mjs
```

[synthetic-catalog.mjs](synthetic-catalog.mjs) constructs two fictional revisions for ETS2/ATS with regions/cities, RU/EN labels, one deliberately missing translation, cargo unit mass/hazardous classification, trailer body and chain categories, and DLC/build coverage. No data was copied from a game, telemetry record or provider dataset.

The nine tests demonstrate label/identity separation, same-name ambiguity, exact scoped source IDs, a translation fallback, draft snapshot changes, a coverage-loss guard and actual shipment mass staying distinct from unit mass. A new fixture city appears only in the candidate revision; the old revision's cargo facts remain unchanged.

Five further [DLC-audit tests](dlc-coverage.test.mjs) verify that missing/failed/unmapped source evidence cannot pass as complete coverage, upcoming packs remain separate, and a multi-archive pack requires every mapped source. Fourteen checks run in total; none contacts Steam or reads installed games. [dlc-coverage.mjs](dlc-coverage.mjs) is a pure reconciliation helper, not an installed-DLC or licence-ownership detector. Its `availableArchiveCoverageComplete` result only describes mapped archive inspection within the supplied release inventory; it does not declare production catalog completeness.

The resolver is intentionally small: it has no persistent source-mapping registry, schema validator, date-effective mapping, locale-specific search index or production authorization. The diff uses structural JSON comparison; ordering-only changes may create false positives. It does not establish a real entity retirement or auto-publish anything. The synthetic `coverageComplete` flag is an assertion within a fixture, not an assessment of real game/DLC coverage.

## Read-only definition inventory

Obtain the compatible extractor from the [official SCS page](https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Extractor). Use a separate ignored/private output directory; do not extract into an installation or commit game files. Run against a legally available selected archive, then inspect its `def` directory:

```sh
scs_extractor archive.scs PRIVATE_OUTPUT_DIRECTORY
node spikes/catalogs/inspect-definitions.mjs ets2 PRIVATE_OUTPUT_DIRECTORY/def
```

The inspector reads immediate city/cargo/trailer-definition files and city/cargo registry include counts, then reports candidate counts/tokens and a subset content hash. It does not expand includes, check active registry reachability, merge base/DLC archives, resolve overrides/localizations or declare a complete catalog. It follows no symbolic-link directory entries. It writes nothing and suppresses local input paths in error reports.

Real commands were run against base definitions for ETS2 1.61.1.9 and ATS 1.61.3.18, plus selected map/heavy-cargo DLC subsets. The measured results and `locale.scs` extraction failure are documented in the investigation. The raw source trees stay in ignored local storage. Do not pass profiles, saves or unrelated private files to this experiment.

The expanded [DLC coverage audit](../../docs/research/dlc-coverage-2026-10-17.md) additionally used the externally downloaded [sk-zk/Extractor 2026-07-29](https://github.com/sk-zk/Extractor/releases/tag/2026-07-29) to list all selected archive paths and extract only filtered definition files. The tool/binary hash and per-pack measurements are pinned in the [public baseline](../../docs/research/data/official-dlc-baseline-2026-10-17.json). No native tool or extracted game data is vendored.

To reproduce source inspection with that separate tool, use private destinations and preserve each archive separately:

```sh
extractor GAME_DIRECTORY --all --list --quiet
extractor ARCHIVE.scs --partial=/def --filter="r/\.s(ii|ui)$/" --quiet --dest=PRIVATE_OUTPUT_DIRECTORY
```

The actual expanded run used a narrower path filter for registry/city/cargo/region/company/trailer-definition/body/chassis files. Resolve the current public Steam base-app DLC list and each listed app's release metadata, record an explicit app/archive mapping, and compare with local inspection results using the reconciliation helper. Preserve failed metadata lookups and missing mappings as gaps; reruns can differ when games or store listings change. Do not use these commands to decode locales, inspect saves, overwrite installations or publish extracted data.

## Optional public API observation

```sh
node spikes/catalogs/probe-trucky.mjs
```

This explicitly requests the two public city endpoints once each using an identifying User-Agent. It prints aggregate shape/coverage metadata and a parsed-JSON fingerprint, not city rows. It sends no credentials, does not retry, and is not part of offline tests. Respect provider caching/rate/reuse terms; do not run it for every form request or as a rapid polling job.
