# Domain modules

Add each feature under its owning [module boundary](../../../../docs/architecture/modules.md). VTC-006 implements no membership, trip, qualification or event command. HTTP routes call public module facades; modules do not reach into another module's tables. Cross-module coordinators belong in `../use-cases/` and share the platform transaction context.
