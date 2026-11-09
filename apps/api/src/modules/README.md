# Domain modules

Add each feature under its owning [module boundary](../../../../docs/architecture/modules.md). VTC-013 adds the [identity facade](identity/service.ts) and auth/me routes; trip, qualification and event modules remain separate. HTTP routes call public module facades; modules do not reach into another module's tables. Cross-module coordinators belong in `../use-cases/` and share the platform transaction context.

The catalogs module owns five per-game editable lists (DLCs, regions, cities, cargo, trailer types), their hand edits and CSV/JSON imports, exact-code recognition and localized reads. It calls identity current-authority facades. [Catalog model and code rules](../../../../docs/development/catalogs.md).
