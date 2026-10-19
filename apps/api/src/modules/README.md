# Domain modules

Add each feature under its owning [module boundary](../../../../docs/architecture/modules.md). VTC-013 adds the [identity facade](identity/service.ts) and auth/me routes; trip, qualification and event modules remain separate. HTTP routes call public module facades; modules do not reach into another module's tables. Cross-module coordinators belong in `../use-cases/` and share the platform transaction context.
