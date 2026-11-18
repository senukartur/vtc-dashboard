import { readFileSync } from "node:fs";
import type { components } from "@vtc/contracts";
import { newId, type TxContext } from "@vtc/db";
import { expect, test } from "vitest";
import {
  reviewQueueTrip,
  tripDepotRefs,
} from "../../apps/api/src/modules/trips/summary-projection.ts";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

for (const count of [0, 100, 101, 200])
  test(`a trip page resolves ${count} distinct depots within the catalog read limit`, async () => {
    const tx = {} as TxContext;
    const ids = Array.from({ length: count }, () => newId());
    const calls: string[][] = [];
    const refs = await tripDepotRefs(tx, [...ids, ...ids], async (received, batch) => {
      expect(received).toBe(tx);
      if (batch.length > 100) throw new Error("CATALOG_DEPOT_BATCH_BOUND_EXCEEDED");
      calls.push([...batch]);
      return new Map(
        batch.map((id) => [
          id,
          {
            depotId: id,
            cityId: newId(),
            companyId: newId(),
            name: "Fictional depot company",
            code: "fictional_company",
            hidden: false,
            logo: null,
          },
        ]),
      );
    });
    expect(calls.flat()).toEqual(ids);
    expect(calls).toHaveLength(Math.ceil(count / 100));
    expect([...refs.keys()]).toEqual(ids);
    expect([...refs.values()].every((ref) => ref.name === "Fictional depot company")).toBe(true);
  });

test("a missing catalog read port preserves the explicit missing-depot state", async () => {
  expect(await tripDepotRefs({} as TxContext, [newId()], undefined)).toEqual(new Map());
});

test("journal metadata cannot expand the closed Stage 3 queue response", () => {
  const cases = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
  ).cases;
  const base = cases.find((item: { id: string }) => item.id === "getTrip:success").response
    .data as components["schemas"]["TripSummary"];
  const summary = {
    ...base,
    originCompany: null,
    destinationCompany: null,
    revenue: { amount: "9007199254740993", currency: "EUR" },
    hardModeResult: "qualified" as const,
    jobType: "freight-market" as const,
    gameMode: "haulmp" as const,
    submittedAt: null,
    event: null,
    futureJournalValue: "synthetic",
  };
  const queue = reviewQueueTrip(summary, "2026-11-12T08:00:00.000Z", 1046);
  const validate = createSchemaValidator().compile({
    $ref: "urn:vtc:browser:v1#/$defs/TripStage3ReviewQueueTrip",
  });
  expect(validate(queue)).toBe(true);
  expect(queue).toMatchObject({
    id: base.id,
    number: 1046,
    gameMode: "haulmp",
    submittedAt: null,
    event: null,
  });
  for (const key of [
    "originCompany",
    "destinationCompany",
    "revenue",
    "hardModeResult",
    "jobType",
    "futureJournalValue",
  ])
    expect(queue).not.toHaveProperty(key);
  expect(validate({ ...queue, revenue: summary.revenue })).toBe(false);
});
