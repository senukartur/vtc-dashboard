---
name: react-patterns
description: Implement or review VTCDashboard React components and hooks, state placement, effects, composition, forms and error boundaries within the Vite SPA.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# React Patterns

Use the installed React/TypeScript versions and the existing Vite SPA conventions. Read [AGENTS.md](../../../AGENTS.md), the assigned feature and relevant contract first. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Render and hooks

- Keep rendering pure. Derive values from current props/state during render instead of storing synchronized copies through effects.
- Call hooks at the top level. Use functional state updates when the next value depends on the previous one. Update arrays/objects immutably and use canonical stable keys for lists.
- Put user-triggered writes in event handlers or mutation hooks. Effects synchronize external systems; clean up every listener, subscription, timer and obsolete asynchronous operation. Check behavior under development Strict Mode.
- Include actual reactive dependencies. Do not silence dependency warnings or use refs to hide stale data. Use refs for non-rendering mutable handles, not a second state model.
- Extract a hook when it clarifies a domain interaction or removes meaningful repetition; avoid a new abstraction for every effect.

## State placement

| State | Preferred location |
| --- | --- |
| One control or disclosure | Local component state |
| Closely related children | Nearest owner with explicit props |
| Shareable navigation/filter state | Validated router URL/search parameters |
| Locale, theme, stable session presentation | Narrow context/provider |
| API data, loading, mutation lifecycle | Existing TanStack Query layer |

Derive filtered values rather than copying server state. Split contexts by concern when updates affect unrelated consumers. Introduce an external store only when an actual shared-state need warrants it.

## Composition and boundaries

- Prefer explicit props, children and named slots. Use compound components where a real shared interaction needs them; reuse established shadcn/ui primitives once supplied by VTC-012.
- Keep permission-sensitive decisions and qualification rules on the server. Session context can tailor navigation but does not authorize a command.
- Place render-error boundaries around recoverable feature/route areas. Show a safe translated fallback with recovery. Handle event-handler and asynchronous errors explicitly; render boundaries do not catch them automatically.
- Use Suspense for an actual suspending resource such as `React.lazy`; ordinary query loading does not become Suspense-aware merely by adding a boundary. Keep the page shell useful during loading.
- This project has no RSC or Server Actions runtime. Do not add `use server`, `use client`, Next.js routing, or direct database access to SPA components. React form APIs, if useful, still call the Fastify API through the established transport.

## Forms and queries

- Controlled inputs fit values that drive other UI; simple native forms can remain simpler. Check installed form tooling and the VTC-012 plan before adding a form library.
- Use semantic labels, translated errors and explicit pending/success/failure states. Do not duplicate a server command in an effect after submission.
- Use query keys with effective inputs and identity/access scope; forward abort signals and invalidate related queries after committed mutations. Keep canonical IDs distinct from translated labels.
- Do not optimistically present acceptance, promotion or leadership transfer as final. A rejected or stale command must preserve authoritative state and offer a safe refresh/retry.
- Use existing localization helpers for RU/EN, units and dates. Never treat a formatting locale as the company reporting timezone.

## Review and verification

Check hook ordering/cleanup, stale closures, semantic keyboard interaction, empty/error states and stable list identity. Avoid default `memo`, `useMemo` and `useCallback`; apply [react-performance](../react-performance/SKILL.md) when measurements or a concrete identity dependency justify them. Use [react-testing](../react-testing/SKILL.md) for observable behavior and the contributor commands for application changes. Keep private values out of errors, logs and test fixtures.
