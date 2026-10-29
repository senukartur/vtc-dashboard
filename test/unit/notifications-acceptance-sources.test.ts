import { expect, test } from "vitest";
import {
  acceptanceSourcePayload,
  acceptanceSourceStream,
  type AcceptanceSourceKind,
} from "../../apps/api/src/notifications-acceptance-sources.ts";
import { telemetryAdapter } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";

const at = 1792227600000;
const ids = {
  sourceId: "00000400-0000-4000-8000-000000000001",
  eventId: "00000100-0000-4000-8000-000000000001",
  installationId: "00000200-0000-4000-8000-000000000001",
  bindingId: "00000300-0000-4000-8000-000000000001",
};

test.each<AcceptanceSourceKind>(["fresh", "backfill", "unknown", "delayed", "completed"])(
  "the exact acceptance %s payload satisfies the production telemetry adapter",
  (kind) => {
    const payload = acceptanceSourcePayload(kind, at, {
      ...ids,
      ...acceptanceSourceStream(kind, at, ids),
    });
    expect(() => telemetryAdapter.identity(payload)).not.toThrow();
    expect(payload.createdUtcMs).toBe(at);
    expect(payload.delivery.mode).toBe(kind === "backfill" ? "backfill" : "live");
    expect(payload.snapshot.start.utcMs).toBe(
      kind === "unknown"
        ? null
        : at -
            (kind === "completed" ? 1000 : kind === "backfill" || kind === "delayed" ? 180000 : 0),
    );
    if (kind === "unknown") {
      expect(payload.snapshot.start).toEqual({ utcMs: null, basis: "unknown", eventSeq: null });
      const invalid = structuredClone(payload);
      invalid.snapshot.start.eventSeq = "9007199254740993";
      expect(() => telemetryAdapter.identity(invalid)).toThrow("INVALID_TELEMETRY_ENVELOPE");
    }
  },
);

test("terminal-before-start keeps the same source identity without mutating the public templates", () => {
  const stream = acceptanceSourceStream("completed", at, ids);
  const terminal = acceptanceSourcePayload("completed", at, { ...ids, ...stream });
  const started = acceptanceSourcePayload("fresh", at + 1000, {
    ...ids,
    ...stream,
    eventId: "00000100-0000-4000-8000-000000000002",
  });
  const terminalKey = telemetryAdapter.identity(terminal),
    startedKey = telemetryAdapter.identity(started);
  expect(startedKey.sessionKey).toEqual(terminalKey.sessionKey);
  expect(startedKey.tripKey).toEqual(terminalKey.tripKey);
  expect(startedKey.eventKey).not.toEqual(terminalKey.eventKey);
  expect(started.snapshot.start.utcMs).toBe(terminal.snapshot.start.utcMs);
  expect(terminal.snapshot.start.utcMs).toBeLessThan(terminal.snapshot.end!.utcMs!);
  expect(terminal.snapshot.end!.utcMs).toBe(at);
  expect(started.createdUtcMs).toBeGreaterThan(terminal.snapshot.end!.utcMs!);
  expect(terminal.snapshot.outcome).toBe("delivered");
  expect(started.snapshot.outcome).toBe("open");
  terminal.snapshot.start.utcMs = 0;
  expect(acceptanceSourcePayload("completed", at, { ...ids, ...stream }).snapshot.start.utcMs).toBe(
    at - 1000,
  );
});
