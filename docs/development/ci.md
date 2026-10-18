# VTC-009 pull request CI

[VTC-009](https://trello.com/c/tgxPEMmP) adds [CI](../../.github/workflows/ci.yml) for every opened, synchronized, reopened or ready-for-review pull request, including drafts, and pushes to `main`. There are no path filters. Stable job names are **Quality suite** and **Required CI**. VTC-010's [main ruleset](../../.github/rulesets/main.json) was applied on 2026-10-17 and read back with effective branch rules; the [review guide](review.md#evidence-and-remaining-gates) records the observed blocked failing PR and separate pending delivery gates. The file itself does not apply hosted settings.

## Execution and trust

`node scripts/test-ci.mjs` wraps the authoritative [isolated launcher](testing.md). It runs that checkout's check/build, allocation and wrong-baseline proof, all six lanes (unit, contracts, real MySQL integration, persistence, recovery, desktop/mobile built-app Playwright smoke), and existing assertion/failure-reporting proofs. It propagates the actual suite/cleanup exit code, without a second database bootstrap or migration changes. Node 24.22.0 / pnpm 12.14.0 / MySQL 8.4.11 images and strict SQL baseline remain pinned.

GitHub uses `ubuntu-24.04`, a 30-minute quality job budget and a 25-minute suite step budget, leaving time for bounded cleanup and reporting. PR/ref concurrency cancels obsolete runs. Hard cancellation, runner loss or Docker engine loss can interrupt cleanup; ephemeral hosted runners limit persistence but do not prove cleanup completed. Local interrupted runs may require the launcher's explicit owned-project recovery. Existing development resources are never reused.

The token has only `contents: read`; checkout does not persist credentials. Project code receives no repository/deployment secrets or write token. Actions use reviewed immutable commits supporting Node 24. There is no mutable dependency cache or deployment/dispatch path. Downloads happen during image build. Runtime networking is internal, without published ports or Docker sockets; children retain existing environment/schema-grant restrictions. Ordinary `pull_request` runs the PR merge candidate without elevated `pull_request_target` execution.

The test image adjusts its unprivileged `node` account to the launcher's POSIX UID/GID at build time. Windows uses 1000:1000. An existing non-root GID may be reused: the image's `node` group can share that numeric GID with a base-image group. Newly created output mounts are therefore writable on Linux hosts whose user is not UID 1000. Root UID/GID are rejected. Build arguments affect only the disposable image. The [ownership profile checks](testing.md#runner-ownership-profiles) build the actual Dockerfile's small `runner-ownership` stage and exercise unprivileged writes on disposable Linux filesystems.

**Required CI** runs with `always()` after **Quality suite** and uses the tested `requiredCi` evaluator. Only explicit `success` passes; failure, cancellation, skipped, absent and unknown results fail. Critical jobs have no `continue-on-error`. A workflow that never starts produces no successful check. The applied rule binds that stable name to GitHub Actions app `15368`, with an up-to-date base and no bypass actors. In [fixture PR #17](https://github.com/senukartur/vtc-dashboard/pull/17), failed Required CI was observed with a non-draft, conflict-free, up-to-date PR reporting `BLOCKED`, zero required approvals and no unresolved threads. No merge was attempted. Administrators who can change the workflow retain the usual repository trust boundary.

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

The VTC-009 hosted green/red evidence is recorded in [PR #14](https://github.com/senukartur/vtc-dashboard/pull/14), including [green main CI](https://github.com/senukartur/vtc-dashboard/actions/runs/39068326046). For VTC-010, [initial governance CI](https://github.com/senukartur/vtc-dashboard/actions/runs/39069674122) at `6aeef8ea7ff71f43d21152a077ce25f41dd5ce55` passed both jobs and all 12 reported stages, including cleanup. The controlled fixture at `daca329b8f413c85af40c16e925a317a2e2a56e5` failed its unit lane and both jobs in the [initial run](https://github.com/senukartur/vtc-dashboard/actions/runs/39069683893) and [2026-10-18 retry](https://github.com/senukartur/vtc-dashboard/actions/runs/39076708118), with successful build/check and cleanup. Only the fixed-schema result artifact was retained for these observations. The retry supplied an actionable seeded finding and an open-PR blocked-state capture before the fixture was closed unmerged; see the [review evidence](review.md#evidence-and-remaining-gates). These runs cover those SHAs; final governance-head delivery evidence is tracked in the [VTC-010 review record](review.md#evidence-and-remaining-gates). No domain acceptance scenario, staging or production acceptance is established. VTC-011 staging, VTC-040 integrated journeys and VTC-041 Hostland/capacity/recovery remain separate gates.
