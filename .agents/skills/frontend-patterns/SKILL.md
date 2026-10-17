---
name: frontend-patterns
description: Structure VTCDashboard frontend features, API query flows, forms, and accessible UI states. Use for frontend architecture or workflows spanning components; use react-patterns for individual hooks and components.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# Frontend Patterns

Read the relevant card, [architecture](../../../docs/architecture/README.md), [browser contract](../../../docs/contracts/dashboard/README.md), and existing feature code before changing a flow. [AGENTS.md](../../../AGENTS.md) governs product policy, privacy, ownership, and verification. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Feature boundaries

- Put routing/providers/layout composition in `apps/web/src/app/`, workflows in `features/<feature>/`, and reusable UI/transport/locale helpers in `shared/`. Coordinate router and shared-contract changes with their owner.
- Use React, TypeScript, Vite, React Router, TanStack Query and i18next already selected by this workspace. Check manifests before recommending additional libraries. VTC-012 owns the shadcn/ui foundation; do not assume it already exists.
- Consume reviewed/generated `@vtc/contracts` DTOs and runtime schemas. Do not import API repositories, database clients, or private server models into the browser. Change a missing contract through its owner rather than inventing a parallel response shape.
- Prefer composition and feature-local hooks over a generic service/component framework. Extract shared primitives when their behavior and ownership are actually shared.

## Server state and navigation

- Keep remote state in TanStack Query, transient interaction state locally, and shareable filters/pagination in validated URL parameters. Avoid duplicating query data in component state or context.
- Query keys must include the effective filters, game, sort and cursor, plus any user/access scope needed to prevent cache reuse across identities. Clear sensitive caches on logout/account changes and handle revoked access from server responses.
- Pass cancellation signals to transport, debounce search when appropriate, and discard obsolete requests. Cancel timers/subscriptions on cleanup.
- Invalidate affected lists/details/totals after a successful command. Show server-confirmed results for report decisions, promotions, reconciliation and leadership transfer; speculative UI must not claim those decisions succeeded.
- Use contract-defined pagination. Do not fetch every trip or catalog entry into the browser to filter it. Display labels are localized presentation; selection values remain canonical IDs.

## Forms and content states

- Use labels, field-level translated errors, a form summary when useful, and a clear pending state that prevents accidental duplicate submission. Preserve entered values on recoverable errors. Server validation remains authoritative.
- Model loading, empty, error, partial, success and permission states for the workflow. Distinguish unavailable values from zero and company acceptance from source status. Retain useful current data during background refresh where safe.
- Manual reports follow the contract: no trip-date input, required completion screenshot, canonical catalog values and normalized units. Never turn synthetic examples into production qualification limits.
- Keep evidence and private rejection/decline details permission-filtered on the server. Hiding a received field in JSX is not access control. Do not persist private evidence or credentials in browser storage for convenience.
- Present event times with an explicit user timezone. Company reporting periods follow the configured company timezone; formatting must not change their attribution.

## Accessible interaction

- Start with semantic HTML and the project's existing accessible primitives. Prefer established dialog/select behavior over incomplete custom keyboard/focus handling.
- Dialogs need focus containment, Escape behavior, an accessible name and focus restoration. Dropdowns need correct focus, keyboard and disabled/empty behavior; ARIA attributes alone do not implement these.
- Check narrow/wide layouts, RU/EN expansion, long names, touch targets, visible focus and reduced motion. Use existing CSS/tokens; add an animation dependency only for an actual requirement.
- Use safe translated error messages. Never render raw server exceptions, HTML from untrusted content, or private payloads in diagnostic UI/logs.

## Verification

Verify the changed workflow's user-visible states and contract behavior. Application changes require the contributor baseline; use [react-testing](../react-testing/SKILL.md) for component/browser coverage, [frontend-design-direction](../frontend-design-direction/SKILL.md) for visual decisions, and [react-performance](../react-performance/SKILL.md) when a measured performance problem needs work. Report missing browser/test tooling as pending evidence.
