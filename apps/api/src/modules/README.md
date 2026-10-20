# Domain modules

Add each feature under its owning [module boundary](../../../../docs/architecture/modules.md). VTC-013 adds the [identity facade](identity/service.ts) and auth/me routes; trip, qualification and event modules remain separate. HTTP routes call public module facades; modules do not reach into another module's tables. Cross-module coordinators belong in `../use-cases/` and share the platform transaction context.

The catalogs module owns strict normalized artifacts, staged durable import/review/publication, exact identities, localized historical reads and its server-side pinned-fact resolver. It calls identity current-authority facades and safe queue/outbox ports rather than reading another module's tables. [Catalog implementation and remaining data gates](../../../../docs/development/catalogs.md) distinguish synthetic machinery from complete production datasets.
