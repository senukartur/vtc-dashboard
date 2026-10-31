import { expect, test } from "vitest";
import {
  diagnosticLocale,
  TripReadLedger,
  tripReadOperation,
  tripReadOperations,
} from "../e2e/support/trip-read-diagnostics.ts";
test("trip read diagnostics retain only fixed operation/count/status shapes without identities", () => {
  const ledger = new TripReadLedger(),
    privateText = "SYNTHETIC_PRIVATE_SENTINEL";
  ledger.request(`/api/v1/trips/${privateText}`);
  ledger.response(`/api/v1/trips/${privateText}`, 503);
  ledger.request(`/unknown/${privateText}`);
  const snapshot = ledger.snapshot();
  expect(Object.keys(snapshot)).toEqual(tripReadOperations);
  expect(snapshot.trip).toEqual({ requests: 1, responses: 1, lastStatus: 503 });
  expect(snapshot.unclassified).toEqual({ requests: 1, responses: 0, lastStatus: null });
  expect(JSON.stringify(snapshot)).not.toContain(privateText);
  snapshot.trip.requests = 999;
  expect(ledger.snapshot().trip.requests).toBe(1);
});
test("diagnostic counts and statuses are bounded and locale never echoes unexpected content", () => {
  const ledger = new TripReadLedger();
  for (let i = 0; i < 1100; i++) {
    ledger.request("/api/v1/me");
    ledger.response("/api/v1/me", 200);
  }
  expect(ledger.snapshot().self).toEqual({ requests: 1024, responses: 1024, lastStatus: 200 });
  for (const status of [0, 99, 600, 200.5, Number.NaN]) {
    ledger.response("/api/v1/me", status);
    expect(ledger.snapshot().self.lastStatus).toBeNull();
  }
  expect(tripReadOperation("/api/v1/me/upload-policy")).toBe("upload-policy");
  expect(tripReadOperation("/api/v1/notifications")).toBe("shell");
  expect(tripReadOperation("/api/v1/notifications/history")).toBe("notification-history");
  expect(diagnosticLocale("en")).toBe("en");
  expect(diagnosticLocale("ru")).toBe("ru");
  expect(diagnosticLocale("SYNTHETIC_PRIVATE_SENTINEL")).toBe("other");
});
