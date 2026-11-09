# Game catalogs

[CONCEPT.MD](../CONCEPT.MD) and the [policies](../product/mvp-policies.md#game-catalogs-and-localization) set the scope: per-game DLCs, regions, cities, cargo and trailer types, kept by hand and refreshed by CSV/JSON import. There is no staged upload, revision, publication, source-trust or mapping-review process. VTC-084 replaces the earlier versioned catalog system; the [persistence notes](persistence.md#vtc-084-catalog-replacement) describe its one-way rollout.

The browser surface is described in [catalog-ui.md](catalog-ui.md).

## Lists and codes

Five tables hold one row per `(game, code)`: `catalog_dlcs`, `catalog_regions`, `catalog_cities`, `catalog_cargoes`, `catalog_trailers`. Names are `name_en` and optional `name_ru`; a missing Russian name falls back to English with a visible badge. `hidden` removes a row from new selections and leaves it readable for existing references and recognition. Rows are never deleted.

`code` is opaque telemetry text, compared byte-exact. It is never trimmed, rewritten or case-folded; uniqueness uses the same bytes, so codes that differ only by case or a trailing byte are different rows. Validation accepts at most 128 UTF-8 bytes of printable non-whitespace text.

| List | `code` carries | Notes |
| --- | --- | --- |
| DLCs | Stable pack code, unique per game | Optional Steam app ID. A row's DLC reference (`dlc_code` in imports) names the owning pack; blank means the base game. |
| Regions | The source region token | Links cities through `region_code`; not a telemetry key, so one region per code per game. |
| Cities | The telemetry city token | Optional `region_code` and `dlc_code`. A parent must exist in the same game. |
| Cargo | The telemetry cargo token | `adr_class` is one of `1,2,3,4,6,8`, or empty for non-hazardous cargo. |
| Trailers | The telemetry body type token | The list name stays "Trailers". Names come from staff or the import file; a name is never inferred from the token. |

**Couplings.** Trailers are identified by telemetry body type, not by trailer ID. A coupling takes its first trailer's type: `snapshot.trailers.items` index `0` `bodyType` is the one that resolves, other slots stay provenance, and a slot 0 body type that is unavailable stays unknown even if its `id` matches a row (no fallback). A coupling's other trailers are not checked against qualification limits.

## Recognition

The API has no game-build, map or source gate. `resolveInTransaction(game, kind, code)` looks up the exact row, hidden rows included. The telemetry adapter records resolved cargo ADR as a known class, `cargo_not_adr` for listed non-hazardous cargo (a complete rule context) and `cargo_adr_unknown` otherwise. A later change to a cargo's ADR class does not rewrite an earlier trip; each trip keeps the class it was evaluated with, and staff reading it see the current row name.

A row's source or region must be a visible same-game row; an unchanged link to a hidden parent stays valid, in the admin form and in import (`hidden_reference`). Manual selections and rule allowlists must name same-game rows. A hidden row can stay selected when it is unchanged but cannot be newly chosen (`CATALOG_SELECTION_HIDDEN`).

## Editing and import

`company.read` reads the lists; `qualifications.manage` writes them. Single-row edits use `POST`/`PATCH /admin/catalogs/{list}`, keep `game` immutable and take an `Idempotency-Key`. Imports are for refreshing many rows:

1. **Preview.** `POST …/import-previews` takes one CSV or JSON file (UTF-8, up to 8 MiB and 5000 rows; CSV follows RFC 4180) and writes nothing. It returns counts, the changed and error lines, and, when there are no errors, a token bound to the actor and file.
2. **Apply.** `POST …/imports` sends the same file, the token in `If-Match` and an `Idempotency-Key`. It re-validates and applies all rows or none in one transaction, serialized per list, and records one audit entry per import.

Rows match by `(game, code)`. An empty cell keeps the current value, so an import cannot clear a field; use the form for that. Imports never delete. File layout is the import header (any order) of `game,code,name_en,name_ru` plus `steam_app_id`, `region_code`, `adr_class` or `dlc_code` per list. JSON is an array of objects with the same keys.

## Configuration

`CATALOGS_ENABLED=true` and an independent 32-byte hex `CATALOGS_CURSOR_KEY` are the only settings. Old trust and limit settings are ignored by the app and retired by host activation. The public repository carries no game-derived values; real rows are loaded through the normal import on each host.
