import type { Page } from "@playwright/test";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";
import { driverId, mockQualifications, qid } from "./support/qualifications-ui.ts";

// Desktop rows and phone cards both carry one entry per level inside the ladder card.
const ladder = (page: Page) => page.locator(".qualification-ladder-card");
async function open(page: Page, lead: boolean, path = "/account/qualifications") {
  const mock = await mockQualifications(page, { lead });
  await page.goto(path);
  await switchLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return mock;
}
const writes = (mock: Awaited<ReturnType<typeof mockQualifications>>) =>
  mock.requests.filter((request) => request.method !== "GET");

test(
  "a driver sees the ladder, their own level and a level page without management controls",
  browserCase(["@functional", "@smoke-qualifications"]),
  async ({ page }) => {
    const mock = await open(page, false);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Qualifications");
    await expect(ladder(page)).toContainText("Fictional Trainee");
    await expect(ladder(page)).toContainText("Fictional Driver");
    await expect(ladder(page)).toContainText("Highest level");
    const mine = page.locator(".qualification-mine");
    await expect(mine.getByRole("heading", { name: "My level" })).toBeVisible();
    await expect(mine.getByRole("link", { name: "Fictional Trainee" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add qualification" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move “/ })).toHaveCount(0);
    await mine.getByRole("link", { name: "Fictional Trainee" }).click();
    await expect(page).toHaveURL(new RegExp(`/account/qualifications/${qid(1)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional Trainee");
    await expect(page.getByText("Fictional_Driver")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Change level/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
    expect(writes(mock)).toEqual([]);
  },
);

test(
  "a lead adds a level with a promotion condition and the editor sends exact units",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await open(page, true);
    await page.getByRole("link", { name: "Add qualification" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New qualification");
    await page.getByLabel("Name", { exact: true }).fill("Fictional Senior");
    await page
      .getByLabel("Place in the ladder")
      .selectOption({ label: "After “Fictional Trainee”" });
    await page.getByLabel("Trips on the level").fill("10");
    await page.getByLabel("Distance on the level, km").fill("1500,5");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional Senior");
    const [created] = writes(mock);
    expect(created).toMatchObject({
      method: "POST",
      path: "/admin/qualification-levels",
      body: {
        game: "ets2",
        position: 2,
        name: "Fictional Senior",
        conditions: { requiredTrips: 10, requiredDistanceM: "1500500" },
      },
    });
    expect(mock.ladder.map((row) => row.name)).toEqual([
      "Fictional Trainee",
      "Fictional Senior",
      "Fictional Driver",
    ]);
  },
);

test(
  "a lead renames and reorders levels with their versions",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await open(page, true);
    await page.getByRole("button", { name: "Move “Fictional Driver” up" }).click();
    await expect(ladder(page).getByRole("row").nth(1)).toContainText("Fictional Driver");
    expect(writes(mock)).toEqual([
      {
        method: "PUT",
        path: `/admin/qualification-levels/${qid(2)}/position`,
        body: { expectedVersion: 1, position: 1 },
      },
    ]);
    await page.getByRole("link", { name: "Edit “Fictional Trainee”" }).click();
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveValue("Fictional Trainee");
    await name.fill("Fictional Apprentice");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional Apprentice");
    expect(writes(mock)[1]).toMatchObject({
      method: "PUT",
      path: `/admin/qualification-levels/${qid(1)}`,
      body: { expectedVersion: 1, name: "Fictional Apprentice" },
    });
  },
);

test(
  "a lead changes a driver's level with a reason and removes a level with a transfer",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await open(page, true, `/account/qualifications/${qid(1)}`);
    await page.getByRole("button", { name: "Change level for Fictional_Driver" }).click();
    const change = page.getByRole("dialog");
    await expect(change).toContainText("Change level: Fictional_Driver");
    await change.getByLabel("New level in ETS2").selectOption({ label: "Fictional Driver" });
    await change.getByRole("button", { name: "Move", exact: true }).click();
    await expect(change.getByText("Enter a reason.")).toBeVisible();
    expect(writes(mock)).toEqual([]);
    await change.getByLabel("Reason").fill("Fictional manual check");
    await change.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes(mock)).toEqual([
      {
        method: "PUT",
        path: `/admin/members/${driverId}/qualifications/ets2`,
        body: { levelId: qid(2), reason: "Fictional manual check" },
      },
    ]);

    await page.goto(`/account/qualifications/${qid(2)}`);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const removal = page.getByRole("dialog");
    await expect(removal).toContainText("Remove “Fictional Driver”?");
    await expect(removal).toContainText("1 driver is on this level.");
    await removal.getByLabel("Move drivers to").selectOption({ label: "Fictional Trainee" });
    await removal.getByRole("button", { name: "Remove and move" }).click();
    await expect(page).toHaveURL(new RegExp(`/account/qualifications/${qid(1)}`));
    expect(writes(mock)[1]).toEqual({
      method: "POST",
      path: `/admin/qualification-levels/${qid(2)}/removal`,
      body: { expectedVersion: 1, transferLevelId: qid(1) },
    });
    expect(mock.ladder.map((row) => row.name)).toEqual(["Fictional Trainee"]);
  },
);
