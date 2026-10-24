import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { entityId, envelope, list, mockCatalogs } from "./catalogs.ts";
import { expect } from "./fixtures.ts";

export const id = "41000000-0000-4000-8000-000000000001",
  cargoId = "63000000-0000-4000-8000-000000000021",
  trailerId = "63000000-0000-4000-8000-000000000022",
  evidenceId = "43000000-0000-4000-8000-000000000030";
const cases = JSON.parse(
  readFileSync(new URL("../../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
).cases;
export const example = (name: string) =>
  structuredClone(cases.find((c: { id: string }) => c.id === name).response);
export async function mockTrips(page: Page) {
  await mockCatalogs(page);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/v1/me") {
      const self = accountFixture("en");
      self.data.capabilities.push("trips.review");
      return route.fulfill({ json: self });
    }
    if (path.startsWith("/api/v1/catalogs/entities")) {
      const historical = path !== "/api/v1/catalogs/entities",
        kind = historical
          ? path.endsWith(cargoId)
            ? "cargo"
            : path.endsWith(trailerId)
              ? "trailer_type"
              : "city"
          : (url.searchParams.get("kind") ?? "city"),
        selectedId = kind === "cargo" ? cargoId : kind === "trailer_type" ? trailerId : entityId,
        locale = url.searchParams.get("locale") === "ru" ? "ru" : "en";
      const entity = {
        id: selectedId,
        revisionId: "61000000-0000-4000-8000-000000000020",
        game: "ets2",
        kind,
        mapNamespace: "base",
        display: {
          entityId: selectedId,
          label: `Fictional ${kind}`,
          requestedLocale: locale,
          renderedLocale: "en",
          englishFallback: locale === "ru",
          retired: false,
        },
        relatedEntityIds: [],
      };
      return route.fulfill({ json: historical ? envelope(entity) : list([entity]) });
    }
    if (path === "/api/v1/trips") {
      const trip = example("getTrip:success").data;
      trip.origin = {
        entityId,
        label: "Fictional North — длинное локализованное название города",
        requestedLocale: "en",
        renderedLocale: "en",
        englishFallback: false,
        retired: false,
      };
      trip.destination = trip.origin;
      trip.actualDistanceM = "0";
      trip.recording = "partial";
      trip.reportingBasis = "unknown";
      trip.sourceKinds = ["manual"];
      return route.fulfill({ json: list([trip]) });
    }
    if (
      path === "/api/v1/events" ||
      path.endsWith("/proposals") ||
      path.endsWith("/correction-requests") ||
      path === "/api/v1/me/manual-drafts"
    )
      return route.fulfill({ json: list([]) });
    if (path === "/api/v1/me/upload-policy")
      return route.fulfill({
        json: envelope({
          enabled: true,
          maxFileBytes: 1048576,
          maxFilesPerReport: 5,
          allowedMimeTypes: ["image/png"],
          policyRevision: 1,
        }),
      });
    if (path === "/api/v1/evidence" || path === `/api/v1/evidence/${evidenceId}`)
      return route.fulfill({
        status: route.request().method() === "POST" ? 202 : 200,
        json: envelope({
          id: evidenceId,
          state: "ready",
          contentType: "image/png",
          byteLength: pngBytes().length,
          originalName: "synthetic.png",
        }),
      });
    if (path === `/api/v1/trips/${id}`)
      return route.fulfill({
        json: example("getTrip:extended-manual-revision"),
        headers: { ETag: '"v1"' },
      });
    return route.fallback();
  });
}
export async function completeForm(page: Page) {
  for (const name of ["Origin city", "Destination city", "Cargo", "Trailer type"])
    await page
      .getByRole("combobox", { name, exact: true })
      .selectOption(name === "Cargo" ? cargoId : name === "Trailer type" ? trailerId : entityId);
  await page.getByLabel("Cargo mass (kg)", { exact: true }).fill("1000");
  await page.getByLabel("Actual driven distance (m)", { exact: true }).fill("0");
  await page
    .getByLabel("Choose completion screenshot", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
  const requests: { method: string; path: string }[] = [];
  const record = (request: import("@playwright/test").Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/"))
      requests.push({ method: request.method(), path: url.pathname });
  };
  page.on("request", record);
  await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
  await expect(page.getByText("Ready · image/png", { exact: false })).toBeVisible();
  await page.waitForTimeout(250);
  page.off("request", record);
  expect(
    requests
      .filter((r) => r.method === "GET")
      .map((r) => r.path)
      .sort(),
  ).toEqual(["/api/v1/auth/csrf", `/api/v1/evidence/${evidenceId}`].sort());
  console.log(
    JSON.stringify({
      event: "trip_browser_measurement",
      action: "synthetic_upload",
      reads: requests.filter((r) => r.method === "GET").length,
      writes: requests.filter((r) => r.method === "POST").length,
    }),
  );
}
