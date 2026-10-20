import type { Request } from "@playwright/test";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
import { resetAccountLimits, staffContext } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("real catalog upload, durable import, review, publication, localized selection and retirement history", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  let phase = "START";
  const inFlight = new Set<Request>();
  let peakInFlight = 0,
    unavailableResponses = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/")) {
      inFlight.add(request);
      peakInFlight = Math.max(peakInFlight, inFlight.size);
    }
  });
  page.on("requestfinished", (request) => inFlight.delete(request));
  page.on("requestfailed", (request) => inFlight.delete(request));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/v1/") && response.status() === 503)
      unavailableResponses++;
  });
  const staff = await staffContext();
  try {
    await resetAccountLimits();
    await context.addCookies((await staff.storageState()).cookies);
    const data = artifact("ats", [
      entity("browser_region", { kind: "region" }),
      entity("browser_city", {
        regionKey: "browser_region",
        labels: { en: "Fictional Browser City", ru: null },
      }),
    ]);
    phase = "IMPORT";
    await page.goto("/account/catalogs");
    await catalogLanguage(page);
    await page.getByRole("combobox", { name: "Game", exact: true }).selectOption("ats");
    async function importArtifact() {
      const previousCandidate = new URL(page.url()).searchParams.get("candidate");
      await page.getByLabel("Normalized JSON artifact", { exact: true }).setInputFiles({
        name: "synthetic-catalog.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(data)),
      });
      await page.getByRole("button", { name: "Upload artifact", exact: true }).click();
      await expect(page.getByText("Artifact stored", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Start import", exact: true }).click();
      await expect
        .poll(
          () => {
            const next = new URL(page.url()).searchParams.get("candidate");
            return !!next && next !== previousCandidate;
          },
          { timeout: 20000 },
        )
        .toBe(true);
      await expect(
        page.getByRole("heading", { name: "Candidate review", exact: true }),
      ).toBeVisible({ timeout: 20000 });
    }
    async function publish() {
      await page.getByRole("button", { name: "Review publication", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Review reason", { exact: true })
        .fill("Synthetic reviewed browser candidate");
      await dialog.getByRole("button", { name: "Confirm publication", exact: true }).click();
      await expect(page.getByText("Server confirmed publication.", { exact: true })).toBeVisible();
    }
    await importArtifact();
    phase = "REVIEW";
    await expect(page.getByText("synthetic-build", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Coverage", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Fictional base pack · base", exact: true }),
    ).toBeVisible();
    phase = "PUBLICATION";
    await publish();
    await expect(
      page.getByRole("combobox", { name: "Cities", exact: true }).locator("option"),
    ).toHaveCount(2);
    const city = page.getByRole("combobox", { name: "Cities", exact: true }),
      chosen = await city.locator("option").nth(1).getAttribute("value");
    if (!chosen) throw new Error();
    await city.selectOption(chosen);
    phase = "LOCALE";
    await catalogLanguage(page, "ru");
    await expect(
      page.getByText("Fictional Browser City · Показано на английском", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Города", exact: true })).toHaveValue(chosen);
    await catalogLanguage(page);
    phase = "RETIREMENT";
    const retiring = data.entities[1];
    if (!retiring) throw new Error();
    retiring.retired = true;
    await importArtifact();
    await publish();
    await expect(page.getByText(/Historical or incompatible selection/)).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Cities", exact: true }).locator("option"),
    ).toHaveCount(1);
    await expect(page.getByText("Fictional Browser City", { exact: true })).toBeVisible();
    phase = "RELOAD";
    await page.reload();
    await catalogLanguage(page);
    await expect(
      page.getByRole("heading", { name: "Candidate review", exact: true }),
    ).toBeVisible();
    expect(unavailableResponses).toBe(0);
  } catch {
    throw new Error(`CATALOG_REAL_${phase}_FAILED`);
  } finally {
    console.log(
      JSON.stringify({
        event: "catalog_browser_measurement",
        project: info.project.name,
        phase,
        peakInFlight,
        unavailableResponses,
      }),
    );
    await staff.dispose();
  }
});
