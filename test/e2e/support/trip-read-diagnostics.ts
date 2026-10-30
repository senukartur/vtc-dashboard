// Closed operation labels only. Paths are classified and immediately discarded.
export const tripReadOperations = [
  "self",
  "catalog",
  "draft",
  "trip",
  "report",
  "upload-policy",
  "notification-history",
  "event",
  "csrf",
  "evidence",
  "shell",
  "unclassified",
] as const;
type Operation = (typeof tripReadOperations)[number];
export function tripReadOperation(path: string): Operation {
  if (path === "/api/v1/me") return "self";
  if (path.startsWith("/api/v1/catalogs/")) return "catalog";
  if (path === "/api/v1/me/manual-drafts" || path.startsWith("/api/v1/me/manual-drafts/"))
    return "draft";
  if (path === "/api/v1/trips" || path.startsWith("/api/v1/trips/")) return "trip";
  if (path === "/api/v1/manual-reports" || path.startsWith("/api/v1/manual-reports/"))
    return "report";
  if (path === "/api/v1/me/upload-policy") return "upload-policy";
  if (path === "/api/v1/notifications/history") return "notification-history";
  if (path === "/api/v1/events" || path.startsWith("/api/v1/events/")) return "event";
  if (path === "/api/v1/auth/csrf") return "csrf";
  if (path === "/api/v1/evidence" || path.startsWith("/api/v1/evidence/")) return "evidence";
  if (path === "/api/v1/notifications" || path === "/api/v1/me/upcoming-event") return "shell";
  return "unclassified";
}
export type TripReadSnapshot = Record<
  Operation,
  { requests: number; responses: number; lastStatus: number | null }
>;
export class TripReadLedger {
  private counts = Object.fromEntries(
    tripReadOperations.map((operation) => [
      operation,
      { requests: 0, responses: 0, lastStatus: null },
    ]),
  ) as TripReadSnapshot;
  request(path: string) {
    const row = this.counts[tripReadOperation(path)];
    row.requests = Math.min(1024, row.requests + 1);
  }
  response(path: string, status: number) {
    const row = this.counts[tripReadOperation(path)];
    row.responses = Math.min(1024, row.responses + 1);
    row.lastStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  }
  snapshot(): TripReadSnapshot {
    return structuredClone(this.counts);
  }
}
export const diagnosticLocale = (value: string | null) =>
  value === "en" || value === "ru" ? value : "other";
