# VTC-005 isolated architecture probes

These are reproducible research checks, not the application scaffold, production auth schema, project package-manager choice or root dependency baseline. All inputs are synthetic; no account, live database, provider mail, telemetry or hosting access is used.

Use maintained **Node.js 24.22.0** and this directory's isolated npm lockfile:

```sh
npm ci --prefix spikes/architecture --ignore-scripts --no-audit --no-fund
node spikes/architecture/check.mjs
node spikes/architecture/node_modules/typescript/bin/tsc --version
```

`check.mjs` exercises Fastify request/response, Drizzle MySQL SQL generation, Better Auth/MySQL adapter initialization with synthetic auth tables, configured password hash/verification and rejection of its disabled HTTP signup path, React server rendering, React Query/Zod runtime and a small Vite production bundle. A freshly created temporary build directory is removed after its resolved absolute target is checked. It never connects to MySQL, provisions an auth user or creates a session; the fixture schema is not a migration. TypeScript's CLI version check is not application type-checking.

The [browser contract](../../docs/contracts/dashboard/README.md) has separate structural validation. Install the pinned validator requirements into an isolated environment/ignored target and expose it to Python, for example from the repository root:

```sh
python -m pip install --target .local/vtc005/validation-deps -r spikes/architecture/requirements.txt
PYTHONPATH=.local/vtc005/validation-deps python spikes/architecture/validate-contract.py
```

On PowerShell, set `$env:PYTHONPATH` to the same ignored target before running the Python script. This validates the OpenAPI document, local references, synthetic request/response examples, intentionally invalid payloads, security/ownership annotations and public DTO field separation. It does **not** prove route enforcement, cookie security, concurrency, actual notification timing or domain transitions. The fixture suite contains no working secrets or game data.

VTC-006 implements root tooling/generation; VTC-007/008/013/015 must prove real MySQL, session/invitation persistence and crash/concurrency boundaries. VTC-011 separately proves hosted synthetic infrastructure; later feature cards supply actual domain integration. See [stack evidence](../../docs/research/stack-compatibility.md).
