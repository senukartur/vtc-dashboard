# VTC-017 account lifecycle

[VTC-017](https://trello.com/c/GxOre5i3) adds RU/EN account workflows to the existing Yukon Union React shell. Product policy remains in [CONCEPT.MD](../../CONCEPT.MD); [identity](identity.md), [admissions](admissions.md) and the [browser contract](../contracts/dashboard/README.md) own authorization, bounds and wire semantics. This adds no authentication method, schema, production activation or external provider integration.

## Routes and one-time links

`/login`, `/password-recovery`, `/password-reset` and `/invitation` are public account entry points. `/account` requires a checked `/me`; its preferences, verification, password, email and connections sections have fragment anchors. Unimplemented destinations remain unavailable and are filtered by current capabilities. Trainee and Driver have equivalent member navigation; additive staff capabilities come from the server. Synthetic `/foundation` navigation remains separate.

Initial HTML sets `referrer=no-referrer` before resource references. Its synchronous script captures the reserved reset/invitation token into a non-enumerable memory handoff, replaces the current history URL with the canonical path, and discards all query/fragment data before React or resources run. Case and trailing-slash variants match the router. The API also sets `Referrer-Policy: no-referrer`. `main.tsx` consumes/deletes the global handoff before rendering. The mounted route copies it and clears the root handoff after mounting, including development StrictMode. Success clears the route token; disposal abandons feature memory. Reload/back cannot recover the scrubbed proof: reopen the original private link when needed.

GET never redeems. Missing, duplicated or malformed tokens get an unavailable screen. There is no public invitation-details endpoint, so the invitation screen claims no recipient, nickname or expiry. POST alone confirms creation. Expired, used and replaced invitations share request-another-invitation guidance. Redemption creates neither a session nor verified email; normal sign-in follows.

## Session, transport and private state

The app owns one TanStack Query session boundary with checking, authenticated, anonymous/ended and unavailable states. Account entry, relevant commands, focus and online recovery revalidate the real `/me`. Initial public landing/previews do not initiate identity requests. `/me` and pending-email reads have a 15-second client deadline and external cancellation. Network/dependency failures hide account data and offer retry without asserting logout.

Private queries include the access generation; logout, identity switching, confirmed `/me` unauthorized and credential completion advance it, cancel private reads, remove all private DTOs and clear mutation history. Obsolete requests cannot restore another identity's data. Protected forms are disposed with the boundary. A wrong login/code 401 is handled locally, with a separate current-session check for protected commands; it never itself establishes session loss.

Writes use generated DTOs, strict runtime response validation, same-origin credentials, no-store, freshly requested current CSRF, explicit expected statuses, and no automatic retry. Bodyless writes omit JSON body/content type. Declared commands send UUID idempotency keys; preferences additionally send `/me`'s strong ETag as `If-Match`. Passwords, codes and tokens are absent from TanStack mutation variables/history, query keys, browser storage and errors. Attempts live only in feature memory, expire after ten minutes, and retain an immutable payload/key for explicit unchanged uncertain retries. Changed input starts another attempt. This lifetime is a client memory bound, not server proof-expiry policy. Client command deadlines are 15 seconds; timeout does not prove rollback.

Sign-out hides private account content while unresolved. Only a committed logout response, or an independently confirmed invalid session, establishes anonymous state. An uncertain result offers retry and a session check. Server authorization remains authoritative.

## Preferences and protected changes

Saved language and IANA display timezone come from `/me`. Interface-language switching preserves recoverable inputs; confirmed persisted preference changes update the language. A stale preference 409 exposes explicit refresh-for-review, reloads authoritative values, and requires review/reapplication. Personal timezone never changes company reporting periods; an unset company timezone does not prevent preferences.

Verification requests show queued feedback, not a sent/delivered claim. The current email must be verified before password/email change. Password changes require the code sent to that verified channel and the existing 12–128-character technical password policy; login preserves its wider wire bounds. Completion ends all sessions and requires sign-in.

Email replacement follows both proof stages. Confirming the current-channel code returns **202 pending**; the original login address remains authoritative. `/me/email-change` discovers either stage after reload, with its current ID, proposed address and explicit expiry display. A new request replaces either stage. Only committed proposed-address confirmation completes replacement and ends sessions. Wrong, expired, replaced and taken-target proofs have generic feedback without address-availability disclosure. The UI has no administrative bypass.

Connections distinguish a confirmed local session, authoritative `steamVerified`, and outstanding `missingSetup`. Steam linking/TruckersMP and telemetry-token controls are unavailable pending their owning modules. No provider endpoint is fabricated.

## Verification and limits

`test/unit/account.test.ts` checks runtime/contract fixtures, early ingress, bounded reads, bodyless/CSRF/ETag transport, safe failures, immutable replay and canceled late-cache resurrection. Controlled `account.spec.ts` covers RU/EN forms, focused linked summaries, visibility, mobile-menu restoration, links, session loss, preference conflicts and capability navigation; captures contain only nonfunctional synthetic data. `account-real.spec.ts` uses built Fastify/admissions/identity and isolated MySQL/local-mail intents for rendered invitation/login/preferences/logout, verification, password/recovery and reloadable two-proof replacement. Allocation-scoped test keys and mail decryption stay in memory; there is no HTTP inbox/debug endpoint. Destructive journeys use fresh ordinary members, preserving bootstrap credentials. Real journeys disable traces/screenshots/video, use fixed failure categories and compare sensitive values as booleans.

Run `node scripts/test-local.mjs unit` and `node scripts/test-local.mjs e2e` in pinned Docker for development feedback. Delivery independently verifies the exact committed candidate with `node scripts/test-ci.mjs` and the packaged `node deploy/development/test.mjs` rehearsal, including account deep links/assets/early ingress/noindex/no-store/referrer policy. Actual results, rendered review, independent security review and CI belong to the delivery report/PR; these instructions claim none of them. Local queued mail is not real inbox delivery. Hosted activation, VTC-039 hardening, later modules and production acceptance retain separate gates.
