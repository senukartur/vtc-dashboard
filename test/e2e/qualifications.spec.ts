import type { Page } from "@playwright/test";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";
import { driverId, mockQualifications, qid } from "./support/qualifications-ui.ts";

// Desktop rows and phone cards both carry one entry per level inside the ladder card.
const ladder = (page: Page) => page.locator(".qualification-ladder-card");
async function open(
  page: Page,
  lead: boolean,
  path = "/account/qualifications",
  qualifiedTop = false,
) {
  const mock = await mockQualifications(page, { lead, qualifiedTop });
  await page.goto(path);
  await switchLanguage(page, "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return mock;
}
const writes = (mock: Awaited<ReturnType<typeof mockQualifications>>) =>
  mock.requests.filter((request) => request.method !== "GET");

test(
  "a driver sees the ladder, their own level and a level page without management controls",
  browserCase(["@functional"]),
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
    // The next-level column names the following level, so only the row header proves the order.
    await expect(ladder(page).getByRole("rowheader").first()).toContainText("Fictional Driver");
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
    await change.getByLabel("New level in ETS2").selectOption({ label: "2 · Fictional Driver" });
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
    await removal.getByLabel("Move drivers to").selectOption({ label: "1 · Fictional Trainee" });
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

test(
  "an info tip opens with Enter or Space, closes with Escape and returns focus",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, false);
    const trigger = page.getByRole("button", { name: "How qualifications work", exact: true });
    const content = page.locator(".info-tip-content");
    for (const key of ["Enter", "Space"]) {
      await trigger.focus();
      await page.keyboard.press(key);
      await expect(content).toBeVisible();
      await expect(content).toContainText("A level decides which trips the company credits.");
      // Focus moves into the explanation, so a screen reader reads it.
      await expect(content).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(content).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  },
);

test(
  "an info tip shows on hover over an opaque surface, and a click keeps it open",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install();
    await open(page, false);
    const trigger = page.getByRole("button", { name: "How qualifications work", exact: true });
    const content = page.locator(".info-tip-content");
    await trigger.hover();
    await expect(content).toBeVisible();
    // The page behind must not show through the explanation.
    const surface = await content.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, border: style.borderTopStyle };
    });
    expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.border).toBe("solid");
    await content.hover();
    await expect(content).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(content).toHaveCount(0);

    await trigger.hover();
    await trigger.click();
    await page.mouse.move(0, 0);
    // Well past the hover close delay: only a pinned tip is still shown.
    await page.clock.runFor(1000);
    await expect(content).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(content).toHaveCount(0);
  },
);

test(
  "a hover preview leaves keyboard focus where it was",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, true, "/account/qualifications/new?game=ets2");
    const name = page.getByLabel("Name", { exact: true });
    const content = page.locator(".info-tip-content");
    await name.focus();
    await page.getByRole("button", { name: "About trip limits", exact: true }).hover();
    await expect(content).toBeVisible();
    // Straight on to a neighbouring tip: the first one closing must not close the second.
    const distance = page.getByRole("button", { name: "About trip distance", exact: true });
    await distance.hover();
    await expect(content).toHaveCount(1);
    await expect(content).toContainText("The actual distance counts");
    await page.mouse.move(0, 0);
    await expect(content).toHaveCount(0);
    await expect(name).toBeFocused();
    await page.keyboard.type("Fictional");
    await expect(name).toHaveValue("Fictional");
    // Escape during a preview closes it and still leaves focus in the input.
    await distance.hover();
    await expect(content).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(content).toHaveCount(0);
    await expect(name).toBeFocused();
  },
);

test(
  "placing a level above the top shows how many drivers move up before saving",
  browserCase(["@functional"]),
  async ({ page }) => {
    // The top has conditions that its fictional veteran already meets.
    const mock = await open(page, true, "/account/qualifications/new?game=ets2", true);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New qualification");
    const warning = page.locator(".qualification-warning");
    await expect(warning).toHaveText(
      "After saving, 1 driver on “Fictional Driver” moves to “the new level” at once.",
    );
    await page.getByLabel("Name", { exact: true }).fill("Fictional Senior");
    await expect(warning).toHaveText(
      "After saving, 1 driver on “Fictional Driver” moves to “Fictional Senior” at once.",
    );
    // Below the top the new level promotes nobody.
    await page
      .getByLabel("Place in the ladder")
      .selectOption({ label: "After “Fictional Trainee”" });
    await expect(warning).toHaveCount(0);
    await switchLanguage(page, "ru");
    await page
      .getByLabel("Место в лестнице")
      .selectOption({ label: "После «Fictional Driver» — высший" });
    await expect(warning).toHaveText(
      "После сохранения 1 водитель с «Fictional Driver» сразу перейдёт на «Fictional Senior».",
    );
    expect(writes(mock)).toEqual([]);
    // Moving the first level down puts it above the top: the count is confirmed before saving.
    await switchLanguage(page, "en");
    await page.goto("/account/qualifications");
    await page.getByRole("button", { name: "Move “Fictional Trainee” down" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "“Fictional Driver” will no longer be the top level: 1 driver on it moves to “Fictional Trainee” at once.",
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes(mock)).toEqual([]);
    await page.getByRole("button", { name: "Move “Fictional Trainee” down" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move level" }).click();
    await expect
      .poll(() => writes(mock))
      .toEqual([
        {
          method: "PUT",
          path: `/admin/qualification-levels/${qid(1)}/position`,
          body: { expectedVersion: 1, position: 2 },
        },
      ]);
  },
);
