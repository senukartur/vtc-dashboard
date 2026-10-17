# VTC-009 pull request CI

[VTC-009](https://trello.com/c/tgxPEMmP) adds [CI](../../.github/workflows/ci.yml) for every opened, synchronized or reopened pull request, including drafts, and pushes to `main`. There are no path filters. Stable job names are **Quality suite** and **Required CI**. VTC-010 owns configuring repository rules to require the latter and proving merge prevention; a workflow does not configure those rules.

## Execution and trust

`node scripts/test-ci.mjs` wraps the authoritative [isolated launcher](testing.md). It runs that checkout's check/build, allocation and wrong-baseline proof, all six lanes (unit, contracts, real MySQL integration, persistence, recovery, desktop/mobile built-app Playwright smoke), and existing assertion/failure-reporting proofs. It propagates the actual suite/cleanup exit code, without a second database bootstrap or migration changes. Node 24.22.0 / pnpm 12.14.0 / MySQL 8.4.11 images and strict SQL baseline remain pinned.

GitHub uses `ubuntu-24.04`, a 30-minute quality job budget and a 25-minute suite step budget, leaving time for bounded cleanup and reporting. PR/ref concurrency cancels obsolete runs. Hard cancellation, runner loss or Docker engine loss can interrupt cleanup; ephemeral hosted runners limit persistence but do not prove cleanup completed. Local interrupted runs may require the launcher's explicit owned-project recovery. Existing development resources are never reused.

The token has only `contents: read`; checkout does not persist credentials. Project code receives no repository/deployment secrets or write token. Actions use reviewed immutable commits supporting Node 24. There is no mutable dependency cache or deployment/dispatch path. Downloads happen during image build. Runtime networking is internal, without published ports or Docker sockets; children retain existing environment/schema-grant restrictions. Ordinary `pull_request` runs the PR merge candidate without elevated `pull_request_target` execution.

The test image adjusts its unprivileged `node` account to the launcher's POSIX UID/GID at build time. Windows uses 1000:1000. Newly created output mounts are therefore writable on Linux hosts whose user is not UID 1000. Root UID/GID are rejected. Build arguments affect only the disposable image.

**Required CI** runs with `always()` after **Quality suite** and uses the tested `requiredCi` evaluator. Only explicit `success` passes; failure, cancellation, skipped, absent and unknown results fail. Critical jobs have no `continue-on-error`. A workflow that never starts produces no successful check; VTC-010 must enforce the stable name. Administrators who can change the workflow retain the usual repository trust boundary.

## Safe diagnostics

The wrapper consumes and discards raw child stdout/stderr without retaining or printing them. It retains at most 64 fixed-schema stage records with allowlisted stage/status and bounded numeric exit/duration. Unknown lines, exceptions, configuration, payloads and extra JSON fields are discarded. Stage events are advisory diagnostics; process exit determines success. This reduces disclosure but is not a universal secret detector.

Each invocation replaces `.local/ci/quality.json` with a newly generated fixed-schema result. The workflow uploads exactly that file, under a unique run/attempt name with three-day retention. `include-hidden-files: true` is required for this exact file under `.local`; no recursive `.local` upload is allowed. Missing reports fail the upload. Private `stack.env`, allocation JSON, Docker output, arbitrary errors, traces, screenshots and browser directories are never artifact inputs. Browser diagnostics remain ignored local output under `.local/testing`.

## Failure evidence and delivery gates

Run each explicit local negative check separately:

```sh
node scripts/test-ci.mjs --probe unit
node scripts/test-ci.mjs --probe integration
node scripts/test-ci.mjs --probe e2e
```

Each still checks/builds its own isolated stack, selects the existing deliberate assertion, verifies the exact `VTC008_*_ASSERTION_PROBE` diagnostic and real exit 1, and exits **1** after cleanup. An earlier allocation, server or guard error is `probe-not-reached`, never deliberate-assertion evidence. There is no workflow probe input or normal-suite bypass. Ordinary expected-failure self-proofs verify the harness; they are not red hosted CI demonstrations. Unit tests separately prove aggregate rejection and sanitization of synthetic secret-shaped output.

The delivery PR records exact-candidate local checks and independent review. Hosted green execution and intentional red unit/integration/E2E aggregate demonstrations require actual GitHub run/check links and remain pending until observed. Local probes do not establish VTC-009 Done, repository enforcement, staging or production acceptance. No domain acceptance scenario is implemented. VTC-010 review/rules, VTC-011 staging, VTC-040 integrated journeys and VTC-041 Hostland/capacity/recovery remain separate gates.
