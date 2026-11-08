# Catalog administration and selectors

`/account/catalogs` is inside the authenticated member shell. Current `company.read` reads the lists; `qualifications.manage` adds, edits, hides, restores and imports. The page has the ETS2/ATS `SegmentedControl` named "Game", five tabs, one search field and source/region filters; the choices live in the URL so a link restores them. The [catalogs model](catalogs.md) covers rows, codes and import.

## Layout

The page follows the approved board for this screen: a table on desktop and tablet (name, Russian name, code, source, then region, ADR or Steam app ID per list, and row actions for staff) and a card list below 760px with actions behind one 40px button that opens a sheet. Staff add and import actions stay in the header on wide screens and move to a bottom bar on a phone. The trailers tab keeps the name "Trailers"; its form hint says the code is the telemetry body type and that a coupling counts as its first trailer's type.

Rows with no Russian name show the `EN · no translation` badge; hidden rows show a badge and leave the default view unless "Show hidden" is on. Without `company.read` the page renders only its heading and a notice and sends no catalog request. Without `qualifications.manage` every action is absent and no write route is called.

## Selectors

`apps/web/src/shared/catalog-selectors/` exports `CatalogSelector` and the runtime DTOs. A consumer passes game, kind (`city`, `cargo`, `trailer`), an optional region and the selected ID. The selector searches, pages and offers visible same-game rows; a row that is hidden or from another game stays readable as a kept selection, with its label, and leaves the option list. Enter in the search field never submits an enclosing form, and IME composition is respected. Locale changes labels only, never selected IDs.

Queries use the session's private no-store scope and generated DTO runtime schemas. A failed read shows an alert with Refresh. A selection whose row cannot be read keeps its ID and says so.

## Import flow

The dialog offers CSV and JSON templates per list and shows the exact columns, then checks a file through the preview route. Counts and per-line results appear with errors and changed fields; errors disable apply, and a truncated line list is called out. Apply sends the same file with the preview token in `If-Match`; the logical command keeps one idempotency key while the file and token are unchanged, so an uncertain retry cannot double-apply. A stale token asks the staff member to check the file again.

## Evidence and boundaries

Unit tests cover selector compatibility, fallback rules, URL filter parsing, template parity with the server's columns and RU/EN string parity. Browser tests cover RU/EN layout at desktop and phone widths, add/edit/hide/restore, import dry-run/apply, permissions, pending, error and empty states, and selector behavior. Run the pinned Docker launcher from [testing.md](testing.md). Exact outcomes per candidate SHA belong in the pull request.
