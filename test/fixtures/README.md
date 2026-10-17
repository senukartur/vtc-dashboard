# Fixtures

VTC-006 provides no seed account, company configuration or domain data. The local MySQL volume starts with an empty application database. Structural browser fixtures remain in [the reviewed API examples](../../docs/contracts/dashboard/examples.json); telemetry fixtures remain in [their separate directory](../../docs/contracts/examples/README.md). They are not a database seed or valid credentials.

VTC-007 supplies [synthetic persistence fixtures](persistence/) separately from shipped migrations: a committed prior-schema migration, parent/value tables, a deliberately failing partial-DDL migration and a bounded slow-statement timeout migration. The guarded `pnpm db:test` and `pnpm db:recovery` commands reset only explicit fixture/audit/journal tables in a disposable `vtc_test_*` schema, requiring `NODE_ENV=test` and `DB_TEST_RESET_ACK=synthetic-only`; see the [instructions and limits](../../docs/development/persistence.md#explicit-synthetic-verification). Database-independent half-open protocol peers live under `test/scaffold/` and never connect to a configured database. There is no automatic production seed or real account, and fixture numbers are not company settings.

VTC-008 and feature owners retain broader tooling and workflow fixtures. Never import real users, reports, source archives, private screenshots or hosting diagnostics to make local development work.
