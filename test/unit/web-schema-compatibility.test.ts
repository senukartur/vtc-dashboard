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

test("the web reader parses the member directory status, counts and level fixtures", () => {
  const { cases } = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
  ) as { cases: { id: string; response: unknown }[] };
  const envelope = schema("MemberStage4DirectoryListEnvelope");
  for (const id of [
    "listMembers:stage-4-active-tab",
    "listMembers:stage-4-former-tab",
    "listMembers:stage-4-without-trips",
  ]) {
    const fixture = cases.find((item) => item.id === id);
    expect(fixture, id).toBeDefined();
    const parsed = envelope.safeParse(fixture?.response);
    expect(parsed.success, id).toBe(true);
    expect(parsed.data, id).toEqual(fixture?.response);
  }
  const active = cases.find((item) => item.id === "listMembers:stage-4-active-tab")?.response as {
    data: { items: { levels: object }[] };
  };
  const [row] = active.data.items;
  expect(
    envelope.safeParse({
      ...active,
      data: { ...active.data, items: [{ ...row, levels: { ets2: null } }] },
    }).success,
  ).toBe(false);
});
