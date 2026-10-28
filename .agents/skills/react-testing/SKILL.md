---
name: react-testing
description: Write or review behavior-focused tests for VTCDashboard React components, hooks and journeys, including query/network states, RU/EN, accessibility and permission failures.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# React Testing

Read [AGENTS.md](../../../AGENTS.md), [contributor commands](../../../docs/CONTRIBUTING.md), the card's acceptance criteria and current test configuration. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Identify the available test lane

The root scaffold uses the Node test runner for narrow scaffold checks. VTC-008 owns broader unit/integration/browser tooling; do not assume Vitest, Testing Library, MSW, axe or Playwright are installed. Inspect manifests/configuration and use the established lane. If the assignment owns tooling setup, choose compatible dependencies with the foundation owner; otherwise report the missing capability or coordinate its prerequisite rather than claiming coverage.

| Behavior | Appropriate evidence |
| --- | --- |
| Pure formatting/normalization | Focused unit test |
| Component interaction and API states | React Testing Library in the configured runner, network-level mocks where available |
| Focus, navigation, upload or layout requiring a browser | Selected Playwright journey with synthetic fixtures |
| Permissions, idempotency or transaction races | Server/contract tests and real target-compatible MySQL integration tests |
| Instructions/documentation only | Metadata, links, identifiers, whitespace and public-data checks |

Mocks establish browser behavior; they do not establish server enforcement, MySQL correctness or real delivery. Use meaningful tests required by changed behavior/card risk, not a fixed coverage percentage or snapshots of every component.

## Test through the user interface

- Render with the real provider arrangement: isolated query client, router location, locale and the relevant session presentation. Create a fresh query client per test, clear caches and unmount/clean up timers and handlers.
- Query by role and accessible name or label first. Use `queryBy*` for absence, `findBy*` for asynchronous appearance and test IDs only where semantics cannot identify the element.
- When available, use `userEvent.setup()` and await interactions. Check visible output, supported callbacks or requests; avoid inspecting hook calls, internal state, render counts or incidental DOM structure.
- Prefer asynchronous queries/condition-based waits to arbitrary sleeps. Scope fake timers to timer behavior, advance them deliberately, and restore them after each test.
- Avoid mocking React, router hooks or the query library to force success. Exercise the feature through its public inputs and network boundary.

## Network and state isolation

- Use reviewed contract fixtures with fictional identities and `example.invalid` addresses. Mock the actual endpoint/method/status/DTO rather than making up a convenient shape. Never contact production or real mail/webhook recipients.
- With MSW or an equivalent configured harness, fail unexpected requests, override handlers per case, reset between tests and close the harness. Disable automatic query retries where testing immediate failure; test actual retry policy separately.
- Cover applicable loading, empty, error, partial, success and permission states. Include expired/revoked sessions, stale revisions and server validation failure when the feature exposes them.
- Check mutation pending behavior, prevention of accidental duplicate interaction, successful invalidation and recoverable input preservation. An optimistic display must not assert that a privileged command committed.

## Project-specific regressions

Select the relevant numbered scenarios from `docs/product/mvp-policies.md`; do not replicate the entire product suite for every UI change. Useful cases include:

- Manual-report fields/evidence and absence of an invented trip date; rejected/pending versus accepted totals; stale review revisions and no self-approval action.
- Canonical catalog IDs surviving translation, long RU/EN labels and missing/ambiguous catalog data.
- Explicit event display timezone versus company reporting periods; unavailable values remaining distinct from zero.
- Permission-filtered errors and data: no screenshot/rejection/decline details in unauthorized responses, caches or rendered markup. Browser hiding checks supplement server tests.

Verify keyboard/focus behavior and accessible names. Automated axe checks, when configured, supplement rendered keyboard/contrast review. Run selected browser journeys for actual routing, uploads, focus and responsive layout; a JSDOM assertion does not prove those work.

## Report evidence precisely

Run the contributor baseline for affected application/scaffold changes plus the selected configured tests. State exact commands, candidate/environment, passed/failed/not-run results and missing prerequisites. Never label scaffold checks full E2E, network mocks real integration, or a planned CI check executed evidence. Keep private runtime output and authenticated captures out of Git/public attachments.
