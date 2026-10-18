# VTC-008 test tooling

[VTC-008](https://trello.com/c/x9ItpOEL) supplies reusable test infrastructure and a real built-app smoke journey. Feature owners still own domain tests. Read [CONTRIBUTING.md](../../CONTRIBUTING.md), the [persistence contract](persistence.md), [fixture provenance](../../test/fixtures/README.md) and the applicable [concept scenarios](../../CONCEPT.MD#acceptance-scenarios-for-the-confirmed-decisions).

## Run locally

Use Node **24.22.0**, pnpm **12.14.0** and Docker Linux containers. The authoritative path creates its own stack, checks/builds this checkout, and runs every lane:

```sh
pnpm install --frozen-lockfile
pnpm test:local
```

No development `.env`, running app, published port or existing volume is used. Downloads occur during the image build. At runtime, the runner and real MySQL **8.4.11** are attached only to an explicit `internal: true` network; there are no external networks, host aliases, Docker sockets or published ports. The image uses the repository's pinned Node digest, installs Chromium and its OS dependencies at build time, and runs tests as `node`. Container and browser dependencies are separate from host dependencies. The launcher passes its POSIX UID/GID as narrowly scoped image build arguments so the unprivileged runner can write its new output mount; Windows defaults to 1000:1000. Root UID/GID are rejected.

Optional focused invocation still performs check/build before its chosen lane:

```sh
pnpm test:local integration
pnpm test:local persistence
pnpm test:local recovery
pnpm test:local e2e
pnpm test:local failure-reporting
```

`unit` and `contracts` are also valid focus names. The launcher uses a fresh random Compose project and private `.local/testing/<run>/stack.env` (mode 0600 on POSIX). It removes only that project's containers/network/volume in `finally`, propagates failure and handles interruption. Once cleanup starts, additional SIGINT/SIGTERM signals are not forwarded to the cleanup child. Cleanup runs in its own detached process group/session on POSIX, so terminal-generated signals sent to the launcher's foreground group cannot reach it directly. Cleanup stdin is ignored; its stdout/stderr are piped through the launcher instead of inheriting terminal handles. The launcher continues awaiting cleanup and never unreferences it; helper windows are hidden on Windows. Compose receives a five-second container-stop timeout, and the cleanup command has a separate fifteen-second deadline. Expiry closes the owned output readers and terminates only the owned cleanup group on POSIX, or the owned child on Windows, then retains configuration for explicit recovery. This is a bounded fallback, not proof that the Docker daemon completed cleanup. Successful cleanup deletes that run's private `stack.env`; failed or timed-out cleanup retains it and prints a fixed failure category plus the exact owned-project recovery command. Reports/screenshots/traces and private allocation configuration are ignored under `.local/testing/`; they must never be committed or uploaded blindly. Abrupt host/engine termination can interrupt cleanup; the printed project name identifies the owned stack for explicit recovery. Do not clean by a wildcard or remove development volumes. Retained private stack configuration can be removed after explicit recovery confirms that owned stack is gone.

## Runner ownership profiles

The test Dockerfile's `runner-ownership` stage isolates account setup from dependency/browser installation. Its default user is `node`, including when the requested non-root GID already belongs to another base-image group. The final `runner` stage inherits this setup and still ends with `USER node`. These focused checks exercise the actual image setup; the complete isolated suite remains a separate check.

From the repository root with a POSIX shell and Docker Linux containers, run:

```sh
set -eu
profile_tag="vtc-ownership-$(date +%s)-$$"
trap 'docker image rm "$profile_tag" >/dev/null 2>&1 || true' EXIT
for profile in 1000:1000 1001:20 1001:100; do
  runner_uid=${profile%:*}
  runner_gid=${profile#*:}
  if [ "$profile" = 1000:1000 ]; then
    docker build --target runner-ownership -f deploy/test/Dockerfile -t "$profile_tag" .
  else
    docker build --target runner-ownership -f deploy/test/Dockerfile \
      --build-arg RUNNER_UID="$runner_uid" --build-arg RUNNER_GID="$runner_gid" \
      -t "$profile_tag" .
  fi
  docker run --rm --network none --read-only \
    --tmpfs "/probe:uid=$runner_uid,gid=$runner_gid,mode=0700" \
    "$profile_tag" node -e '
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const uid = Number(process.argv[1]), gid = Number(process.argv[2]);
      assert.equal(process.getuid(), uid); assert.equal(process.getgid(), gid);
      assert(uid > 0 && gid > 0);
      const directory = fs.statSync("/probe");
      assert.equal(directory.uid, uid); assert.equal(directory.gid, gid);
      assert.equal(directory.mode & 0o777, 0o700);
      if ([20, 100].includes(gid)) {
        const groups = fs.readFileSync("/etc/group", "utf8").split("\n");
        assert(groups.filter(line => line.split(":")[2] === String(gid)).length >= 2);
      }
      fs.writeFileSync("/probe/synthetic", "synthetic", { mode: 0o600 });
      const file = fs.statSync("/probe/synthetic");
      assert.equal(file.uid, uid); assert.equal(file.gid, gid);
      assert.equal(file.mode & 0o777, 0o600);
      console.log("OWNERSHIP_PROFILE_WRITE_PASS");
    ' "$runner_uid" "$runner_gid"
done
for profile in 0:1000 1000:0; do
  if docker build --target runner-ownership -f deploy/test/Dockerfile \
    --build-arg RUNNER_UID="${profile%:*}" --build-arg RUNNER_GID="${profile#*:}" \
    -t "$profile_tag" .; then
    echo "ROOT_PROFILE_WAS_ACCEPTED" >&2
    exit 1
  fi
done
```

Every successful profile must report `OWNERSHIP_PROFILE_WRITE_PASS`; both root profiles must fail at the positive-ID guard, rather than at an unrelated build/download step. UID 1001 with GIDs 20 and 100 exercises groups already present in the pinned Debian image; the probe also verifies that each shared GID has multiple group entries. Each write probe uses a fresh mode-0700 Linux tmpfs with matching ownership, no network and a read-only image. It does not mount a development directory or volume, change broad permissions, or run the suite as root. The default profile builds without ID overrides. The unique local image tag is removed on exit; normal Docker build cache may remain.

## Lanes and configuration

| Command | Actual evidence |
| --- | --- |
| `pnpm check` | Generated contracts, formatting/lint/types and the existing Node scaffold checks, including all reviewed browser structural fixtures |
| `pnpm test:unit` | Vitest: deterministic helpers, local doubles, retry boundaries and endpoint/environment guards, lossless UI formatting and schema-validated foundation responses; database independent |
| `pnpm test:contracts` | Vitest/Ajv 2020-12: all six canonical frozen telemetry examples and negative structural mutations |
| `pnpm test:integration` | Vitest with real MySQL: unique-key races, durable synthetic leases/reconnect/reclaim, actual deadlock/retry, rollback/audit and ownership/grant denial |
| `pnpm db:test` | Existing Node persistence lane, separately allocated: twelve reported tests including empty/replay/prior migration, sentinel/history, exact values and transaction boundaries |
| `pnpm db:recovery` | Existing Node lane, separately allocated: two partial-DDL/timeout recovery rehearsals |
| `pnpm test:e2e` | Playwright: real built SPA/Fastify/MySQL smoke, separately controlled negative readiness cases, and synthetic foundation journeys on desktop, tablet and mobile Chromium |
| `pnpm test:failure-reporting` | Runs excluded deliberate assertions in each new runner and checks assertion identity plus exit 1; proves aggregate child failure propagation |
| `pnpm test:all` | Sequential allocation-isolation proof, six lanes, then deliberate failure-reporting proof; fails closed when a child fails |

`test:unit` and `test:contracts` can run natively after `pnpm build:packages`. Database/browser/aggregate commands require launcher-generated configuration from the isolated stack. They deliberately cannot read a development `.env` or default to a developer database. They are used inside `test:local`; invoking them from an ordinary shell without an allocation fails closed. Native unit/contract execution does **not** provide Docker's network boundary. Vitest's fetch guard catches accidental fetch calls, but raw sockets and other clients need OS/container isolation. Future tests must run through the authoritative Docker path when real service isolation matters.

Vitest **5.0.5** requires Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite `^6.4.0 || ^7.0.0 || ^8.0.0`; the root directly declares Vite **8.3.4**. Playwright **1.64.1** requires Node >=20. Registry publication dates checked on 2026-10-17 were October 15 and October 14 respectively; frozen installation passes the existing strict peer/release-age policy without new exclusions. TypeScript stays **5.9.3**. Ajv **8.20.0** and ajv-formats **3.0.1** are direct root imports. The telemetry runner disables only Ajv's `strictTypes` schema-authoring warning because the frozen schema refines existing objects in conditional branches without repeating their type; type coercion/default insertion/removal remain disabled. The schema itself is unchanged.

## Database ownership and safety

The provisioner alone receives the disposable server's admin credential. Before mutation it verifies the canonical actual version, engine, SQL modes, charset/collation, isolation and UTC through the existing readiness adapter. Each lane gets a new `vtc_test_<run>_<lane>` schema and random user granted only that schema; grant underscores are escaped so they are not MySQL wildcards. No global user/admin grant reaches a test or app child. The launcher holds a distinct suite `GET_LOCK` for the lifetime of the child; migration locks retain their separate production behavior. Allocation files bind run/lane/credentials and owner connection ID; destructive support checks the explicit acknowledgment, test mode, allocation, actual schema, baseline and matching suite-lock owner before resetting fixed fixture tables.

The aggregate creates two simultaneous allocations with distinct sentinel values, proves each credential cannot read the other's real table, and rejects reuse of an occupied allocation without changing its sentinel or allocation-file bytes. Cleanup tracks only confirmed schema/user creation and exclusive allocation-file creation. A failed collision never drops a pre-existing schema/user or removes another allocation's file. Every appropriate cleanup step is attempted despite earlier failures, including owned-file removal, admin close and forced transport destruction; errors retain only fixed step categories. Integration also verifies immediate suite-lock contention and denial of global database/user access. Every invocation starts with a fresh MySQL volume; lanes have no shared mutable schema. Production migration SQL/journal/snapshot are unchanged. Empty/prior migration and dirty-DDL recovery remain separate Node lanes instead of duplicating that suite in Vitest.

These are accident guards for cooperating test code, not a sandbox against a developer who forges configuration or rewrites the harness. A synthetic database name alone is never evidence that deletion is safe. The real runtime network boundary and schema grants provide independent containment. The runner starts each child with a small environment allowlist; provider/mail credentials and the disposable admin password are excluded. Browser contexts block unexpected origins and service workers. The real MySQL smoke mocks no HTTP response; supplemental VTC-012 readiness cases explicitly control only /health/ready to exercise pending/503/transport/invalid-response recovery. Real mail/identity/provider clients are absent from these tests.

## Add tests

- Add database-independent cases to `test/unit/`, structural telemetry cases to `test/contracts/`, real database cases to `test/integration/`, and browser journeys to `test/e2e/`. New files must not enable concurrent file/test execution against one allocation; use explicit helper connections within a race.
- Use `clock()` (`nowUtc`, validated `set`, integer-millisecond `advance`) and independently instantiated `idGenerator()`/fresh builders from `test/support/builders.ts`. Application UUIDv4 generation does not alter provider UUID contracts. Canonical telemetry JSON is read afresh on every builder call.
- Use `barrier`, `deferred`, `bounded`, `until` and `connections` from `test/support/concurrency.ts`. Bound waits and release gates in `finally`. Connection teardown destroys pending sockets; a rejected timeout alone cannot cancel SQL. The test-only transaction helper retries only actual callback deadlocks after rollback, at most three attempts by default; COMMIT is outside the retry catch. This is not production retry policy.
- `MailFake` captures reference-only inputs and deterministic receipts. `BlobFake` copies streamed bytes, checks checksum/length and exposes private read/remove. `IdentityFake` captures the supplied transaction reference and a nonfunctional synthetic credential. `ProviderFake` preserves known/unavailable/ambiguous states. All support one-shot failures and reset. They are test-only architectural sketches, not installed production interfaces, actual password hashing/auth atomicity, provider verification, file authorization/retention or delivery proof.
- Playwright creates a fresh context per case, explicitly sets locale/timezone, uses role/label queries and waits for conditions/actual requests. The server helper applies migrations and starts built Fastify plus built SPA; readiness reaches the actual fresh database. `reuseExistingServer: false` rejects an occupied local port. The smoke checks RU/EN text/document language, a real retry request, unknown route/Home, usable focus and horizontal overflow at 1280×800 and 390×844. Mobile Chromium emulation is not native-device or Safari evidence.

Probes under `test/probes/` are excluded from ordinary suites and enabled by the failure-reporting wrapper or the explicit local `node scripts/test-ci.mjs --probe unit|integration|e2e` negative check described in the [CI guide](ci.md). The wrapper requires exit 1 and an exact assertion diagnostic containing the named `VTC008_*_ASSERTION_PROBE` plus `deliberate assertion reached`. A title, generic AssertionError, or marker echoed in a source codeframe cannot count as proof. The integration negative probe deliberately supplies the wrong suite-lock owner under the same test title and verifies that this earlier guard assertion is rejected as deliberate-proof evidence. Unit regressions cover realistic title/codeframe lookalikes and wrong exit statuses. The aggregate probe actually runs the aggregate and verifies propagation of that unit assertion. These expected failed subprocesses make the proof wrapper pass only when failure reporting works. Cleanup regressions inject lock/schema/user/file/admin failures and verify later cleanup, owned-file deletion and safe categories. POSIX launcher regressions use an inert fake Docker executable and condition-controlled child processes to prove repeated signals cannot kill cleanup, successful cleanup deletes private configuration, and failed cleanup retains recovery configuration. The group-signal regression creates a new detached launcher group and sends repeated SIGINT/SIGTERM only to that known owned group, including while cleanup is active; the PID-signal regression remains separate. Early callback-failure regressions also prove bounded natural completion and recorded-owned-PID fallback when fake cleanup refuses release, while preserving the original callback error. All signal/process tests run in Linux Docker and are explicitly skipped on native Windows. Windows terminal signal isolation is not claimed as tested. These regressions do not signal the test runner's group or manipulate development Docker resources.

## Evidence and remaining gates

Implementation feedback and exact-candidate independent verification are recorded in the delivery PR. Synthetic concurrency demonstrations support the future canonical-trip/job/transaction work; they do not implement ingestion, durable workers, domain acceptance, permissions or qualification policy. Structural schema acceptance does not prove telemetry UTF-8 byte/depth/u64 semantics, lifecycle truth, ownership, durable ACK or actual desktop-client integration. Existing browser examples remain structural evidence only.

[CI configuration (VTC-009)](ci.md) now wraps this same isolated runner; hosted execution evidence is recorded separately. Enforced review (VTC-010), staging (VTC-011), feature workflows/adapters, integrated journeys (VTC-040), and Hostland/capacity/backup/restore (VTC-041) remain pending. Local checks and independent review do not imply merge, Done or deployment.

Primary references: [Vitest setup files](https://vitest.dev/config/setupfiles.html), [Playwright web server](https://playwright.dev/docs/test-webserver), [Playwright Docker guidance](https://playwright.dev/docs/docker), [Compose internal networks](https://docs.docker.com/reference/compose-file/networks/), [Ajv dialects](https://ajv.js.org/guide/schema-language.html), and [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

VTC-012 synthetic [foundation journeys](../../test/e2e/foundation.spec.ts) save success screenshots through Playwright output paths at 390x844, 768x1024 and 1280x800 in RU/EN. They cover both shells, long labels, complete content states, dialogs and mobile menus. These ignored captures require actual rendered review; DOM assertions alone do not establish visual acceptance. See the [foundation guide](ui-foundation.md) for scope, provenance and live integration boundaries.
