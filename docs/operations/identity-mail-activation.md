# Development identity and mail activation

This separately authorized NO-CARD follow-up preserves completed VTC-014, the empty active company and all published migrations. Source merge, automatic disabled-image deployment, control installation, activation, provider acceptance, provider delivery reporting and inbox receipt are separate evidence. This runbook does not establish that a host operation or real send occurred.

## Private configuration and ingress

Use root controls and the accepted immutable artifact from the same reviewed source. The new image also starts with previous disabled controls: proxy trust is off when `API_TRUSTED_PROXY_IPV4` is absent. After preparing the private files below, install reviewed controls using `deploy/development/update-controls.sh`, under its existing operations lock. It stages/parses controls, preserves the previous package, fences writers and records recovery before multi-file replacement. It leaves traffic/cron fenced until the checksum-bound `activation apply` succeeds. Partial update retries require the same reviewed source package; missing/tampered stage/backup needs root investigation. This creates only a missing disabled `private/identity-mail.env`; existing role files/secrets survive. Fresh `setup.mjs` also starts disabled. Neither operation enables identity, applies identity grants or bootstraps a director.

Prepare root-owned mode-0600 `private/ingress.env` containing exactly `VTC_INGRESS_SUBNET`, `VTC_INGRESS_APP_IPV4`, `VTC_INGRESS_PROXY_IPV4`. Choose a canonical private IPv4 /24–/29 subnet and distinct usable app/proxy addresses, excluding network/broadcast/first gateway. Do not copy another host's addresses. Validation checks Docker networks and Linux routes, allowing only an already owned ingress with the same subnet. Review VPN/custom routing beyond that inventory before applying. All operations Compose paths, including release/migration/worker/restore, read this interpolation file. Isolated restore starts only its own database network, avoiding active ingress addresses.

The app joins database plus a dedicated internal ingress bridge. Caddy joins ingress/frontend; the probe retains frontend/database. Jobs joins database and separate mail-egress NAT. No app/database/worker host ports exist. Caddy overwrites `X-Forwarded-For` with its immediate remote host and removes `Forwarded` on the app upstream. Fastify trusts exactly the configured peer at hop zero, recognizing dotted IPv4 and dotted `::ffff:` socket forms. No subnet, CDN, hostname, DNS snapshot or hop-count-only trust is supported.

Prepare mode-0600 `private/activation-input.env` with the [mail fields](email.md#configuration-and-activation): enabled identity, exact approved HTTPS origin, separate identity secret/encryption key, Resend mode, verified plain sender, domain-restricted Sending key and disabled-tracking attestation. Never put values in argv, Git, CI, public reports or shared artifacts. `runtime.env` and `jobs.env` contain only their five `MYSQL_*` fields, preserving distinct database credentials. Both services layer the same shared identity/mail file after those files. Validation compares the complete clean active migration ledger with hashes read from the exact artifact, without applying missing DDL. It rejects unknown/duplicate fields and unsafe env-file expansion characters and executes the exact artifact's `readConfig` for both roles in network-isolated containers without printing values.

## Apply and recovery

After exact-head verification, independent review, automated-review dispositions, green Required CI and normal merge, use the separately authorized development activation scope:

```sh
sudo python3 /opt/vtc-development/operations.py activation validate
sudo python3 /opt/vtc-development/operations.py activation apply
sudo python3 /opt/vtc-development/operations.py activation inspect
sudo python3 /opt/vtc-development/operations.py activation ingress-check
```

`apply` refuses an unrelated maintenance/recovery or any acceptance window; the complete checksum-bound control-update fence is explicitly accepted. It validates before mutation, records a private revision/image/config-checksum intent, fences writers, preserves previous configuration and persists recovery intent before grants/config changes. It applies `activation-grants.json`, establishes narrow reads before revoking the known legacy runtime schema SELECT, verifies effective privileges, atomically replaces the shared file, recreates app/probe/proxy, and checks internal/authenticated HTTPS readiness before reopening traffic. Readiness needs no application-table SELECT. Passwords/unrelated grants are never reset. Unexpected schema/global/table/column, routine, proxy, dynamic or inherited-role grants stop for disposition. Grant DDL is nontransactional.

The matrix grants runtime identity mutations, audit INSERT, immutable outbox producer access and narrow queue/mail producer access. Native `identity_verifications` mutation, migration-ledger access, DDL and audit/outbox UPDATE/DELETE remain absent. Jobs has queue/mail privileges plus only SELECT on identity company/membership/user/challenges, with no identity/audit writes. The isolated supported native identity/worker flow proves these grants; do not widen them for an unmounted native verification API.

`ingress-check` uses run-owned frontend clients, normal hostname/TLS verification and independently verified empty noncolliding source slots against `/api/v1/auth/csrf`. Forged headers cannot escape one source slot; request 21 returns 429/Retry-After without charging global capacity, another client succeeds, and denial survives app recreation. It never resets counters. Busy capacity or a minute-boundary race is failed/pending evidence. Only aggregate assertions and artifact identity are retained in the safe result; no IP, bucket key/hash, cookie, CSRF value or secret is returned. The manifest/labels authorize only its client cleanup; after interruption use `activation ingress-cleanup` before retrying. This measures Docker/Caddy ingress; additionally record any required actual external-client observation privately.

On partial apply leave maintenance and `state/recovery-required` intact. Inspect private state without publishing child stderr/config. `activation recover` resumes only the same artifact/checksum-bound candidate and idempotent grants. `activation rollback` restores the checksum-bound previous configuration and rechecks readiness, retaining narrow grants/data/history. If interruption preceded the previous backup, recovery reconstructs it only when the current shared file matches the recorded original hash. Root-owned staged `.new` files resume only when their bytes exactly match the bound source or its prefix; unrelated bytes, permissions and symlinks are refused and retained. An interruption during shared replacement therefore preserves the original backup/keys and the recovery fence. Missing/tampered source hashes or unexplained privileges require root investigation. Never delete a marker to resume cron. Keep current/candidate/previous encryption keys until pending/ambiguous intents resolve or expire. Disabled mail pauses delivery; it neither erases evidence nor authorizes regenerated keys. Do not reinstall older broad grants or an unreviewed identity implementation during rollback.

## Isolated durable mail acceptance

Put the sole approved recipient in root-owned mode-0600 `private/acceptance-input.env` as `VTC_ACCEPTANCE_RECIPIENT`. Choose one fresh UUIDv4 and substitute the same nonsecret identifier throughout:

```sh
sudo python3 /opt/vtc-development/operations.py identity-acceptance prepare RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance produce RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance inspect RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance worker RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance inspect RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance worker RUN_UUID
sudo python3 /opt/vtc-development/operations.py identity-acceptance inspect RUN_UUID
```

The fixed wrapper refuses the active schema, nonempty active company, collisions, unbound manifests, maintenance/recovery and another acceptance window. It allocates a derived fresh schema and runtime/jobs/migrator accounts on existing MySQL, records ownership privately, explicitly runs immutable migrations and applies the same runtime/worker matrix. Only the temporary migrator gets schema DDL. A SELECT-only allocation sentinel binds the CLI to the full UUID; temporary accounts carry its MySQL ownership attribute. Caller-supplied schema/account names are never accepted, collisions never adopted. Ordinary jobs pause while heartbeat remains available. The active API database/configuration is never replaced.

The producer calls `composeIdentity`, `identity.bootstrap`, native login/authentication and `requestChallenge`, with a fixed fictional display name, approved recipient and an in-memory strong temporary password. It creates no real initial director or public bootstrap route. The producer exits after encrypted challenge/mail/job persistence; inspection verifies one linked generation/delivery/job and retained encrypted payload. A separate container runs ordinary `dist/jobs.js run` using the allocated jobs account and the same frozen shared configuration. Normal owner-validity, Resend, idempotency, receipt and completion paths apply; there is no direct smoke call, hand-inserted mail, retry reset or reconciliation bypass.

After completion, the same delivery/job must show accepted/completed, one attempt, retained private receipt and immediate ciphertext/payload-deadline purge. A second ordinary pass must retain those identities/states/attempts. Timeout/crash retains the allocation: inspect before another bounded ordinary pass. Rejected/ambiguous outcomes remain failed/pending under the existing owner recovery policy. Never issue another generation merely to get a green test.

Record durable provider acceptance, provider delivery/bounce reporting and actual approved-inbox receipt separately. Only a private authorized human/operator observation proves inbox receipt. The CLI omits provider receipts/addresses. If correlation is necessary, an authorized root operator may privately read only the manifest-bound delivery receipt; never paste rows/receipts into a PR or upload them. No inbound mailbox, marketing or paid provider feature is enabled.

After safe evidence capture:

```sh
sudo python3 /opt/vtc-development/operations.py identity-acceptance cleanup RUN_UUID
sudo python3 /opt/vtc-development/operations.py jobs
```

Cleanup checks exact container labels, account attributes and schema sentinel before dropping only owned resources; verifies accounts/database/containers absent; compares active company/user/account/session/membership/role/challenge counts with its pre-run snapshot; and removes temporary private files/marker only after success. Active company stays empty. A partial allocation without a valid sentinel, ownership mismatch or cleanup failure retains its manifest for root investigation. Never drop a collision, clear markers speculatively or delete active volumes.

## Verification boundaries

Run `pnpm check`, `pnpm build`, real MySQL integration and `node deploy/development/test.mjs`. Rehearsal covers these same controls/grants, actual Caddy sockets, restricted native identity enqueue, terminated producer, separate ordinary worker, purge, duplicate suppression, collisions and cleanup. Its internal Python-only local fixture uses fictional `example.invalid` data and nonproduction local mail; the operator CLI exposes no such mode. No provider request occurs in CI/rehearsal. Existing identity/protected-director, queue ambiguity and migration/recovery regressions remain required. Hosted results/exact SHA belong in private activation evidence, with sanitized conclusions only made public. Admissions scenarios 23–24 and account UI remain separate work.
