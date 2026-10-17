# Telemetry contract examples

These are original, fictional records for [telemetry HTTP v1.0](../telemetry-v1.md). They contain no real driver, game capture, source catalog corpus, account, token or active service URL. `origin: game` exercises the production-shaped request schema in a test fixture; it does not assert that a real game produced this data. Never upload these examples to a real company endpoint.

| File | Purpose |
| --- | --- |
| `telemetry-started.json` | Complete observed opening with opaque source IDs and unknown retail build/locale |
| `telemetry-completed.json` | Full terminal summary; does not need the start request to arrive first |
| `telemetry-cancelled.json` | Actual cancellation with zero-valued facts preserved |
| `telemetry-closed-partial.json` | Interrupted/late-attach recording with unavailable true start and incomplete observations |
| `telemetry-backfill.json` | Initial automatic history upload; first snapshot of this terminal trip, not fabricated current activity |
| `telemetry-corrected.json` | Higher terminal revision, immutable prior source event; confirmed effects still require review |

All source sequence values and exact money are strings. Expected income preserves native `u64`; revenue/penalty preserve `s64`. Unknown game mode uses `none` method/confidence; known modes require the evidence combinations defined by the contract. Trailer body/chain and cargo unit/actual mass remain distinct. Fictional source names/IDs are not licensed game data or approved production limits. The examples illustrate wire structure; they are not evidence that any server, token flow, catalog mapping, company acceptance or source fact is implemented/verified.

The [JSON Schema](../telemetry-v1.schema.json) validates structural request shape. [Acceptance scenarios](../telemetry-v1-acceptance.md) additionally cover byte/depth/uint64 bounds, authorization, cross-event consistency, retries, MySQL durability, concurrent races and domain decisions. Passing a schema check does not satisfy those implementation gates.
