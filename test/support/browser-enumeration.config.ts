import { resolve } from "node:path";
import configuration from "../../playwright.config.ts";

// Test-only inventory: retain the actual projects but enumerate cases hidden by their filters.
export default {
  ...configuration,
  reporter: "json" as const,
  testDir: resolve(import.meta.dirname, "../e2e"),
  projects: configuration.projects?.map(
    ({ grep: _grep, grepInvert: _grepInvert, ...project }) => project,
  ),
};
