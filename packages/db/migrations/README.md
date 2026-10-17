# Migration journal

VTC-007 owns generation and ordering. Coordinate one migration integrator across feature branches. Run root `pnpm db:generate`, review SQL plus snapshots/journal and check regeneration for drift. The initial migration contains only audit storage and indexes, explicitly using InnoDB/utf8mb4; domain schemas remain with their owners.

Use `pnpm db:migrate` explicitly, or `node node_modules/@vtc/db/dist/migrate-cli.js` from a production API artifact. Startup/install never migrate or seed. The runner uses the generated Drizzle SQL/journal and its own checksum-checked `_vtc_migrations` ledger with durable `applying`/`applied` state, on a dedicated locked connection. Never mix it with the upstream migrator or schema push.

MySQL DDL may implicitly commit. A failed migration remains dirty and refuses automatic replay; earlier DDL can persist. Follow the [partial-DDL runbook](../../../docs/development/persistence.md#partial-ddl-recovery-runbook), restoring a consistent backup or preparing reviewed forward repair. The separate synthetic recovery rehearsal is not production backup/restore proof.
