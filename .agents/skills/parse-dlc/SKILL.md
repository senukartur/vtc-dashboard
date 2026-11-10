---
name: parse-dlc
description: Build private VTCDashboard catalog import files (DLCs, regions, cities, companies, depots, cargo, trailers and company logos) for one ETS2 or ATS DLC from the locally installed game. Use when a DLC is released or updated and its rows must be added to the catalogs.
---

# Parse DLC

Turns one installed ETS2/ATS DLC into the import files described in the [catalog notes](../../../docs/development/catalogs.md#editing-and-import). The script reads the game's own definitions, so codes match telemetry byte for byte. Names come from the game's English and Russian localization.

## Rules

- The output is game-derived. Write it only under `.local/catalogs/` (ignored by Git). Never commit it, attach it to a PR or issue, or put it in fixtures or the web bundle. See the [agent rules](../../../docs/development/agent-rules.md) on game data.
- Building the files changes nothing anywhere. Importing them into a host is a separate step. Each host import needs the owner's approval, and the owner or an agent with the owner's go-ahead does it through the catalog page.
- Codes come only from installed archives. Wikis, the SCS blog and store pages give names, never codes. If the DLC is not installed, ask the owner to install it and wait.
- Don't download the extractor or anything else without the owner's approval.

## Inputs

- **DLC:** the user's name for it (`Iceland`), the archive (`dlc_iceland`), the manifest id or the Steam app id. Run `list` when it is unclear.
- **Game:** `ets2` or `ats`. Infer it from the DLC when it is obvious; otherwise ask.
- **Game folder:** found from Steam's `libraryfolders.vdf`. Pass `--game-dir` (or set `ETS2_DIR`/`ATS_DIR`) if it isn't found.
- **Extractor:** [sk-zk Extractor](https://github.com/sk-zk/Extractor), via `--extractor <path>` or `SCS_EXTRACTOR`. Look for an existing copy under `.local/` first. If there is none, ask the owner.
- **Known rows** (optional, recommended): `--known <dir>`, repeatable. Point it at folders with earlier import files named `<list>.csv` or `<list>.json` (`dlc.csv`, `cities.csv`, `companies.csv` and so on). Rows found there are treated as already on the host. Base-game parents are then left out, and references outside the DLC are checked. Without `--known`, every referenced base-game row is emitted again, which is harmless: an import matches by code.

## Run

From the repository root (Node 24, no install needed):

```bash
node .agents/skills/parse-dlc/scripts/parse-dlc.mjs list --game ets2
node .agents/skills/parse-dlc/scripts/parse-dlc.mjs build --game ets2 --dlc iceland --out .local/catalogs/iceland-<date> --known .local/catalogs/<earlier set>
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

Rows the DLC itself defines are always emitted, even when known; their import refreshes names, for example by adding Russian ones. `dlc_code` is the DLC's code for rows the DLC defines, and blank for base-game rows; a blank cell keeps the host's value. Depot cargo defined nowhere is only reported, since no row depends on it.

`<out>/report.json` and stdout give the following. Exit code 1 means failures, 2 means bad input.

- counts per list, and how many of them are `alreadyKnown`;
- the base-game rows;
- missing logos;
- `warnings` and `failures`.

## Review before handing over

1. **Failures** must be zero. A row "not in this DLC or the base game" belongs to another DLC: pass that DLC's earlier import as `--known`, or build that DLC first.
2. **DLC name:** `name_en` is built as `<game title> - <manifest display name>`, matching the existing Steam-style names. Check it against the Steam store title and fix it with `--name-en` if needed.
3. **Warnings:** cities without a Russian name or with only a map name, logos not found, body types without a localized name. Mention them; staff can fill them in later in the form.
4. **Spot-check:** a few cities against the in-game map, and that the region codes exist.
5. **Optional:** for a stricter check, run the files through the importer's own parser (`readImportFile`, `validCode` and `inspectPng` in `apps/api/src/modules/catalogs/`) from a disposable worktree of `main`.

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
