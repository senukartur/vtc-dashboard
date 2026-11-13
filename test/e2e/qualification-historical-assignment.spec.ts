import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { envelope } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { mockQualifications } from "./support/qualifications.ts";

const archivedId = "d4200000-0000-4000-8000-000000000001";
const secondId = "d4200000-0000-4000-8000-000000000002";
const assignmentId = "d4200000-0000-4000-8000-000000000003";
const name = "Fictional historical tier";

test.use({ trace: "off", screenshot: "off", video: "off" });

test(
  "staff can select a retained archived level only for a historical interval",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockQualifications(page);
    const reads: string[] = [];
    let input: unknown;
    await page.route("**/api/v1/admin/qualification-levels/archived?**", (route) => {
      const query = new URL(route.request().url()).searchParams;
      const cursor = query.get("cursor");
      reads.push(query.toString());
      return route.fulfill({
        json: envelope({
          items: [
            {
              id: cursor ? secondId : archivedId,
              name: cursor ? "Fictional other tier" : name,
              game: "ets2",
            },
          ],
          nextCursor: cursor ? null : "synthetic-next-archived-page",
        }),
      });
    });
    await page.route(`**/api/v1/admin/members/${fixtureId}/qualification-assignments`, (route) => {
      input = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        headers: { etag: '"v8"' },
        json: envelope({
          id: assignmentId,
          periodId: assignmentId,
          levelId: archivedId,
          game: "ets2",
          assignedAt: "2020-01-01T00:00:00.000Z",
        }),
      });
    });
    await page.goto("/account/qualifications?game=ets2");
    const purpose = page.locator("#assignment-purpose");
    const liveChoices = page.locator("#assignment-level");
    const archived = page.getByLabel("Archived levels", { exact: true });
    await expect(purpose).toBeVisible();
    expect(reads).toEqual([]);
    await expect(liveChoices.getByRole("option", { name, exact: true })).toHaveCount(0);
    await purpose.selectOption("historical_resolution");
    await expect(archived.getByRole("option", { name, exact: true })).toHaveCount(1);
    await archived.selectOption(archivedId);
    await page.getByRole("button", { name: "Next page", exact: true }).first().click();
    await expect(
      archived.getByRole("option", { name: "Fictional other tier", exact: true }),
    ).toHaveCount(1);
    await expect(archived).toHaveValue(archivedId);
    expect(reads).toEqual([
      "game=ets2&limit=25",
      "game=ets2&limit=25&cursor=synthetic-next-archived-page",
    ]);

    await purpose.selectOption("administrative_correction");
    await expect(archived).toHaveCount(0);
    await expect(liveChoices).toHaveValue("");
    await expect(liveChoices.getByRole("option", { name, exact: true })).toHaveCount(0);
    await purpose.selectOption("historical_resolution");
    await expect(archived).toHaveValue("");
    await archived.selectOption(archivedId);
    await page.locator("#assignment-start").fill("2020-01-01T00:00");
    await page.locator("#assignment-end").fill("2020-01-02T00:00");
    await page.locator("#assignment-reason").fill("Fictional historical assignment");
    await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("ETS2 · Archived level", { exact: true })).toBeVisible();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await expect(dialog.getByText(archivedId, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(input).toEqual({
      game: "ets2",
      levelId: archivedId,
      purpose: "historical_resolution",
      reason: "Fictional historical assignment",
      assignedAt: "2020-01-01T00:00:00.000Z",
      endedAt: "2020-01-02T00:00:00.000Z",
    });
  },
);
