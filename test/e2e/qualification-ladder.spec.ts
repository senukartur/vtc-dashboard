import { randomUUID } from "node:crypto";
import type { components } from "@vtc/contracts";
import { resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
type Ladder = components["schemas"]["QualificationLadder"];
const path = "/account/admin/settings?tab=qualifications";
const api = "/api/v1/admin/qualification-ladders/ats";
const labels = {
  en: {
    ladder: "Qualification ladder",
    name: "Level name",
    add: "Add level",
    confirm: "Confirm",
    starting: "Starting level",
    moveUp: "Move {{name}} up",
    saveOrder: "Save level order",
    archive: "Archive {{name}}",
    reviewArchive: "Review archive",
    confirmArchive: "Archive level",
    target: "Transfer drivers to",
    count: "Drivers",
    warning: "Current drivers will move to the selected level with fresh progress.",
    zero: "0 assigned drivers",
  },
  ru: {
    ladder: "Лестница квалификаций",
    name: "Название уровня",
    add: "Добавить уровень",
    confirm: "Подтвердить",
    starting: "Начальный уровень",
    moveUp: "Переместить «{{name}}» выше",
    saveOrder: "Сохранить порядок уровней",
    archive: "Архивировать «{{name}}»",
    reviewArchive: "Проверить архивацию",
    confirmArchive: "Архивировать уровень",
    target: "Перевести водителей на уровень",
    count: "Водители",
    warning: "Текущие водители перейдут на выбранный уровень и начнут прогресс заново.",
    zero: "0 назначенных водителей",
  },
};

for (const locale of ["en", "ru"] as const) {
  test(
    `P11 edits the real ladder, keeps tab/game in the URL and fits the ${locale} viewport`,
    browserCase(["@layout"]),
    async ({ page }) => {
      test.setTimeout(60_000);
      await resetAccountLimits();
      const staff = await staffContext();
      const name = `Fictional long level ${randomUUID().slice(0, 8)} · квалификация`;
      const s = labels[locale];
      async function snapshot() {
        const response = await staff.get(api);
        expect(response.status()).toBe(200);
        const result = (await response.json()).data as Ladder;
        expect(response.headers().etag).toBe(`"v${result.revision}"`);
        return result;
      }
      let needsCleanup = false;
      try {
        const original = await snapshot();
        expect(original.ladderEditsEnabled).toBe(true);
        await page.context().addCookies((await staff.storageState()).cookies);
        await page.goto(path);
        await catalogLanguage(page, locale);
        const panel = page.getByRole("region", { name: s.ladder });
        await panel.getByRole("button", { name: "ATS", exact: true }).click();
        await expect(page).toHaveURL(/tab=qualifications.*game=ats/);
        const table = panel.getByRole("table", { name: s.ladder });
        await expect(table.getByRole("columnheader", { name: s.count })).toHaveCount(1);
        await expect(table.getByText(s.starting, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const add = panel.getByRole("button", { name: s.add, exact: true });
        await expect(add).toBeDisabled();
        await panel.getByLabel(s.name, { exact: true }).fill(name);
        await add.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText(name, { exact: false })).toBeVisible();
        needsCleanup = true;
        await dialog.getByRole("button", { name: s.confirm, exact: true }).click();
        const inserted = table.getByRole("row", { name: new RegExp(name.split(" · ")[0] ?? name) });
        await expect(inserted).toBeVisible();
        const up = table.getByRole("button", {
          name: s.moveUp.replace("{{name}}", name),
          exact: true,
        });
        await up.focus();
        await expect(up).toBeFocused();
        await up.press("Enter");
        await panel.getByRole("button", { name: s.saveOrder, exact: true }).click();
        await dialog.getByRole("button", { name: s.confirm, exact: true }).click();
        await expect.poll(async () => (await snapshot()).levels.at(-2)?.name).toBe(name);
        const latest = await snapshot();
        const archived = latest.levels.find((row) => row.name === name);
        if (!archived) throw new Error("SYNTHETIC_LEVEL_MISSING");
        const previous = latest.levels.find((row) => row.position === archived.position - 1);
        if (!previous) throw new Error("SYNTHETIC_LEVEL_MISSING");
        await table
          .getByRole("button", { name: s.archive.replace("{{name}}", name), exact: true })
          .click();
        await expect(panel.getByLabel(s.target, { exact: true })).toHaveValue(previous.id);
        await expect(panel.getByText(s.zero, { exact: true })).toBeVisible();
        await panel.getByRole("button", { name: s.reviewArchive, exact: true }).click();
        await expect(dialog.getByText(name, { exact: false }).first()).toBeVisible();
        await expect(dialog).toHaveAccessibleDescription(
          new RegExp(s.warning.replaceAll(".", "\\.")),
        );
        await expect(dialog.getByText(s.zero, { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(inserted).toBeVisible();
        await panel.getByRole("button", { name: s.reviewArchive, exact: true }).click();
        const committedArchive = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `${api}/levels/${archived.id}/archive` &&
            response.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: s.confirmArchive, exact: true }).click();
        const archivedResponse = await committedArchive;
        expect(archivedResponse.status()).toBe(200);
        expect(archivedResponse.headers().etag).toBe(`"v${latest.revision + 1}"`);
        await expect(dialog).toHaveCount(0);
        await expect(table).toBeVisible();
        await expect(inserted).toHaveCount(0);
        const refreshed = await snapshot();
        expect(refreshed.revision).toBe(latest.revision + 1);
        expect(refreshed.levels.map((row) => row.id)).toEqual(original.levels.map((row) => row.id));
        needsCleanup = false;
        await page.reload();
        await expect(table).toBeVisible();
        await expect(page).toHaveURL(/tab=qualifications.*game=ats/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      } finally {
        if (needsCleanup) {
          const latest = await snapshot();
          const archived = latest.levels.find((row) => row.name === name);
          const target = latest.levels.find((row) => row.id !== archived?.id);
          if (archived && target) {
            const response = await write(
              staff,
              `/admin/qualification-ladders/ats/levels/${archived.id}/archive`,
              {
                targetLevelId: target.id,
                observedDriverCount: archived.currentDriverCount,
              },
              `"v${latest.revision}"`,
            );
            expect(response.status()).toBe(200);
          }
        }
        await staff.dispose();
      }
    },
  );
}
