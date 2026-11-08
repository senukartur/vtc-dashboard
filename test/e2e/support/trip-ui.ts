import { inertNotifications } from "./notifications.ts";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { catalogItem, entityId, envelope, list, mockCatalogs } from "./catalogs.ts";
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
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/v1/me") {
      const self = accountFixture("en");
      self.data.capabilities.push("trips.review");
      return route.fulfill({ json: self });
    }
    const catalogRow = /^\/api\/v1\/catalogs\/(cities|cargoes|trailers)(?:\/([^/]+))?$/.exec(path);
    if (catalogRow) {
      const name = catalogRow[1],
        locale = url.searchParams.get("locale") === "ru" ? "ru" : "en",
        selectedId = name === "cargoes" ? cargoId : name === "trailers" ? trailerId : entityId,
        label = name === "cargoes" ? "cargo" : name === "trailers" ? "trailer_type" : "city",
        item = catalogItem(selectedId, `Fictional ${label}`, locale);
      return route.fulfill({ json: catalogRow[2] ? envelope(item) : list([item]) });
    }
    if (path === "/api/v1/trips") {
      const trip = example("getTrip:success").data;
      trip.origin = {
        entityId,
        label: "Fictional North — длинное локализованное название города",
        requestedLocale: "en",
        renderedLocale: "en",
        englishFallback: false,
        hidden: false,
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
/**
 * Counts alerts inserted inside `selector` from now on, including ones removed again before an
 * assertion could see them (for example an error that a list replaces with its first page).
 */
export async function countInsertedAlerts(page: Page, selector: string) {
  await page.evaluate((root) => {
    const state = window as unknown as { insertedAlerts: number };
    state.insertedAlerts = 0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of Array.from(record.addedNodes))
          if (
            node instanceof Element &&
            node.closest(root) &&
            (node.matches("[role=alert]") || node.querySelector("[role=alert]"))
          )
            state.insertedAlerts++;
    }).observe(document.body, { subtree: true, childList: true });
  }, selector);
  return () =>
    page.evaluate(() => (window as unknown as { insertedAlerts: number }).insertedAlerts);
}
