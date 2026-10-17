import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { utcDateTime, utcIso } from "@vtc/db";

export function clock(initial = "2026-01-31T23:59:59.000Z") {
  let instant = utcIso(utcDateTime(initial));
  return {
    nowUtc: () => instant,
    set(value: string) {
      instant = utcIso(utcDateTime(value));
    },
    advance(milliseconds: number) {
      if (!Number.isSafeInteger(milliseconds)) throw new Error("INVALID_CLOCK_ADVANCE");
      this.set(new Date(Date.parse(instant) + milliseconds).toISOString());
    },
  };
}

export function idGenerator(seed = "synthetic") {
  let sequence = 0;
  return {
    nextId() {
      const bytes = createHash("sha256").update(`${seed}:${sequence++}`).digest().subarray(0, 16);
      bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
      bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
      const hex = bytes.toString("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}

export const telemetryExamples = [
  "started",
  "completed",
  "cancelled",
  "closed-partial",
  "corrected",
  "backfill",
] as const;
export type TelemetryExample = (typeof telemetryExamples)[number];
// Read canonical committed bytes on every call: callers cannot mutate another test's fixture.
export function telemetryFixture(name: TelemetryExample): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`../../docs/contracts/examples/telemetry-${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

export function memberFixture(ids = idGenerator()) {
  return {
    id: ids.nextId(),
    email: "driver@example.invalid",
    name: "Synthetic Driver",
    games: ["ets2"],
    roles: ["driver"],
  };
}
