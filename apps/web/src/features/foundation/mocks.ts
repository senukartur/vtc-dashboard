import type { components, operations } from "@vtc/contracts";
import type { Locale } from "../../shared/formatting.js";

type TripList = operations["listTrips"]["responses"][200]["content"]["application/json"];
type Catalog = operations["getCatalogEntity"]["responses"][200]["content"]["application/json"];
type Analytics = operations["getCompanyAnalytics"]["responses"][200]["content"]["application/json"];
type ErrorResponse = components["schemas"]["Error"];
export const fixtureId = "41000000-0000-4000-8000-000000000001";
const meta = { requestId: "synthetic-request-001" };

/** Explicit injection seam for presentation examples only; never used by readiness transport. */
export function createFoundationMocks(locale: Locale) {
  const catalog: Catalog = {
    data: {
      id: fixtureId,
      revisionId: fixtureId,
      game: "ets2",
      kind: "city",
      mapNamespace: "synthetic-example",
      display: {
        entityId: fixtureId,
        label: "Fixture City — North Riverside Distribution Centre",
        requestedLocale: locale,
        renderedLocale: "en",
        englishFallback: locale === "ru",
        retired: false,
      },
      relatedEntityIds: [],
    },
    meta: { ...meta },
  };
  const trips: TripList = {
    data: {
      items: [
        {
          view: "summary",
          id: fixtureId,
          version: 1,
          owner: { id: fixtureId, nickname: "Fixture Driver", formerMember: false, roles: [] },
          game: "ets2",
          outcome: "delivered",
          decision: "accepted",
          origin: { ...catalog.data.display },
          destination: {
            ...catalog.data.display,
            entityId: "41000000-0000-4000-8000-000000000002",
            label:
              locale === "ru"
                ? "Вымышленный южный логистический терминал"
                : "Fictional Southern Logistics Terminal",
            renderedLocale: locale,
            englishFallback: false,
          },
          cargo: null,
          actualDistanceM: "12500.5",
          reportingAt: "2026-10-17T12:00:00.000Z",
          sourceKinds: ["ets2telemetry"],
        },
      ],
      nextCursor: null,
    },
    meta: { ...meta },
  };
  // Base provenance: listTrips:empty/error-403, getCatalogEntity:english-fallback,
  // getCompanyAnalytics:success in docs/contracts/dashboard/examples.json.
  const empty: TripList = { data: { items: [], nextCursor: null }, meta: { ...meta } };
  const forbidden: ErrorResponse = {
    error: { code: "FORBIDDEN", messageKey: "errors.forbidden", retryable: false },
    meta: { requestId: "synthetic-request-002" },
  };
  const analytics: Analytics = {
    data: {
      acceptedTrips: 1,
      actualDistanceM: "12500.5",
      reportingTimezone: "UTC",
      fromDate: "2026-10-17",
      toDateExclusive: "2026-10-18",
      granularity: "day",
      buckets: [{ date: "2026-10-17", acceptedTrips: 1, actualDistanceM: "12500.5" }],
      computedAt: "2026-10-17T12:00:00.000Z",
      projectionVersion: 1,
      projectionPending: false,
    },
    meta: { ...meta },
  };
  const partial: TripList = {
    data: {
      items: trips.data.items.map((row) => ({ ...row, actualDistanceM: null })),
      nextCursor: null,
    },
    meta: { ...meta },
  };
  return { catalog, trips, empty, forbidden, analytics, partial };
}
export type FoundationMocks = ReturnType<typeof createFoundationMocks>;
