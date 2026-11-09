# Catalog administration and selectors

`/account/catalogs` is inside the authenticated member shell. Current `company.read` reads the lists; `qualifications.manage` adds, edits, hides, restores and imports. The page has the ETS2/ATS `SegmentedControl` named "Game", five tabs, one search field and source/region filters; the choices live in the URL so a link restores them. The [catalogs model](catalogs.md) covers rows, codes and import.

## Layout

The page follows the approved board for this screen: a table on desktop and tablet (name, Russian name, code, source, then region, ADR or Steam app ID per list, and row actions for staff) and a card list below 760px with actions behind one 40px button that opens a sheet. Staff add and import actions stay in the header on wide screens and move to a bottom bar on a phone. The trailers tab keeps the name "Trailers"; its form hint says the code is the telemetry body type and that a coupling counts as its first trailer's type.

Rows with no Russian name show the `EN · no translation` badge; hidden rows show a badge and leave the default view unless "Show hidden" is on. Without `company.read` the page renders only its heading and a notice and sends no catalog request. Without `qualifications.manage` every action is absent and no write route is called.

## Selectors

`apps/web/src/shared/catalog-selectors/` exports `CatalogSelector` and the runtime DTOs. A consumer passes game, kind (`city`, `cargo`, `trailer`), an optional region and the selected ID. The selector is one ARIA editable combobox with list autocomplete: typing searches through the server after a short debounce, reads only start when the field is opened, and a last row loads the next page inside the list. Rows that are hidden or from another game leave the list; a saved row in that state stays readable with its label, a mark and a note, and a consumer can pass the optional `extraRow` to add a fixed last list row (the four manual report fields use it for "Not listed / unresolved"; other consumers do not show it). A row that is still being fetched or has not settled after a search cannot be chosen. Locale changes labels only, never selected IDs.

Keyboard contract: arrows open and move (wrapping), Enter chooses the active row and never submits an enclosing form (IME composition is respected), and Escape closes the list and restores the previous value. Tab and clicking outside close and restore, except that fully erased text clears the value. Inside a dialog, Escape closes an open list first; `shared/ui/dialog.tsx` keeps the dialog open until the list is closed.

Queries use the session's private no-store scope and generated DTO runtime schemas. A failed read shows an alert and a Refresh row in the list. A selection whose row cannot be read keeps its ID and says so.

## Import flow

The dialog offers CSV and JSON templates per list and shows the exact columns, then checks a file through the preview route. Counts and per-line results appear with errors and changed fields; errors disable apply, and a truncated line list is called out. Apply sends the same file with the preview token in `If-Match`; the logical command keeps one idempotency key while the file and token are unchanged, so an uncertain retry cannot double-apply. A stale token asks the staff member to check the file again.

## Evidence and boundaries

Unit tests cover selector compatibility, combobox row order and key movement, fallback rules, URL filter parsing, template parity with the server's columns and RU/EN string parity. Browser tests cover RU/EN layout at desktop and phone widths, add/edit/hide/restore, import dry-run/apply, permissions, pending, error and empty states, and the combobox keyboard, search and paging behavior. Run the pinned Docker launcher from [testing.md](testing.md). Exact outcomes per candidate SHA belong in the pull request.
