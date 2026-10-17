---
name: react-performance
description: Diagnose or improve VTCDashboard React/Vite performance using measured request waterfalls, bundle size, query behavior, render cost and large-list interactions.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# React Performance

Use for a concrete performance investigation or a change likely to introduce expensive fetching/rendering. Start with [AGENTS.md](../../../AGENTS.md), the affected feature, current manifests and build configuration. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Establish a useful baseline

Identify the affected user action, representative synthetic data volume, RU/EN content and narrow/wide viewport. Measure the relevant network timeline, production bundle, React Profiler trace or browser interaction. Record environment and before/after evidence; do not invent universal row-count, bundle-size or millisecond limits.

Prioritize the actual bottleneck: request waterfalls and overfetching, shipped code/assets, cache behavior, expensive rendering, then hot JavaScript paths. A development Strict Mode render count alone is not a performance regression.

## Fetching and work scheduling

- Run independent reads concurrently when authorization is already established. Respect prerequisite authorization and actual dependencies; do not prefetch private evidence before checking access.
- Do not parallelize ordered mutations or queries sharing a transaction connection merely to shorten code. Coordinate backend query changes through its owner and [backend-patterns](../backend-patterns/SKILL.md).
- Use the existing TanStack Query cache with complete filter/user/access keys, cancellation and deliberate invalidation. Avoid duplicate effect-based fetching and global caches of private results.
- Debounce searches when it reduces wasted work, cancel obsolete requests, and keep filter typing responsive. `useDeferredValue` can defer expensive presentation but does not debounce HTTP by itself.
- Preserve contract pagination and polling cadence. Prevent overlapping poll requests and bound retries/backoff. Optional SSE is separate scope; this skill does not authorize a streaming platform.

## Bundle and asset cost

- Inspect Vite's production output before changing imports. Use supported package entrypoints; broad barrels can add cost, but do not break module facades or use unexported internals for a presumed win.
- Lazy-load heavy route/feature code with router-supported lazy routes or `React.lazy` and a useful Suspense fallback. Keep dynamic imports statically analyzable.
- Split optional charts/admin tooling when justified; do not add Next.js `dynamic`, image/script components, SSR configuration or RSC caching APIs to this SPA.
- Size and compress permitted assets, reserve dimensions to avoid layout shift, and lazy-load below-the-fold media. Avoid unnecessary fonts, duplicate dependencies and decorative animation libraries.
- Follow existing fingerprinted-asset caching. Private API/evidence responses must not acquire public caching headers to improve a benchmark.

## Render and JavaScript cost

- Keep frequently changing state near its consumers. Split broad contexts and avoid rebuilding large derived datasets on every keystroke.
- Add `memo`, `useMemo` or `useCallback` only for measured expensive work or a demonstrated stable-identity requirement. Check the whole dependency chain and closure correctness.
- Paginate before considering virtualization. Virtualize genuinely expensive long lists only after measuring and preserving focus, keyboard use, screen-reader access and row identity.
- Prefer maps/sets or precomputed lookups for demonstrated repeated scans. Avoid speculative micro-optimizations, JSON serialization as dependency comparison, and expensive deep equality on every render.
- Use transforms/opacity for necessary animation and respect reduced motion. Never hide a slow operation behind an indefinite animation.

## Verify the result

Repeat the same measurement with comparable data/environment. Confirm loading, errors, permission changes, RU/EN layouts and keyboard behavior still work; use [react-testing](../react-testing/SKILL.md) for regressions. Run contributor checks for affected app code. Report measured improvements, trade-offs and unmeasured areas; a smaller source diff or memoization alone is not evidence of a faster experience.
