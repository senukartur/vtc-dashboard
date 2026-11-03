import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

/**
 * Opens a member from the members list, paging with Next page until the row appears. Nicknames are
 * not unique (synthetic fixtures reuse names) and members are listed by ID, so each new page is
 * confirmed by its first member ID rather than by a nickname.
 */
export async function chooseMember(page: Page, name: string, waitForDetail = true) {
  const master = page.locator(".admin-master");
  await expect(master.locator("tbody tr").first()).toBeVisible();
  for (let index = 0; index < 30; index++) {
    const target = master.getByRole("button", { name, exact: true });
    if (await target.count()) {
      await target.click();
      if (waitForDetail)
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      return;
    }
    const next = master.getByRole("button", { name: "Next page", exact: true });
    if (!(await next.count())) break;
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/admin/members?status=active") && r.request().method() === "GET",
    );
    await next.click();
    const received = await response;
    expect(received.status()).toBe(200);
    const first = (await received.json()).data.items[0]?.profile.member.id;
    if (first) await expect(master.locator(`button[data-member-id="${first}"]`)).toBeVisible();
    else await expect(master.locator("tbody tr")).toHaveCount(0);
  }
  throw new Error("SYNTHETIC_ADMIN_MEMBER_NOT_FOUND");
}
