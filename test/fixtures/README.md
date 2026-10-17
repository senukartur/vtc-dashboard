# Fixtures

VTC-006 provides no seed account, company configuration or domain data. The local MySQL volume starts with an empty application database. Structural browser fixtures remain in [the reviewed API examples](../../docs/contracts/dashboard/examples.json); telemetry fixtures remain in [their separate directory](../../docs/contracts/examples/README.md). They are not a database seed or valid credentials.

VTC-007/008 and feature owners introduce explicit synthetic database/test fixtures as schemas and invariants are implemented. Never import real users, reports, source archives, private screenshots or hosting diagnostics to make local development work.
