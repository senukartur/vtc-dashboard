---
name: parse-dlc
description: Build private VTCDashboard catalog import files (DLCs, regions, cities, companies, depots, cargo, trailers and company logos) for one ETS2 or ATS DLC from the locally installed game. Use when a DLC is released or updated and its rows must be added to the catalogs.
---

# Parse DLC

Turns one installed ETS2/ATS DLC into the import files described in the [catalog notes](../../../docs/development/catalogs.md#editing-and-import). The script reads the game's own definitions, so codes match telemetry byte for byte. Names come from the game's English and Russian localization.

## Rules

- The output is game-derived. Write it only under `.local/catalogs/` (ignored by Git). The script refuses an `--out` or `--cache` inside the repository that Git would track. Never commit it, attach it to a PR or issue, or put it in fixtures or the web bundle. See the [agent rules](../../../docs/development/agent-rules.md) on game data.
- Building the files changes nothing anywhere. Importing them into a host is a separate step. Each host import needs the owner's approval, and the owner or an agent with the owner's go-ahead does it through the catalog page.
- Codes come only from installed archives. Wikis, the SCS blog and store pages give names, never codes. If the DLC is not installed, ask the owner to install it and wait.
- Don't download the extractor or anything else without the owner's approval.

## Inputs

- **DLC:** the user's name for it (`Iceland`), the archive (`dlc_iceland`), the manifest id or the Steam app id. Run `list` when it is unclear.
- **Game:** `ets2` or `ats`. Infer it from the DLC when it is obvious; otherwise ask.
- **Game folder:** found from Steam's `libraryfolders.vdf`. Pass `--game-dir` (or set `ETS2_DIR`/`ATS_DIR`) if it isn't found.
- **Extractor:** [sk-zk Extractor](https://github.com/sk-zk/Extractor), via `--extractor <path>` or `SCS_EXTRACTOR`. Look for an existing copy under `.local/` first. If there is none, ask the owner.
- **Region evidence:** `--region-evidence <private evidence.json>` is required by `build`. Survey the complete installed base/map pack registration inventory using the audit format below. Country labels in `def.scs` are shared metadata, not proof that a region is playable in the base game.
- **Known rows** (optional, recommended): `--known <dir>`, repeatable. Point it at folders with earlier import files named `<list>.csv` or `<list>.json` (`dlc.csv`, `cities.csv`, `companies.csv` and so on). Rows found there are treated as already on the host. Base-game parents are then left out, and references outside the DLC are checked. Without `--known`, every referenced base-game row is emitted again, which is harmless: an import matches by code.

## Run

From the repository root (Node 24, no install needed):

```bash
node .agents/skills/parse-dlc/scripts/parse-dlc.mjs list --game ets2
node .agents/skills/parse-dlc/scripts/parse-dlc.mjs build --game ets2 --dlc iceland --region-evidence .local/catalogs/<survey>/evidence.json --out .local/catalogs/iceland-<date> --known .local/catalogs/<earlier set>
```

`build` extracts the following into `.local/catalogs/parse-dlc-cache/<game>/` (`--cache <dir>` to change). The cache is shared between DLCs; after a game update, pass `--fresh` to re-extract:

- the DLC's `/def`, `/locale` and company logos;
- base `def.scs`;
- the English and Russian `localization.sui`, `local.sii` and `local.override.sii` from `locale.scs` (ATS city names are in the override);
- logos from `base.scs` or another DLC when the DLC doesn't ship its own.

It writes the following to `<out>/import/`:

| File | Rows |
| --- | --- |
| `dlcs.csv` | The DLC: `dlc.<steam app id>`, or `supplemental.<manifest id>` for a package bundled with the game (no app id, or the game's own). A known `supplemental.<id>` row wins over `dlc.<id>` |
| `regions.csv` | Countries/states of the emitted cities that aren't known yet |
| `cities.csv` | Cities the DLC registers, plus base-game cities its depots use that aren't known |
| `companies.csv` | Companies the DLC registers, plus base-game companies its depots use that aren't known |
| `depots.csv` | Every company/city pair under the DLC's `def/company/*/editor/`, all with the DLC's `dlc_code` |
| `cargoes.csv` | Cargo the DLC registers, plus depot cargo from the base game that isn't known |
| `trailers.csv` | Body types from the DLC's trailers and cargo that aren't known, named by the game's localization |
| `logos/<code>.png` | Logos of the emitted companies, 128x32 PNG |

Unquoted game tokens such as `country: Hungary` are lowercased, as the game compares them case-insensitively. Include paths starting with `/` resolve from the archive root. Only one run can use a cache at a time: a stale `.lock` in it after a crash can be deleted.

Rows the DLC itself defines are always emitted, even when known; their import refreshes names, for example by adding Russian ones. `dlc_code` is the DLC's code for rows the DLC defines, and blank for base-game rows. Regions instead use verified active city registration evidence as described below; a blank cell keeps the host's value. Depot cargo defined nowhere is only reported, since no row depends on it.

`<out>/report.json` and stdout give the following. Exit code 1 means failures, 2 means bad input.

- counts per list, and how many of them are `alreadyKnown`;
- the proven base-game rows;
- `regionEvidence` completeness/gaps/conflicts and `regionSources` statuses, base presence and DLC contributor candidates (including known regions);
- missing logos;
- `warnings` and `failures`.

## Review before handing over

1. **Failures** must be zero. A row "not in this DLC or the base game" belongs to another DLC: pass that DLC's earlier import as `--known`, or build that DLC first.
2. **DLC name:** `name_en` is built as `<game title> - <manifest display name>`, matching the existing Steam-style names. Check it against the Steam store title and fix it with `--name-en` if needed.
3. **Warnings:** cities without a Russian name or with only a map name, logos not found, body types without a localized name. Mention them; staff can fill them in later in the form.
4. **Spot-check:** a few cities against the in-game map, and that the region codes exist.
5. **Optional:** for a stricter check, run the files through the importer's own parser (`readImportFile`, `validCode` and `inspectPng` in `apps/api/src/modules/catalogs/`) from a disposable worktree of `main`.

## Region source survey and private correction

Use already-extracted archive roots; `audit-regions` needs no extractor, installed game lookup or dependencies. Extract only authorized local archives, keeping the entire `/def` tree, each pack manifest and every active include target outside `/def` private. Survey archive inventories for such include targets; an absent custom registration hook is a coverage gap until its actual contents are extracted. Record the complete installed archive inventory separately, including surveyed packs with no city registrations. Never treat an unextracted pack as city-free. The `coverage.complete` assertion means every base archive and installed pack has been surveyed for active registrations; the script also checks every expected pack and the explicit registration lists against the extracted roots.

Run from the repository root:

```powershell
node .agents/skills/parse-dlc/scripts/parse-dlc.mjs audit-regions --game ets2 --region-evidence .local/catalogs/<survey>/evidence.json --hosted .local/catalogs/<survey>/hosted.json --out .local/catalogs/<new-audit-directory>
```

Evidence JSON format (all examples are fictional):

```json
{
  "schemaVersion": 1,
  "game": "ets2",
  "coverage": { "complete": true, "expectedPacks": ["base", "dlc_fictional"] },
  "packs": [
    { "id": "base", "root": "./extracted/base", "registrations": ["def/city.sii"] },
    {
      "id": "dlc_fictional", "root": "./extracted/dlc_fictional",
      "manifest": "dlc_fictional.manifest.sii", "dlcCode": "dlc.900001",
      "registrations": ["def/city.fictional.sii"]
    }
  ]
}
```

Roots resolve relative to the evidence file; use absolute paths when practical. A base pack may use `roots: ["<def archive root>", "<other core archive root>"]` instead of `root`. Supply each active `def/city[.<suffix>].sii` path explicitly; `registrations: []` means an extracted, surveyed city-free DLC pack. Both games require a nonempty active base registration inventory and at least one validated registered base city; an empty or wrong base root leaves the entire survey incomplete even when `coverage.complete` is true. Only registered `city_data` units and their includes count. Includes use the registering pack's root first and fall back to surveyed shared roots; conflicting shared files cannot be resolved by root order. Missing includes, unsupported city definitions, unsurveyed packs and missing metadata leave completeness false. Paths cannot escape roots.

DLC identities are checked against the manifest's whitelisted `id` and `steam_app_id`; the code must equal its exact `dlc.<app id>` or `supplemental.<manifest id>` identity. Use the inspected host's existing supplemental identity when appropriate. Manifest display names never identify a pack. Do not publish raw manifests, extracted definitions or the private evidence/report.

Resolution is deterministic: verified base city presence gives `base-present` (DLC contributions remain reported); one verified DLC contributor under complete coverage gives `unique-dlc`; multiple DLC contributors without base presence or conflicting identity/country evidence give `ambiguous`; missing registrations/coverage/metadata give `unresolved`. An optional `primarySources` array may resolve a reviewed split region, for example `[{"code":"fictional_region","dlcCode":"dlc.900001","reason":"Owner-reviewed fictional primary"}]`. It is an explicit product decision, not evidence inferred from archive/city order. Every mapping requires complete conflict-free coverage, multiple observed DLC contributors, no base presence, a source among those contributors and one nonblank review reason. Duplicate/conflicting mappings, absent contributors and incomplete surveys are rejected. The resolver reports `primary-dlc` and `primaryReason`, retaining all contributors; cities retain their own expansion source. Without an approved mapping the split stays ambiguous. Keep real mappings private.

A new ambiguous/unresolved region fails `build` and is omitted, never emitted with a blank source meaning Base game. A known region is preserved with explicit diagnostics; `--known` is not availability evidence. `build` checks that every emitted city's registration is represented in the supplied evidence.

The inspected hosted JSON has `game`, `regions` and `dlcs` arrays:

```json
{
  "game": "ets2",
  "regions": [{ "code": "fictional_region", "name_en": "Exact hosted English name", "name_ru": "Сохранённое имя", "dlc_code": "", "hidden": false }],
  "dlcs": [{ "code": "dlc.900001", "hidden": false }]
}
```

Capture current rows including hidden/seasonal regions and source metadata from the intended host. `dlc_code` may be empty or null for base. Preserve exact codes, English and Russian names; do not substitute fresh game labels. DLC `hidden` is required, and all rows belong to the selected game. The audit writes a private `report.json` with every inspected region's outcome, candidates, completeness, gaps and exclusions, plus `regions.csv` and its SHA-256. It refuses to overwrite an existing output directory. Stdout contains counts/checksum only.

Only inspected existing `unique-dlc` or explicitly reviewed `primary-dlc` corrections with an existing visible same-game DLC parent enter the five-column CSV. IDs, city links and visibility are not imported; exact hosted names are repeated because the importer requires a nonblank English name. Already-correct rows, ambiguous/unknown regions and missing/hidden parents are excluded explicitly. A proven base region with an existing nonblank source is also excluded: a blank CSV preserves it and cannot clear it. Review that correction separately in the form.

Before any owner-approved hosted apply, preview the exact bytes: **added=0, errors=0, only `dlc_code` changed**. Stop on any unexpected name, row, parent or count. Apply those same bytes, then preview/apply identical bytes as a fresh operation with a new key: **added=0, changed=0**, every row unchanged and timestamps stable. Record private counts/checksums/exclusions. Inspect both games in RU/EN: corrected regions enter the DLC filter and leave Base game, proven base regions stay base, existing city/region selection IDs stay stable. Preparing output grants no hosted-import authority.

## Import order

Each list's preview fails on a parent it can't find, so import in this order:

1. DLCs
2. Regions
3. Cities
4. Companies
5. Depots
6. Cargo
7. Trailers
8. Company logos: bulk upload of `logos/` per game, at most 500 files

On each list, preview first and apply only with zero errors. Report the counts the host shows after applying.
