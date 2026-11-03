import type { Page, Response } from "@playwright/test";
import { expect } from "./fixtures.ts";

/** The active-list page read for `cursor`, or for any cursor other than `current` when unknown. */
function listPage(page: Page, cursor: { expected: string } | { current: string | null }) {
  return page.waitForResponse((response: Response) => {
    const url = new URL(response.url()),
      read = url.searchParams.get("cursor");
    return (
      url.pathname === "/api/v1/admin/members" &&
      url.searchParams.get("status") === "active" &&
      url.searchParams.get("limit") === "25" &&
      response.request().method() === "GET" &&
      ("expected" in cursor ? read === cursor.expected : read !== null && read !== cursor.current)
    );
  });
}

/**
 * Opens a member from the members list, paging with Next page until the row appears. Nicknames are
 * not unique (synthetic fixtures reuse names) and members are listed by ID, so each new page is
 * confirmed by its first member ID rather than by a nickname. The wait matches the next page's
 * cursor, so a refetch of the current page (after a command) is never taken for the next page; the
 * first hop knows only that the cursor must change, later hops know it from the previous response.
 */
export async function chooseMember(page: Page, name: string, waitForDetail = true) {
  const master = page.locator(".admin-master");
  await expect(master.locator("tbody tr").first()).toBeVisible();
  let expected: string | null | undefined;
  for (let index = 0; index < 30; index++) {
    const target = master.getByRole("button", { name, exact: true });
    if (await target.count()) {
      await target.click();
      if (waitForDetail)
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      return;
    }
    const next = master.getByRole("button", { name: "Next page", exact: true });
    if (!(await next.count()) || expected === null) break;
    const response = listPage(
      page,
      expected === undefined
        ? { current: new URL(page.url()).searchParams.get("cursor") }
        : { expected },
    );
    await next.click();
    const received = await response;
    expect(received.status()).toBe(200);
    const cursor = new URL(received.url()).searchParams.get("cursor");
    await expect.poll(() => new URL(page.url()).searchParams.get("cursor")).toBe(cursor);
    const data = (await received.json()).data as {
      items: { profile: { member: { id: string } } }[];
      nextCursor: string | null;
    };
    expected = data.nextCursor;
    const first = data.items[0]?.profile.member.id;
    if (first) await expect(master.locator(`button[data-member-id="${first}"]`)).toBeVisible();
    else await expect(master.locator("tbody tr")).toHaveCount(0);
  }
  throw new Error("SYNTHETIC_ADMIN_MEMBER_NOT_FOUND");
}
