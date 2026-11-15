import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { type DTO, schema } from "../../apps/web/src/features/dashboard/transport.ts";

// The web builds response validators with zod's z.fromJSONSchema over the generated document.
// The reader rejects keywords such as dependentRequired, dependentSchemas and if/then/else, so
// every contract schema must convert. Only these existing schemas use if/then/else and are known
// exceptions; trips/transport.ts rewrites ResolutionInput before converting it.
const knownUnsupported = [
  "EnvelopeListTripProposal",
  "EnvelopeTripProposal",
  "EnvelopeTripProposalDecision",
  "ListTripProposal",
  "ResolutionInput",
  "TripProposal",
];

test("every generated contract schema converts with the web's zod JSON Schema reader", () => {
  const document = JSON.parse(
    readFileSync(
      new URL("../../packages/contracts/src/generated/schemas.json", import.meta.url),
      "utf8",
    ),
  ) as { $defs: Record<string, unknown> };
  const failing = Object.keys(document.$defs)
    .filter((name) => {
      try {
        schema(name as keyof DTO);
        return false;
      } catch {
        return true;
      }
    })
    .sort();
  expect(failing).toEqual(knownUnsupported);
});
