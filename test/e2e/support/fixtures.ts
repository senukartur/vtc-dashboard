import { test as base, expect } from "@playwright/test";
import { assertLocalOrigin } from "../../support/environment.ts";

export const test = base.extend<{ networkGuard: undefined }>({
  networkGuard: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route("**/*", async (route) => {
        try {
          assertLocalOrigin(route.request().url());
          await route.continue();
        } catch {
          blocked.push("unexpected origin");
          await route.abort("blockedbyclient");
        }
      });
      await use(undefined);
      expect(blocked).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
