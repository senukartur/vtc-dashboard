---
name: frontend-design-direction
description: Choose and verify a product-specific visual direction for VTCDashboard pages and workflows, with responsive RU/EN layouts, complete content states and rendered accessibility review.
license: MIT
metadata:
  origin: ECC, adapted for VTCDashboard
---

# Frontend Design Direction

Read [AGENTS.md](../../../AGENTS.md), the approved concept, assigned UI card and existing design foundation. [Source and license](../../../docs/development/agent-skills.md#provenance-and-license).

## Choose the direction before implementation

Record the surface, audience, repeated user job, primary action, hierarchy, target viewports and the existing product/reference observation behind important choices. Keep this proportional to the task: a local component refinement can use a short plan note. A palette alone does not define the experience.

- Member/staff operations need clear trip status, readable tables, filters and review actions. Public company/event pages can be more expressive while preserving useful content and navigation.
- Use the existing Yukon Union identity and established tokens/components. Treat a new aesthetic as a design proposal, not an approved change to company branding or product requirements.
- Give the first viewport the actual workflow or requested public content. Avoid filler hero copy, decorative dashboards, unnecessary nested cards and stock imagery that obscures the task.
- Choose typography, spacing, color and one useful distinguishing detail for the domain. Do not enforce a universal palette or ban an existing brand color. Status must remain understandable without color alone.

## Define the states

For each relevant state, identify its trigger, visible feedback and safe next action:

| State | Design concern |
| --- | --- |
| Loading | Stable dimensions and useful progress |
| Empty | Explain the absence and offer an allowed next action |
| Error | Safe localized failure with recovery |
| Partial | Preserve available data and mark unavailable portions |
| Success | Confirm the committed action and supported next step |
| Permission | Explain the boundary without exposing private data |

Mark a state not applicable only with a reason. Missing test access means untested, not not applicable. Mock-only UI remains visibly incomplete until integrated.

## Build within the product system

- Reuse existing React/Vite/Tailwind/routing/i18next conventions and accessible primitives. VTC-012 owns the shadcn/ui foundation; inspect what exists before using or introducing it.
- Make spacing, grids, toolbars and overflow intentional on narrow and wide screens. Test long Russian/English labels, driver names, catalog labels and large numeric values. Do not silently truncate decision-critical information.
- Use semantic landmarks, headings and labels, visible focus, keyboard operation and touch-friendly controls. Dialogs need correct focus management; motion must respect reduced-motion preferences.
- Use real product content or explicitly synthetic fixtures. Use only permitted assets with known provenance; the skill does not authorize copying game assets or publicizing authenticated screenshots.
- Make errors and confirmations serve the user. Do not expose stack details or describe implementation libraries in product copy.
- Prefer native/CSS behavior for small interactions. New dependencies and external design services need an actual task requirement and the applicable authorization.

## Rendered verification

Inspect the rendered interface at the chosen narrow/wide viewports after implementation. Check hierarchy, text fit, alignment, overflow, stable loading layout and applicable states. Exercise keyboard navigation, visible focus, labels, contrast, touch interactions and reduced motion. Fix observed failures and recheck the affected states.

Keep any necessary local screenshots/reports in ignored `.local/` storage; use synthetic data and do not publish private captures. Record viewport, observed result, relevant artifact path and untested states in the task report. Source inspection and self-reported JSON cannot substitute for rendered review. If browser capability is unavailable, report that gate as pending without claiming visual completion.

The ECC evidence checker and optional authenticated design-reference service are not bundled here; the project uses this explicit rendered-review record without installing another tool/service. Use [frontend-patterns](../frontend-patterns/SKILL.md) for UI architecture and [react-testing](../react-testing/SKILL.md) for executable regression coverage.
