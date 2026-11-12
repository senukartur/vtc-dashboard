import { readFileSync } from "node:fs";

const examples = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
) as { cases: { id: string; status: number; response: unknown }[] };

const id = (suffix: string) => `e1320000-0000-4000-8000-0000000000${suffix}`;
export const stage2EventId = id("01");
export const stage2LegacyEventId = id("16");
export const stage2DraftId = id("09");
export const stage2MediaId = id("10");

export function stage2Fixture(operation: string, state: string) {
  const key = `${operation}:stage2-${state}`;
  const example = examples.cases.find((value) => value.id === key);
  if (!example) throw new Error(`Missing synthetic event fixture ${key}`);
  return structuredClone(example);
}
