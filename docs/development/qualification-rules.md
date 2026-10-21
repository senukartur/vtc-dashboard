# Pure Qualification Rules Engine and Evaluators

[VTC-027](https://trello.com/c/h9cPLb6I) implements the pure, deterministic qualification rules engine and evaluators for VTCDashboard.

## Architectural Boundaries

The qualification rules module (`apps/api/src/modules/qualification-rules`) is strictly pure:
- **Zero I/O or state**: No database queries, network calls, filesystem operations, session ownership, or ambient clocks.
- **Pure input/output**: Takes `NormalizedTripEvidence`, an array of immutable `Rule` definitions, and an `EvaluationContext`, and returns an explainable `QualificationEvaluationResult`.
- **Downstream integration**:
  - Persistent qualification levels and rule versions belong to **VTC-028**.
  - Acceptance adjudication and immutable decision storage belong to **VTC-029**.
  - Progress aggregation projections and watermarks belong to **VTC-032**.

## Separation of Four Concerns

The engine explicitly separates four independent domain concerns:

```
+-----------------------------------------------------------------------------+
|                                Trip Sources                                 |
|                   (ETS2 Telemetry, Manual Trip Reports)                     |
+-----------------------------------------------------------------------------+
                                      |
                                      v
                        [ NormalizedTripEvidence ]
                                      |
        +-----------------------------+-----------------------------+
        |                                                           |
        v                                                           v
+-------------------------------+           +-------------------------------+
|    Company Trip Acceptance    |           |    Per-Trip Qualification     |
|   (company-acceptance.ts)     |           |        (registry.ts)          |
|                               |           |                               |
| - Outcome: delivered          |           | - max_mass                    |
| - Recording: complete         |           | - allowed_trailer_types       |
| - Distance: supported > 0     |           | - allowed_adr_categories      |
| - Manual: screenshot attached |           +-------------------------------+
+-------------------------------+                           |
        |                                                   v
        |                                   +-------------------------------+
        |                                   |  Event Prescribed Load Bypass |
        |                                   |     (event-exception.ts)      |
        |                                   |                               |
        |                                   | - Attendance confirmed        |
        |                                   | - Matches prescribed load     |
        |                                   | - Bypasses 3 ordinary rules   |
        +-----------------------------+     +-------------------------------+
                                      |                     |
                                      v                     v
                        +---------------------------------------+
                        |      Adjudication Decision (VTC-029)  |
                        +---------------------------------------+
                                      |
                                      v
                        +---------------------------------------+
                        |   Qualification Progress (VTC-027/28) |
                        |      (qualification-progress.ts)      |
                        |                                       |
                        | - Aggregated accepted canonical trips |
                        | - requiredTrips threshold             |
                        | - requiredDistanceM threshold         |
                        | - Evaluates promotion eligibility     |
                        +---------------------------------------+
```

1. **Per-Trip Qualification Rules (`registry.ts`, `evaluators/*`)**: Evaluates whether an individual trip conforms to the driver's current qualification level restrictions (`max_mass`, `allowed_trailer_types`, `allowed_adr_categories`).
2. **Company Event Prescribed Load Exception (`event-exception.ts`)**: Evaluates whether a confirmed event attendance authorizes bypassing ordinary qualification limits for the prescribed load (Scenario 14).
3. **Company Trip Acceptance (`company-acceptance.ts`)**: Evaluates general trip validity (delivered outcome, recording completeness, supported distance, manual screenshot) independently of driver qualification limits.
4. **Qualification Progress Conditions (`qualification-progress.ts`)**: Evaluates aggregated trip counts and actual distance toward level promotion thresholds (`requiredTrips`, `requiredDistanceM`).

## Three-Valued Logic (`pass` | `fail` | `unknown`)

All rule evaluations produce one of three outcomes:
- `pass`: All required facts are known, supported, and within configured limits.
- `fail`: A proven violation is established by known evidence (e.g. observed mass exceeds `maxKg`, disallowed trailer type present, disallowed ADR category).
- `unknown`: One or more required facts are missing, incomplete, or unresolvable (e.g. unknown mass, incomplete trailer chain, unknown ADR category).

> [!IMPORTANT]
> **Product Invariant**: Unknown data MUST NOT be treated as proof of a violation. Incomplete facts leave the evaluation outcome as `unknown`, surfacing the trip for staff review rather than rejecting it.

### Outcome Aggregation

When evaluating an array of rules:
1. If **any** rule evaluates to `fail`, the overall outcome is `fail`.
2. Else if **any** rule evaluates to `unknown`, the overall outcome is `unknown`.
3. Otherwise, the overall outcome is `pass`.

## Exact Non-Negative Decimal Arithmetic (`decimal.ts`)

Cargo mass and distance values are canonical non-negative decimal strings. The engine strictly avoids IEEE 754 floating-point numbers:
- `compareDecimal(a, b): -1 | 0 | 1`: Exact string alignment comparison. Compares integer length, then lexicographical digits, then zero-padded fractional parts.
- `shiftDecimal(value, places): string`: Lossless base-10 shifting for unit conversions (e.g. `kgToTon` shifts 3 places to the left, `tonToKg` shifts 3 places to the right).
- `subtractDecimal(a, b): string`: Exact arbitrary-precision subtraction using `BigInt` digit alignment with underflow protection (`a >= b`).
- `isValidNonNegativeDecimal(value): boolean`: Validates strings against `/^(?:0|[1-9]\d*)(?:\.\d+)?$/`.

## Declarative Rule Registry and Extensibility (`registry.ts`)

`RuleEvaluatorRegistry` manages typed evaluators and enforces security constraints:
- **No dynamic execution**: Rejects arbitrary executable JavaScript, `eval()`, `new Function()`, or dynamic expressions from stored JSON.
- **Strict schema validation**: Every rule configuration must match its registered schema without extra properties:
  - `max_mass`: `{ type: "max_mass", maxKg: string }`
  - `allowed_trailer_types`: `{ type: "allowed_trailer_types", entityIds: string[] }`
  - `allowed_adr_categories`: `{ type: "allowed_adr_categories", entityIds: string[] }`
- **Extensible**: New rule evaluators implementing `RuleEvaluator<R>` can be registered into custom or default registries.

## Event Prescribed Load Exception Precedence (Scenario 14)

Company policy authorizes drivers participating in company-wide events to carry the load prescribed by the event, regardless of ordinary qualification limits:
- **Attendance confirmation required**: Driver attendance must be explicitly confirmed (`attendanceRevisionId` present and non-empty). An RSVP alone without attendance confirmation does not authorize the exception.
- **Prescribed load matching**: If the event specifies prescribed cargo, mass, or trailer type, the trip evidence must match all specified non-null fields.
- **Scope of bypass**: The exception bypasses only the three ordinary qualification rules (`max_mass`, `allowed_trailer_types`, `allowed_adr_categories`).
- **Acceptance invariant**: The exception **never** bypasses company trip acceptance rules (lifecycle outcome, recording completeness, distance support, screenshot requirement).

## Verification and Testing

The implementation is verified by:
- `test/unit/qualification-rules.test.ts`: Complete unit test suite verifying boundary values, floating-point precision elimination, missing/incomplete facts, ADR mapping, event bypass precedence, company acceptance, progress calculations, and normative scenarios (Scenarios 2, 11, 12, 14, 18, 32, 36).
- Synthetic test fixtures: `test/fixtures/qualification-rules/synthetic-rules.ts` and `test/fixtures/qualification-rules/fixtures.ts`.
