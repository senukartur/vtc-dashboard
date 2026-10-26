# Steam ownership and basic TruckersMP linkage

[VTC-018](https://trello.com/c/fX4nCOcK) implements the backend external identity module. Product policy remains in [CONCEPT.MD](../../CONCEPT.MD#steam-identity-changes), with browser DTOs in the [canonical contract](../contracts/dashboard/README.md). Steam is a linked identity. Email/password remains the login method; provider downtime, bans or VTC membership never deactivate local membership, change roles/qualifications, apply discipline or alter trips. VTC-038 owns account/administration screens.

## Activation and ownership

The default is `EXTERNAL_IDENTITIES_ENABLED=false`. Enabling requires identity, the explicit reviewed `0006_nervous_daredevil` migration, runtime table grants, the exact identity origin and outbound HTTPS to the two fixed providers below. Startup does not migrate, seed, create accounts or enable the feature. The local Compose file passes the disabled flag through. Production requires the identity module's validated HTTPS origin/cookie policy; no wildcard realms or callback destinations are accepted. Hosted activation, proxy/logging configuration and capacity proof remain VTC-011/039/041 gates.

`apps/api/src/modules/external-identities/` owns providers, proof generations, permanent external ownership, current links, immutable private changes and the TruckersMP cache. Identity owns membership, native credentials, sessions, authorization, epochs and safe audit/access events. Composition injects a transaction-scoped Steam projection into `/me`; it no longer assumes every enabled member lacks Steam. The external module uses narrow identity facades on the same `UnitOfWork`; it never reads or mutates identity tables directly or opens another pool.

Every command locks company first, then actor/target memberships in sorted order, current sessions and external rows. Current authority/active membership/epochs are checked inside the transaction. Network calls run after releasing locks, followed by a fresh authoritative check. Domain changes, proof consumption, history, identity version/epoch and required audit/access events commit together. A required adapter failure rolls them all back. The established identity transaction policy preserves unknown COMMIT as a distinct nonretryable error, before nested constraint/availability classification; a durable same-key lookup is the recovery path for browser commands.

Steam IDs remain validated 17-digit **strings**, in exact ASCII columns. TruckersMP player/VTC/member IDs normalize only safe integer JSON numbers or canonical decimal strings; unsafe numeric values fail. Display names never identify accounts. A unique Steam registry permanently reserves each observed ID for its local member, including after replacement; no API transfers it to another local user. Current links additionally enforce one link/member and one member/current Steam ID. History references the same local user, both external identities, proof, acting administrator, version/epoch, UTC time and a bounded private reason. Historical Steam rows and change history are never recycled by cleanup.

## Browser and callback flow

All ordinary writes require current session, exact Origin, session-bound signed CSRF and a UUID Idempotency-Key. Empty verification requests accept no body. Staff apply additionally requires If-Match. Early persistent source admission uses identity's separate read/command budgets; verification issuance also uses its actor challenge budget. Technical ceilings and their residual limitations are documented in [identity](identity.md#browser-security-and-technical-bounds); they are not business allowances.

| Operation | Behavior |
| --- | --- |
| `POST /api/v1/me/steam-verifications` | Initial link only for an unlinked member; returns a fixed-provider authorization URL, safe generation ID and expiry. |
| `POST /api/v1/me/steam-replacement-verifications` | Linked member requests and personally verifies a candidate. Creating/verifying this request does not replace the active link. |
| `GET /api/v1/me/steam-replacement-verifications/{verificationId}` | Owner-only safe proof state. Foreign proof IDs return 404. |
| `GET /api/v1/admin/members/{memberId}/steam-replacement-verifications` | Current members.manage authority; bounded ID-ordered pages. Keyed cursors bind actor, session, member and page limit. |
| `GET /api/v1/admin/members/{memberId}/steam-replacement-verifications/{verificationId}` | Safe proof state for the exact target; no provider assertions/nonces/state. |
| `POST /api/v1/admin/members/{memberId}/steam-replacement` | Director/Deputy applies the target's fresh verified single-use request, using its candidate only. Staff cannot submit a profile URL as proof. |
| `GET /api/v1/me/identity` | Current link, pending replacement, identity epoch and basic cached TruckersMP projection; ETag is the membership version. |

A serving director may make their own Steam request and a deputy may apply it under the same verified-request rules. Steam is not a login channel. This does not grant a deputy access to director email/password changes, deletion/deactivation, Director-role removal or succession. Existing identity protections remain in force. A same-profile request is consumed without a fictitious change, epoch bump or revocation.

The dedicated provider transport is **GET `/api/v1/identity/steam/callback`**, outside ordinary JSON/Origin/CSRF semantics. Steam redirects the browser with a signed assertion; the current initiating session cookie, keyed state inside signed `return_to`, provider nonce and stored generation/security epochs replace the ordinary write guard. The proof binds member, purpose, initiating session, previous link, identity/access/credential/email epochs and expiry. A fresh generation invalidates older pending/verified generations of that purpose. Logout/session expiry and any bound epoch change invalidate an unconsumed proof, including for staff apply. Read DTOs distinguish pending, verified, failed, expired, applied and invalidated.

The adapter accepts only OpenID 2.0 `id_res` assertions from `https://steamcommunity.com/openid/login`, with the fixed HTTPS claimed/identity URL shape and exact configured/stored return URL. The public Steam XRDS discovery at `https://steamcommunity.com/openid` supplied this fixed endpoint; callback-selected discovery/verification URLs are never fetched. Critical signed fields are `op_endpoint`, `claimed_id`, `identity`, `return_to`, `response_nonce`, `assoc_handle`. The adapter checks the signature using `check_authentication` at the same fixed endpoint, rejects redirects and duplicate/malformed/unsupported parameters, verifies the response namespace/unique validity fields and requires `is_valid:true`.

Technical bounds: proof lifetime ten minutes; nonce maximum age five minutes, future skew one minute, with canonical UTC-second syntax and nonempty bounded provider suffix; globally unique keyed nonce hashes retained at least six minutes after verification. The final transaction rechecks freshness, session, epochs, current link and unconsumed generation before reserving the nonce. Authorization/callback query input is bounded to 12 KiB, each value to 2,048 characters and a fixed parameter allowlist. Provider I/O has a five-second whole-receipt deadline including body reads, a 4 KiB Steam verification body bound and a 64 KiB TruckersMP body bound; transport/response errors expose fixed categories only. Cancellation consumes the current pending proof as failed; a provider outage leaves it available for a bounded retry until expiry.

Initial verification applies/consumes the link atomically. Replacement verification records only a candidate. Successful apply increments identity epoch/member version, invalidates pending proofs and identity challenges, appends safe `steam.linked`/`steam.replaced` audit and the existing `member.access_changed` event, and fences the old cache receipt. Password hashes, email/login and browser session access/credential epochs remain unchanged by a Steam-only change. Email/password login is checked again in the local live procedure. Safe command results retain reference/version only; keyed URL reconstruction gives the same request result after response loss or completion without storing raw assertion/state-bearing URLs. Replaying that old URL never reuses a consumed proof.

Callback responses use no-store/no-referrer and a restrictive no-assets CSP; success returns 303 to the fixed clean `/api/v1/identity/steam/completed` destination. Error responses do not echo input. Application logging is disabled; hosted ingress must also omit query URLs, cookies and raw callback/error bodies before activation. Do not enable authentication traces, screenshots, session recordings, analytics or third-party completion assets.

## Credential and history handoff

`credentialEligible(tx, captured)` is the synchronous authoritative seam for VTC-023. A credential must capture immutable local user ID, verified current Steam ID and access/identity/credential epochs when issued. Every use must check the facade on the same source/receipt transaction, with company/member locks acquired before source/trip locks. Eligibility requires active membership, a current verified link and equality of every captured epoch and Steam ID. Replacement/deactivation/reinstatement prevents old credentials from becoming valid again, even after switching back to a previous Steam profile. Never rebind old tokens to new epochs.

[VTC-023 personal telemetry credentials and ingestion](telemetry.md) now use `captureCredential(tx,userId)` to capture the verified link and all security epochs, check `credentialEligible` on every transport transaction, and inject eager same-transaction revocation into identity. VTC-022 retains actual canonical/source ownership; real desktop and integrated release proof remain VTC-024/040. Safe access events support downstream work; they are not a delayed authorization gate.

## TruckersMP cache

The only lookup is `GET https://api.truckersmp.com/v2/player/{verifiedSteamId}`. Its response includes VTC membership; no second membership request, ban/history/Discord/billing storage or disciplinary inference is made. `response.steamID` must be an exact matching string; numeric `steamID64` is ignored. Successful player absence is accepted only for the provider's documented explicit no-player body. Other malformed/error results remain failures. A player outside a VTC has `inVtc:false` with null VTC IDs/names/member reference, rather than fabricated zero identifiers.

| Cache state | Meaning |
| --- | --- |
| `not_linked` | No verified Steam link; no request is made. |
| `available` | Successful lookup within fifteen minutes, including explicit player absence. `found` distinguishes absence from a found player. |
| `stale` | A previous successful projection exists but expired or a refresh failed. Preserve its values and successful checkedAt. |
| `unavailable` | Linked, with no usable successful projection; never infer no-player or no-VTC. |

The DTO adds nullable `found`, `playerId`, `vtc`, `lastAttemptAt` and a fixed failure category while preserving existing status/displayName/checkedAt meanings. Failure categories are transport, timeout, rate_limited, unavailable and invalid_response. Unknown facts stay null. Provider errors are never stored verbatim. The pending-proof projection selects only current pending/verified candidates through its member/epoch/state index, capped at the two proof purposes; the identity owner checks only those exact session IDs. Proof pages check at most their 100 relevant session IDs, independently of accumulated login history.

Refresh is read-driven with durable MySQL coalescing: claim a fifteen-second lease and increment generation under locks, release the transaction, fetch, then compare link, identity epoch, generation, lease ID and lease validity before writing. Concurrent reads reuse fresh/prior state. Attempts are at least one minute apart; an abandoned lease can be reclaimed by a later eligible read after that bound, without a new job subsystem or in-memory queue. An old profile response after replacement/reinstatement or another lease cannot overwrite current state. Replacing the link clears old cache facts atomically. Required asynchronous delivery remains the [durable jobs](jobs.md) module's responsibility; no periodic cache worker is claimed.

## Migration, cleanup and verification

`0006_nervous_daredevil` is additive after the unchanged published 0000–0005 prefix. It creates six InnoDB tables with explicit utf8mb4 defaults, exact ASCII Steam keys, UUID binary references, restrictive FKs, millisecond UTC dates and unique ownership/current-link/nonce/change-proof constraints. Explicit short FK names respect MySQL's 64-character identifier limit. Existing members stay unlinked, with unchanged authentication, epochs and history. There is no startup migration or drizzle-kit push. MySQL DDL implicitly commits: retain a sticky applying marker after interruption and use the existing [consistent restore/forward-repair runbook](persistence.md#partial-ddl-recovery-runbook), never blind replay or claim DDL rollback.

Issuance deletes at most 100 proof rows expired more than 24 hours ago when no immutable change references them; ordinary result retention is 24 hours. Applied history and permanent Steam ownership remain retained. Verification deletes at most 100 expired nonce hashes through the expiry index. These are opportunistic technical retention bounds; operations must monitor accumulated history/cleanup throughput before hosted activation. Safe history contains no raw provider assertions, state/return URLs, cookies or login credentials. Private reason and actual identity mappings must never enter public diagnostics.

Run contributor `pnpm check`/`pnpm build`, unit/provider cases, guarded real MySQL integration/persistence/recovery and the built-server cookie/CSRF/Steam journey. Ordinary lanes are network-isolated and use the actual candidate adapter with synthetic transport. They cover uniqueness/concurrent claim, proof binding/replay, current authority and membership races, atomic rollback, safe command replay, epoch eligibility, provider failures, cache fencing and migration upgrade/sentinels. Independent exact-candidate verification/review, green Required CI, real owner-assisted linkage and hosted activation remain distinct evidence gates; the delivery report records actual results.

## Opt-in owner-assisted local check

This helper is separate from ordinary suites and requires the owner's explicit authorization to use their Steam account. It creates a fresh owned local Compose project/schema/volume, a synthetic member and random private configuration; the owner personally signs in on Steam. It does not deploy, tunnel, provision a paid service, modify the telemetry repository or touch existing stacks. The app is published only on IPv4 loopback; MySQL has no published port. Only the helper app has provider egress. Private generated settings stay in ignored `.local/external-live/<run>/` and the temporary real mapping exists only in that owned database volume.

From a clean committed candidate with Docker available:

```sh
node scripts/external-identities-live.mjs start 4188
```

The launcher builds pinned Node/pnpm source and waits for readiness. Open the printed `http://127.0.0.1:4188/live/start` URL in a private browser context and personally authenticate at Steam. Do not capture or copy intermediate callback/provider URLs, cookies, raw errors or screenshots. Success lands on the fixed clean completion URL. The helper invokes the actual candidate Steam adapter, asserts persisted `/me` verification, repeats normal password sign-in and rejects callback replay. It optionally obtains the basic TruckersMP outcome without exposing IDs/profile names.

Read only the sanitized result, then clean the exact printed owned allocation:

```sh
node scripts/external-identities-live.mjs status <printed-run>
node scripts/external-identities-live.mjs stop <printed-run>
```

Result output contains candidate SHA, pending/completed state, verification/password-login/replay booleans and a fixed TruckersMP status only. Pending/provider/user-interaction failures never equal mocked success. Do not collect Docker/HTTP/browser logs as evidence. `stop` validates the ownership record, removes only this random Compose project and its volume (including the real mapping), then removes its generated private files. A failed launch/cleanup retains the owned record for the same explicit stop command. Close the private browser context afterward; no real identity mapping belongs in delivery reports.

Primary references: [Steam OpenID](https://steamcommunity.com/dev), [OpenID Authentication 2.0](https://openid.net/specs/openid-authentication-2_0.html), [TruckersMP official OpenAPI at the researched commit](https://github.com/TruckersMP/Docs/blob/a4beb9653b9af24ce04169a368ab776c7930540c/openapi/OpenAPI-v2.yml). Public discovery/research is protocol evidence, independently from a real account test.


VTC-038 adds the cached permission-filtered staff projection `GET /api/v1/admin/members/{memberId}/identity` and the [connection UI](administration.md). Staff reads do not refresh the target provider or impersonate the target. Fresh proof-specific replacement, including the serving Director’s own verified Steam request, preserves the protected email/login/leadership channel.
