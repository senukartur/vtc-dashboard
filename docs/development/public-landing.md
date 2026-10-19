# VTC-016 public landing and membership application

The public company page is available in Russian at `/` and English at `/en`. The language control changes between those routes without storing form data. Company information, the required application fields, the review/invitation explanation and established public community links share one content source. No production totals, qualification thresholds, private contact details or legacy membership data are imported.

## Routes and initial HTML

The web build renders the shared public React content into deterministic RU/EN documents. Both contain meaningful content, language, title and description before JavaScript executes. The client adds the interactive application form. With JavaScript disabled, the page explains how to enable submission and keeps public contact links usable.

The built API selects an indexable public document only for exact, query-free `/` and `/en` URLs. Query-bearing public URLs, unknown routes, `/status`, foundation previews, account/invitation paths and future `/events` and `/login` boundaries receive the noindex shell and `X-Robots-Tag: noindex, nofollow`. Static document filenames also receive that response header. Request/query values are never reflected into generated HTML. HTML and API responses remain `no-store`; fingerprinted JS/CSS retain their existing immutable caching. Reserved API/health/evidence/upload paths and missing assets retain 404 behavior. Vite development serves its ordinary shell; verify initial public HTML against the production build.

`/status` preserves the real cancellable readiness query, pending/error/503/retry semantics and authenticated MySQL baseline probe. `/foundation` and `/foundation/member` remain explicitly synthetic previews. `/events` honestly explains that public listings belong to VTC-035; `/login` explains the pending VTC-017 account screens. These boundaries do not publish participant data or simulate account workflows.

## Submission and recovery

The form collects nickname, invitation email, Steam profile URL and at least one ETS2/ATS choice. Discord and introduction are optional; blank optional fields are omitted. Client technical validation uses generated contract bounds/patterns with the backend's supported Steam URL/mailbox/text constraints. Server validation is authoritative. No provider ownership check is claimed.

A user action obtains same-origin CSRF, then sends one JSON POST to `/api/v1/public/applications` with credentials, a UUID idempotency key and RU/EN `Accept-Language`. Strict success-envelope checks use the generated DTO and runtime-schema bounds/patterns. Only a validated 201 produces the generic acknowledgement. New, duplicate and existing-identity receipts have the same message; receipt IDs, application statuses and email existence are never displayed or looked up.

While pending, controls prevent concurrent accidental submission. A bounded timeout, network failure or malformed result remains uncertain. A manual retry with unchanged normalized form data uses the same payload, key and original command locale (`Accept-Language`), even after changing the interface language. The backend fingerprints the locale with the input. Feedback follows the currently selected interface language. Changed data gets a new key, captures the current command locale and shows an explicit warning that the previous submission might have been saved. There is no automatic mutation retry or mock fallback. CSRF is refreshed on each user retry. A response that rejects the submission preserves input and shows a translated 422/403/409/429/503 message; disabled/unmounted API routes show unavailable. Numeric Retry-After values are bounded to one hour for feedback and submission cooldown; malformed values show generic wait advice. No business eligibility limit is inferred from abuse controls.

Form data, CSRF and receipts live only in component/request memory. They are not put in URLs, browser storage, metadata, analytics or diagnostic logs. Accepted receipt confirmation promises neither membership nor inbox delivery. Staff review, seven-day invitations and native identity behavior remain owned by [VTC-015](admissions.md); live admissions remains disabled by default and requires its separate activation process.

## Verification

`test/unit/landing.test.ts` covers scenario 6 field rules, approved wire-schema fixtures, response validation, safe errors and stable retry keys. `test/e2e/landing.spec.ts` covers initial HTTP HTML/indexing, RU/EN rendered phone/tablet/desktop layouts, skip/navigation/form interaction, pending protection, recovery, changed input and rate/unavailable feedback. Controlled states intercept only the network boundary and save synthetic screenshots under ignored test output.

The separate rendered-form integration submits through the real built VTC-015 API and isolated MySQL/local-mail harness. It verifies 201, identical safe duplicate confirmation, absence of an authenticated session and anonymous staff-read denial. A committed response is deliberately withheld from the browser, then an unchanged retry after switching RU/EN must recover the real 201 using the original payload, key and command locale. Real HTTP material is never traced or captured. Existing API-domain tests continue to own review/redemption/security/concurrency evidence. Readiness journeys retain their real MySQL check at `/status`.

Run `node scripts/test-ci.mjs` for the isolated full candidate suite and `node deploy/development/test.mjs` for local production-packaging rehearsal. Neither command activates admissions, sends real email, deploys the site or establishes production acceptance. Visual captures contain only synthetic public states and must be reviewed before publication.
