import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedAllocation } from "../../support/environment.ts";
export function browserTripConfig() {
  const allocation = guardedAllocation();
  const key = (kind: string) =>
    createHmac("sha256", allocation.token).update(`browser-trips-${kind}`).digest("hex");
  return {
    trips: { cursorKey: key("trips") },
    manual: {
      key: key("manual"),
      maxFilesPerReport: 5,
      policyRevision: 1,
      orphanGraceMs: 60000,
      storage: {
        root: join(tmpdir(), `vtc-browser-evidence-${allocation.run}`),
        maxFileBytes: 1048576,
        maxPixels: 1000000,
        timeoutMs: 10000,
      },
    },
    qualifications: { cursorKey: key("qualifications") },
    events: { cursorKey: key("events") },
    reconciliation: {
      key: key("reconciliation"),
      rule: {
        version: 1,
        startToleranceMs: 1000,
        endToleranceMs: 1000,
        distanceToleranceM: "0.01",
      },
    },
    decisions: { key: key("decisions") },
  };
}
