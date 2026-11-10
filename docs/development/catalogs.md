# Game catalogs

[CONCEPT.MD](../CONCEPT.MD) and the [policies](../product/mvp-policies.md#game-catalogs-and-localization) set the scope: per-game DLCs, regions, cities, companies, cargo and trailer types, kept by hand and refreshed by CSV/JSON import. There is no staged upload, revision, publication, source-trust or mapping-review process. VTC-084 replaces the earlier versioned catalog system; the [persistence notes](persistence.md#vtc-084-catalog-replacement) describe its one-way rollout.

The browser surface is described in [catalog-ui.md](catalog-ui.md).

## Lists and codes

Six tables hold one row per `(game, code)`: `catalog_dlcs`, `catalog_regions`, `catalog_cities`, `catalog_companies`, `catalog_cargoes`, `catalog_trailers`. Names are `name_en` and optional `name_ru`; a missing Russian name falls back to English with a visible badge. `hidden` removes a row from new selections and leaves it readable for existing references and recognition. Rows are never deleted.

Cities also have an optional `name_native`, the canonical name as the game map writes it. It is for display and search only: recognition never reads it. A city without one displays as before. The value is trimmed on save, and an empty or blank value means no canonical name.

`code` is opaque telemetry text, compared byte-exact. It is never trimmed, rewritten or case-folded; uniqueness uses the same bytes, so codes that differ only by case or a trailing byte are different rows. Validation accepts at most 128 UTF-8 bytes of printable non-whitespace text.

| List | `code` carries | Notes |
| --- | --- | --- |
| DLCs | Stable pack code, unique per game | Optional Steam app ID. A row's DLC reference (`dlc_code` in imports) names the owning pack; blank means the base game. |
| Regions | The source region token | Links cities through `region_code`; not a telemetry key, so one region per code per game. |
| Cities | The telemetry city token | Optional `region_code`, `dlc_code` and `name_native`. A parent must exist in the same game. |
| Companies | The game's company token (the suffix of its permanent company unit) | Optional `dlc_code`. Only stored as an opaque `(game, code)`; no page matches telemetry company IDs to it yet. |
| Cargo | The telemetry cargo token | `adr_class` is one of `1,2,3,4,6,8`, or empty for non-hazardous cargo. |
| Trailers | The telemetry body type token | The list name stays "Trailers". Names come from staff or the import file; a name is never inferred from the token. |

**Couplings.** Trailers are identified by telemetry body type, not by trailer ID. A coupling takes its first trailer's type: `snapshot.trailers.items` index `0` `bodyType` is the one that resolves, other slots stay provenance, and a slot 0 body type that is unavailable stays unknown even if its `id` matches a row (no fallback). A coupling's other trailers are not checked against qualification limits.

## Recognition

The API has no game-build, map or source gate. `resolveInTransaction(game, kind, code)` looks up the exact row, hidden rows included, and uses only `(game, code)`: a city's names, canonical name included, never identify it. The telemetry adapter records resolved cargo ADR as a known class, `cargo_not_adr` for listed non-hazardous cargo (a complete rule context) and `cargo_adr_unknown` otherwise. A later change to a cargo's ADR class does not rewrite an earlier trip; each trip keeps the class it was evaluated with, and staff reading it see the current row name.

A row's source or region must be a visible same-game row; an unchanged link to a hidden parent stays valid, in the admin form and in import (`hidden_reference`). Manual selections and rule allowlists must name same-game rows. A hidden row can stay selected when it is unchanged but cannot be newly chosen (`CATALOG_SELECTION_HIDDEN`).

## Companies, depots and logos

A **depot** is one company operating in one city: `catalog_company_cities` (`id`, `game`, `company_id`, `city_id`, optional `dlc_id`, `hidden`), unique per `(company, city)`. Composite foreign keys keep the company, city and source in the depot's game, and nothing is deleted. A depot is read by default only when the depot, its company and its city are all visible; a hidden company or city cannot be newly linked, while an existing link stays valid (`hidden_reference` in imports). `GET /catalogs/depots` answers both questions a later page needs: `cityId` lists the companies in a city and `companyId` the cities of a company, ordered by company or city name for the requested language, then `id`. Creating or importing a duplicate pair is `CATALOG_CODE_CONFLICT`; other-game or hidden parents are `CATALOG_PARENT_INVALID`. Only the source and the hidden flag of a depot can change.

The frozen telemetry contract sends `companyId` and `companyName` for each place, and `companyId` is an opaque source ID like `cityId` and `cargoId`, so companies are keyed by exact `(game, code)` the same way. That a real `companyId` equals the code in a company file has not been checked against real telemetry; do it before any card starts recognizing companies, which this one does not.

A company's **logo** is one PNG in `catalog_company_logos` (no row means no logo). It is stored in a bounded MySQL row rather than on the filesystem: the images are tiny, the row commits atomically with its audit entry and the database export already covers it. The server checks every upload without a native decoder: PNG signature, chunk order and CRCs, `IHDR` first, `IEND` last, no trailing bytes, no interlacing, at most 32 KiB and 128 by 32 pixels, and image data that inflates to exactly the scanlines the header describes (bounded). The original bytes are kept; nothing is re-encoded. Lists carry only `logo: {version, byteLength}`, where `version` is the first 16 hex characters of the SHA-256, and never select the image.

- **Single:** `PUT`/`DELETE /admin/catalogs/companies/{id}/logo`. Removing a logo that is not there changes nothing and writes no audit entry.
- **Bulk:** `POST …/companies/logo-previews?game=` then `…/logo-imports?game=` take up to 500 files named `<company code>.png` (lowercase extension, a valid code, no path) and 16 MiB. The dry run lists unknown codes and invalid files per file (`line` is the file's position) and writes nothing; its token binds the actor, the game and the exact files. Apply revalidates every file inside the transaction and stores all or none; identical bytes count as unchanged.
- **Audit:** one entry per committed upload operation, `catalog.changed` for a single upload or removal and `catalog.imported` for a bulk apply. A replay by `Idempotency-Key` writes nothing.
- **Read:** `GET /catalogs/companies/{id}/logo?v=<version>` authorizes `company.read` on every request, including a conditional one, and only then answers `image/png` with a strong `ETag` (the SHA-256), `Vary: Cookie` and `nosniff`. `Cache-Control` is `private, max-age=86400` when `v` names the current version and `private, no-cache` otherwise, never `public`; `If-None-Match` gets 304. A logo cached by a browser can outlive a member's access for up to a day; this is accepted. A company without a logo answers 404 and the UI never asks for one.

The size, dimension and count limits are engineering bounds in `apps/api/src/modules/catalogs/config.ts`, not product policy, and need no configuration. The runtime database role needs `SELECT, INSERT, UPDATE` on the companies and depots tables and also `DELETE` on the logos table only; the [stage profile](../operations/development.md#stage-catalogs) lists them.

## Editing and import

`company.read` reads the lists; `qualifications.manage` writes them. Single-row edits use `POST`/`PATCH /admin/catalogs/{list}`, keep `game` immutable and take an `Idempotency-Key`. Imports are for refreshing many rows:

1. **Preview.** `POST …/import-previews` takes one CSV or JSON file (UTF-8, up to 8 MiB and 5000 rows; CSV follows RFC 4180) and writes nothing. It returns counts, the changed and error lines, and, when there are no errors, a token bound to the actor and file.
2. **Apply.** `POST …/imports` sends the same file, the token in `If-Match` and an `Idempotency-Key`. It re-validates and applies all rows or none in one transaction, serialized per list, and records one audit entry per import.

Rows match by `(game, code)`. An empty cell keeps the current value, so an import cannot clear a field; use the form for that. Imports never delete. File layout is the import header (any order) of `game,code,name_en,name_ru` plus `steam_app_id`, `region_code`, `adr_class` or `dlc_code` per list. Companies use `dlc_code`. Depots are imported at `/admin/catalogs/depots/import-previews` and `/imports` with `game,company_code,city_code,dlc_code`, match by `(game, company_code, city_code)`, resolve codes under a share lock and report the company code on each line. The optional `name_native` column for cities may be left out; a blank cell in it keeps the current value, and values are trimmed and at most 256 characters. JSON is an array of objects with the same keys.

Catalog search and the city autocomplete match names and code case-insensitively, in either interface language, through the database collation (`utf8mb4_0900_ai_ci`), so a term finds a name regardless of case and accents. `name_native` is searched for cities only. `LIKE` compares character by character, so a ligature and its expansion (ß/ss, æ/ae) are not guaranteed to match.

## Configuration

`CATALOGS_ENABLED=true` and an independent 32-byte hex `CATALOGS_CURSOR_KEY` are the only settings. Old trust and limit settings are ignored by the app and retired by host activation. The public repository carries no game-derived values; real rows are loaded through the normal import on each host.
