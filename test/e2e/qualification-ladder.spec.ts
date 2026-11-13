import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { deferred } from "../support/concurrency.ts";
import { csrf, origin, resetAccountLimits, staffContext, write } from "./support/account.ts";
import { catalogLanguage, envelope, mockCatalogs } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
type Ladder = components["schemas"]["QualificationLadder"];
const ids = [
  "d4100000-0000-4000-8000-000000000001",
  "d4100000-0000-4000-8000-000000000002",
  "d4100000-0000-4000-8000-000000000003",
] as const;
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
    position: "Position",
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
    position: "Позиция",
    count: "Водители",
    warning: "Текущие водители перейдут на выбранный уровень и начнут прогресс заново.",
    zero: "0 назначенных водителей",
  },
};

async function mockLadder(page: Page) {
  const capabilities = ["company.read", "company.configure", "qualifications.manage"];
  await mockCatalogs(page, true, {
    capabilities,
  });
  let revision = 1;
  let order: readonly (typeof ids)[number][] = ids;
  let failNext = false;
  const commands: { etag: string | undefined; key: string | undefined; input: unknown }[] = [];
  await page.route("**/api/v1/admin/qualification-ladders/ats**", async (route) => {
    const request = route.request();
    const etag = `"v${revision}"`;
    if (request.method() === "GET") {
      const data: Ladder = {
        game: "ats",
        revision,
        asOf: "2026-10-20T12:00:00.000Z",
        ladderEditsEnabled: true,
        levels: order.map((id, index) => ({
          id,
          game: "ats",
          name: `Fictional level ${ids.indexOf(id) + 1}`,
          position: index + 1,
          version: 1,
          terminal: index === order.length - 1,
          configured: false,
          promotionConfigured: false,
          ruleVersionId: null,
          effectiveRule: null,
          freightRuleSummary: null,
          requiredTrips: null,
          requiredDistanceM: null,
          currentDriverCount: 0,
        })),
      };
      return route.fulfill({ headers: { etag }, json: envelope(data) });
    }
    commands.push({
      etag: request.headers()["if-match"],
      key: request.headers()["idempotency-key"],
      input: request.postDataJSON(),
    });
    if (failNext) {
      failNext = false;
      return route.abort("failed");
    }
    if (request.headers()["if-match"] !== etag)
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    return route.fulfill({
      status: request.method() === "PATCH" ? 200 : 201,
      headers: { etag },
      json: envelope({ game: "ats", revision }),
    });
  });
  return {
    commands,
    capabilities,
    external(next: readonly (typeof ids)[number][]) {
      order = next;
      revision++;
    },
    failResponse() {
      failNext = true;
    },
  };
}

test(
  "P11 closes the portal and clears recovery when qualification authority changes",
  browserCase(["@functional"]),
  async ({ page }) => {
    const server = await mockLadder(page);
    await page.goto(`${path}&game=ats`);
    const panel = page.getByRole("region", { name: labels.en.ladder });
    const recovery = panel.getByRole("button", { name: "Check the previous action", exact: true });
    await panel
      .getByLabel(labels.en.name, { exact: true })
      .fill("Fictional authority-scoped level");
    await panel.getByRole("button", { name: labels.en.add, exact: true }).click();
    server.failResponse();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: labels.en.confirm, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(recovery).toBeVisible();
    await expect.poll(() => server.commands.length).toBe(1);

    server.capabilities.pop();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(dialog).toHaveCount(0);

    server.capabilities.push("qualifications.manage");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(panel.getByLabel(labels.en.name, { exact: true })).toHaveValue("");
    await expect(recovery).toHaveCount(0);
    expect(server.commands).toHaveLength(1);
  },
);

test(
  "P11 retains a real level rename receipt in its own game and level editor",
  browserCase(["@real"]),
  async ({ page }) => {
    const staff = await staffContext();
    const name = `Fictional recovered rename ${randomUUID().slice(0, 8)}`;
    const panel = page.getByRole("region", { name: labels.en.ladder });
    const dialog = page.getByRole("dialog");
    const qualificationTab = page.getByRole("tab", { name: "Qualification levels", exact: true });
    const audit = page.getByRole("tab", { name: "Audit log", exact: true });
    const writes: { key: string | undefined; etag: string | undefined; body: string | null }[] = [];
    const snapshot = async () => {
      const response = await staff.get(api);
      expect(response.status()).toBe(200);
      return (await response.json()).data as Ladder;
    };
    const original = (await snapshot()).levels[0];
    if (!original) throw new Error("SYNTHETIC_LEVEL_MISSING");
    const editPath = `/admin/qualification-levels/${original.id}`;
    const editor = panel
      .getByRole("heading", { level: 3, name: original.name, exact: true })
      .or(panel.getByRole("heading", { level: 3, name, exact: true }))
      .locator("..");
    const recover = editor.getByRole("button", { name: "Check the previous action", exact: true });
    try {
      await page.context().addCookies((await staff.storageState()).cookies);
      await resetAccountLimits();
      await page.goto(`${path}&game=ats`);
      await catalogLanguage(page, "en");
      await panel.getByRole("button", { name: `Edit ${original.name}`, exact: true }).click();
      await page.route(`**/api/v1${editPath}`, async (route) => {
        const request = route.request();
        const headers = request.headers();
        writes.push({
          key: headers["idempotency-key"],
          etag: headers["if-match"],
          body: request.postData(),
        });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        return writes.length === 1 ? route.abort("failed") : route.fulfill({ response });
      });
      await editor.locator(`#level-name-${original.id}`).fill(name);
      await editor.getByRole("button", { name: "Save name", exact: true }).click();
      await dialog.getByRole("button", { name: labels.en.confirm, exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(recover).toBeVisible();
      await audit.click();
      await expect(dialog).toHaveCount(0);
      await qualificationTab.click();
      await expect(recover).toBeVisible();
      await panel.getByRole("button", { name: "ETS2", exact: true }).click();
      await expect(panel.getByRole("table").getByRole("rowheader").first()).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Check the previous action", exact: true }),
      ).toHaveCount(0);
      await panel.getByRole("button", { name: "ATS", exact: true }).click();
      await expect(recover).toBeVisible();
      await expect(editor.locator(`#level-name-${original.id}`)).toHaveValue(name);
      const replay = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/api/v1${editPath}`,
      );
      await recover.click();
      expect((await replay).status()).toBe(200);
      await expect(recover).toHaveCount(0);
      await expect(editor.getByRole("heading", { name, exact: true })).toBeVisible();
      expect(writes).toHaveLength(2);
      expect(writes[0]?.etag).toBe(`"v${original.version}"`);
      expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]).toEqual(writes[0]);
      expect((await snapshot()).levels.find(({ id }) => id === original.id)).toMatchObject({
        name,
        version: original.version + 1,
      });
    } finally {
      const current = (await snapshot()).levels.find(({ id }) => id === original.id);
      if (current?.name === name) {
        const response = await staff.patch(`/api/v1${editPath}`, {
          headers: {
            Origin: origin,
            "X-CSRF-Token": await csrf(staff),
            "Idempotency-Key": randomUUID(),
            "If-Match": `"v${current.version}"`,
          },
          data: { name: original.name },
        });
        expect(response.status()).toBe(200);
      }
      await staff.dispose();
    }
  },
);

test(
  "P11 recovers a real committed add after Back, tabs and game navigation",
  browserCase(["@real"]),
  async ({ page }) => {
    const staff = await staffContext();
    const name = `Fictional recovered add ${randomUUID().slice(0, 8)}`;
    const dialog = page.getByRole("dialog");
    const panel = page.getByRole("region", { name: labels.en.ladder });
    const table = panel.getByRole("table", { name: labels.en.ladder });
    const qualifications = page.getByRole("tab", { name: "Qualification levels", exact: true });
    const general = page.getByRole("tab", { name: "General", exact: true });
    const audit = page.getByRole("tab", { name: "Audit log", exact: true });
    const recovered = panel.getByRole("button", { name: "Check the previous action", exact: true });
    const rows = () => table.getByRole("rowheader").filter({ hasText: name });
    const firstCommitted = deferred<{ status: number; etag: string | undefined }>();
    const dropResponse = deferred<void>();
    const firstDropped = deferred<void>();
    const writes: { key?: string; etag?: string; body: string | null }[] = [];
    const reads: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "GET" && pathname.includes("/qualification-ladders/"))
        reads.push(pathname);
    });
    const snapshot = async () => {
      const response = await staff.get(api);
      expect(response.status()).toBe(200);
      return (await response.json()).data as Ladder;
    };
    try {
      await page.context().addCookies((await staff.storageState()).cookies);
      await resetAccountLimits();
      await page.goto("/account/admin/settings?game=ats");
      await catalogLanguage(page, "en");
      await expect(general).toHaveAttribute("aria-selected", "true");
      await expect(page.getByLabel("Company reporting timezone", { exact: true })).toBeVisible();
      expect(reads).toEqual([]);
      await qualifications.click();
      const starting = await snapshot();
      await expect(table.getByRole("rowheader").first()).toBeVisible();
      await page.route(`**${api}/levels`, async (route) => {
        const request = route.request();
        const headers = request.headers();
        writes.push({
          ...(headers["idempotency-key"] && { key: headers["idempotency-key"] }),
          ...(headers["if-match"] && { etag: headers["if-match"] }),
          body: request.postData(),
        });
        const response = await route.fetch();
        if (writes.length > 1) return route.fulfill({ response });
        firstCommitted.resolve({ status: response.status(), etag: response.headers().etag });
        await dropResponse.promise;
        await route.abort("failed");
        firstDropped.resolve();
      });
      await panel.getByLabel(labels.en.name, { exact: true }).fill(name);
      await panel.getByRole("button", { name: labels.en.add, exact: true }).click();
      await dialog.getByRole("button", { name: labels.en.confirm, exact: true }).click();
      expect(await firstCommitted.promise).toEqual({
        status: 201,
        etag: `"v${starting.revision + 1}"`,
      });
      expect((await snapshot()).levels.filter((row) => row.name === name)).toHaveLength(1);
      await page.goBack();
      await expect(general).toBeFocused();
      await expect(dialog).toHaveCount(0);
      const readsAtHide = reads.length;
      dropResponse.resolve();
      await firstDropped.promise;
      await audit.click();
      await expect(audit).toHaveAttribute("aria-selected", "true");
      expect(reads).toHaveLength(readsAtHide);
      expect(writes).toHaveLength(1);
      await qualifications.click();
      await expect(rows()).toHaveCount(1);
      await expect(recovered).toBeVisible();
      const atsReads = reads.filter((pathname) => pathname === api).length;
      await panel.getByRole("button", { name: "ETS2", exact: true }).click();
      await expect(panel.getByRole("button", { name: "ETS2", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(table.getByRole("rowheader").first()).toBeVisible();
      await expect(recovered).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
      expect(reads.filter((pathname) => pathname === api)).toHaveLength(atsReads);
      await page.goBack();
      await expect(panel.getByRole("button", { name: "ATS", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(recovered).toBeVisible();
      const replay = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `${api}/levels`,
      );
      await recovered.click();
      expect((await replay).status()).toBe(201);
      await expect(recovered).toHaveCount(0);
      await expect(rows()).toHaveCount(1);
      expect(writes).toHaveLength(2);
      expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]).toEqual(writes[0]);
      const final = await snapshot();
      expect(final.revision).toBe(starting.revision + 1);
      expect(final.levels.filter((row) => row.name === name)).toHaveLength(1);
    } finally {
      dropResponse.resolve();
      const latest = await snapshot();
      const source = latest.levels.find((row) => row.name === name);
      const target = latest.levels.find((row) => row.id !== source?.id);
      if (source && target)
        expect(
          (
            await write(
              staff,
              `/admin/qualification-ladders/ats/levels/${source.id}/archive`,
              {
                targetLevelId: target.id,
                observedDriverCount: source.currentDriverCount,
              },
              `"v${latest.revision}"`,
            )
          ).status(),
        ).toBe(200);
      await staff.dispose();
    }
  },
);

for (const orderOfConflict of ["read first", "command first"] as const) {
  test(
    `P11 rechecks order and insertion after ${orderOfConflict}`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const server = await mockLadder(page);
      await page.goto(`${path}&game=ats`);
      const panel = page.getByRole("region", { name: labels.en.ladder });
      const table = panel.getByRole("table");
      const rows = table.getByRole("rowheader");
      const move = (name: string) =>
        table.getByRole("button", { name: `Move ${name} up`, exact: true });
      const saveOrder = panel.getByRole("button", { name: labels.en.saveOrder, exact: true });
      const dialog = page.getByRole("dialog");
      const confirm = dialog.getByRole("button", { name: labels.en.confirm, exact: true });
      const name = panel.getByLabel(labels.en.name, { exact: true });
      const position = panel.getByLabel("Position", { exact: true });
      const add = panel.getByRole("button", { name: labels.en.add, exact: true });
      await expect(rows.first()).toContainText("Fictional level 1");
      await name.fill("Fictional insertion");
      await position.selectOption(ids[1]);
      await panel.getByLabel("Reason (optional)", { exact: true }).fill("Fictional add reason");
      await move("Fictional level 3").click();
      await panel
        .getByLabel("Reason (optional)", { exact: true })
        .first()
        .fill("Fictional reorder reason");
      await saveOrder.click();
      if (orderOfConflict === "read first") {
        server.external([ids[0], ids[2], ids[1]]);
        await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
        await expect(dialog).toHaveCount(0);
        expect(server.commands).toHaveLength(0);
        await expect(rows.nth(1)).toContainText("Fictional level 3");
      } else {
        server.external([ids[0], ids[2], ids[1]]);
        server.external(ids);
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        expect(server.commands).toHaveLength(1);
        expect(server.commands[0]?.etag).toBe('"v1"');
        await expect(rows.nth(1)).toContainText("Fictional level 2");
      }
      const beforeReview = server.commands.length;
      await expect(
        panel.getByText("The ladder order changed. Review the current order", { exact: false }),
      ).toBeVisible();
      await expect(saveOrder).toHaveCount(0);
      await expect(move("Fictional level 3")).toBeDisabled();
      await panel.getByRole("button", { name: "Use current order", exact: true }).click();
      await expect(saveOrder).toHaveCount(0);
      expect(server.commands).toHaveLength(beforeReview);
      await move("Fictional level 3").click();
      await expect(panel.getByLabel("Reason (optional)", { exact: true }).first()).toHaveValue(
        "Fictional reorder reason",
      );
      await panel.getByRole("button", { name: "Cancel", exact: true }).click();

      await expect(name).toHaveValue("Fictional insertion");
      await expect(position).toHaveValue(ids[1]);
      await expect(add).toBeDisabled();
      await panel.getByRole("button", { name: "Use this position", exact: true }).click();
      await add.click();
      const reviewedPosition = orderOfConflict === "read first" ? 3 : 2;
      await expect(
        dialog.getByText(`${reviewedPosition} · Before Fictional level 2`, { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText("Fictional add reason", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      server.external([ids[0], ids[2]]);
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await expect(position).toHaveValue("");
      await expect(add).toBeDisabled();
      await expect(
        panel.getByRole("button", { name: "Use this position", exact: true }),
      ).toHaveCount(0);
      await position.selectOption(ids[2]);
      await add.click();
      await expect(dialog.getByText("2 · Before Fictional level 3", { exact: true })).toBeVisible();
      server.failResponse();
      await confirm.click();
      await expect.poll(() => server.commands.length).toBe(beforeReview + 1);
      await page.keyboard.press("Escape");
      const recover = panel.getByRole("button", { name: "Check the previous action", exact: true });
      await expect(recover).toBeVisible();
      server.external([ids[2], ids[0]]);
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await expect(rows.first()).toContainText("Fictional level 3");
      await recover.click();
      await expect.poll(() => server.commands.length).toBe(beforeReview + 2);
      expect(server.commands.at(-1)).toEqual(server.commands.at(-2));
      await expect(name).toHaveValue("Fictional insertion");
      await expect(add).toBeDisabled();
      await panel.getByRole("button", { name: "Use this position", exact: true }).click();
      await add.click();
      await expect(dialog.getByText("1 · Before Fictional level 3", { exact: true })).toBeVisible();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      const last = server.commands.at(-1);
      expect(last).toMatchObject({
        etag: orderOfConflict === "read first" ? '"v4"' : '"v5"',
        input: { name: "Fictional insertion", position: 1, reason: "Fictional add reason" },
      });
      expect(last?.key).not.toBe(server.commands.at(-2)?.key);
    },
  );
}

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
        await expect(panel.getByLabel(s.position, { exact: true })).toHaveValue("append");
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
        await expect(
          panel.getByLabel(s.target, { exact: true }).getByRole("option", {
            name: `${previous.position} · ${previous.name}`,
            exact: true,
          }),
        ).toHaveCount(1);
        await expect(panel.getByText(s.zero, { exact: true })).toBeVisible();
        await panel.getByRole("button", { name: s.reviewArchive, exact: true }).click();
        await expect(dialog.getByText(name, { exact: false }).first()).toBeVisible();
        await expect(
          dialog.getByText(
            `ATS · ${archived.position} · ${name} → ${previous.position} · ${previous.name}`,
            { exact: true },
          ),
        ).toBeVisible();
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
