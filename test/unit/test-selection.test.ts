import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  affectedTests,
  groupSelection,
  laneOf,
  listTestFiles,
  parseLocalArguments,
  parseSelection,
  selectableLanes,
  serializeSelection,
} from "../../scripts/test-selection.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inventory = listTestFiles(root);
const always = () => true;

describe("focused selection", () => {
  test("maps lane names and test files to lanes", () => {
    expect(laneOf("integration")).toBe("integration");
    expect(laneOf("test/unit/events.test.ts")).toBe("unit");
    expect(laneOf("test/contracts/events.test.ts")).toBe("contracts");
    expect(laneOf("test/e2e/events-real.spec.ts")).toBe("e2e");
    expect(laneOf("test/persistence/recovery.test.ts")).toBe("recovery");
    for (const invalid of [
      "test/e2e/support/server.ts",
      "test/unit/../integration/events.test.ts",
      "test/unit/events.spec.ts",
      "test/probes/unit.test.ts",
      "apps/api/src/app.ts",
      "test/unit/a b.test.ts",
      "failure-reporting",
    ])
      expect(laneOf(invalid)).toBeUndefined();
  });

  test("groups in canonical lane order and lets a whole lane absorb its files", () => {
    expect(
      groupSelection(
        [
          "test/e2e/events.spec.ts",
          "test/unit/events.test.ts",
          "integration",
          "test/integration/events.test.ts",
          "test/unit/events.test.ts",
        ],
        always,
      ),
    ).toEqual([
      { lane: "unit", files: ["test/unit/events.test.ts"] },
      { lane: "integration", files: [] },
      { lane: "e2e", files: ["test/e2e/events.spec.ts"] },
    ]);
  });

  test("rejects empty, unknown, missing and oversized selections", () => {
    expect(() => groupSelection([], always)).toThrow("TEST_SELECTION_INVALID");
    expect(() => groupSelection(["all"], always)).toThrow("TEST_SELECTION_INVALID");
    expect(() => groupSelection(["test/unit/absent.test.ts"], () => false)).toThrow(
      "TEST_SELECTION_MISSING_FILE",
    );
    expect(() => groupSelection(Array(201).fill("unit"), always)).toThrow("TEST_SELECTION_INVALID");
  });

  test("round-trips through the launcher environment", () => {
    const tokens = ["unit", "test/e2e/events.spec.ts"];
    expect(parseSelection(serializeSelection(tokens))).toEqual(tokens);
    expect(parseSelection(undefined)).toEqual([]);
  });
});

describe("launcher arguments", () => {
  test("keeps the existing lane and probe forms", () => {
    expect(parseLocalArguments([])).toMatchObject({ focus: "all", probe: false, tokens: [] });
    expect(parseLocalArguments(["e2e", "--probe"])).toMatchObject({ focus: "e2e", probe: true });
    expect(() => parseLocalArguments(["contracts", "--probe"])).toThrow("INVALID_PROBE_LANE");
    expect(() => parseLocalArguments(["everything"])).toThrow("INVALID_TEST_LANE");
  });

  test("accepts focused options and normalizes Windows separators", () => {
    expect(
      parseLocalArguments([
        "selected",
        "--skip-check",
        "--project",
        "desktop-chromium",
        "--",
        "test\\e2e\\events.spec.ts",
      ]),
    ).toEqual({
      focus: "selected",
      probe: false,
      skipCheck: true,
      project: "desktop-chromium",
      tokens: ["test/e2e/events.spec.ts"],
    });
    expect(parseLocalArguments(["e2e", "--project", "mobile-chromium"]).project).toBe(
      "mobile-chromium",
    );
  });

  test("refuses options that would weaken the full suite or probes", () => {
    for (const argv of [
      ["all", "--skip-check"],
      ["failure-reporting", "--skip-check"],
      ["e2e", "--probe", "--project", "desktop-chromium"],
      ["unit", "--probe", "--skip-check"],
      ["selected"],
      ["unit", "test/unit/events.test.ts"],
      ["integration", "--project", "desktop-chromium"],
      ["e2e", "--project", "firefox"],
      ["e2e", "--grep", "x"],
    ])
      expect(() => parseLocalArguments(argv), argv.join(" ")).toThrow();
  });
});

describe("affected tests", () => {
  test("maps a feature change to its tests on every layer", () => {
    const { tokens } = affectedTests(["apps/api/src/modules/events/http.ts"], inventory);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "test/unit/events.test.ts",
        "test/contracts/events.test.ts",
        "test/integration/events.test.ts",
        "test/e2e/events-real.spec.ts",
        "test/e2e/events-layout.spec.ts",
      ]),
    );
    expect(tokens.some((token) => token.includes("trips"))).toBe(false);
  });

  test("selects changed tests themselves and skips removed ones", () => {
    const { tokens } = affectedTests(
      ["test/unit/events.test.ts", "test/unit/removed.test.ts"],
      inventory,
      (path) => path !== "test/unit/removed.test.ts",
    );
    expect(tokens).toEqual(["test/unit/events.test.ts"]);
  });

  test("selects no runtime tests for documentation and CI-only paths", () => {
    expect(
      affectedTests(
        ["docs/development/testing.md", "apps/api/src/modules/README.md", ".github/CODEOWNERS"],
        inventory,
      ).tokens,
    ).toEqual([]);
  });

  test("falls back to every lane for shared or unmapped code", () => {
    for (const path of [
      "packages/db/migrations/0015.sql",
      "apps/api/src/platform/http.ts",
      "apps/web/src/app/Session.tsx",
      "test/support/environment.ts",
      "pnpm-lock.yaml",
      "something/new.ts",
    ]) {
      const { tokens } = affectedTests([path, "test/unit/events.test.ts"], inventory);
      expect(tokens, path).toEqual(selectableLanes);
    }
  });

  test("selects whole support lanes for browser and persistence helpers", () => {
    expect(affectedTests(["test/e2e/support/events.ts"], inventory).tokens).toEqual(["e2e"]);
    expect(affectedTests(["test/persistence/support.ts"], inventory).tokens).toEqual([
      "persistence",
      "recovery",
    ]);
  });

  test("every contract, integration and browser test is reachable from some area", () => {
    // These cover the shared shell or harness and run whenever shared code changes.
    const sharedOnly = ["concurrency", "smoke", "navigation", "readiness-states"];
    const reachable = new Set(
      [
        "apps/api/src/modules/identity/x.ts",
        "apps/api/src/modules/external-identities/x.ts",
        "apps/api/src/modules/admissions/x.ts",
        "apps/web/src/features/landing/x.ts",
        "apps/web/src/features/admin/x.ts",
        "apps/api/src/modules/analytics/x.ts",
        "apps/api/src/modules/catalogs/x.ts",
        "apps/api/src/modules/events/x.ts",
        "apps/api/src/modules/messaging/x.ts",
        "apps/api/src/modules/notifications/x.ts",
        "apps/api/src/modules/manual-reports/x.ts",
        "apps/api/src/modules/qualifications/x.ts",
        "apps/api/src/modules/reconciliation/x.ts",
        "apps/api/src/modules/telemetry/x.ts",
        "apps/api/src/modules/trips/x.ts",
        "apps/web/src/features/drivers/x.ts",
        "apps/web/src/features/foundation/x.ts",
        "packages/jobs/x.ts",
        "scripts/demo/x.ts",
      ].flatMap((path) => affectedTests([path], inventory).tokens),
    );
    const unreachable = inventory.filter(
      (file) =>
        !file.startsWith("test/unit/") &&
        !reachable.has(file) &&
        !sharedOnly.some(
          (name) => file.endsWith(`/${name}.test.ts`) || file.endsWith(`/${name}.spec.ts`),
        ),
    );
    expect(unreachable).toEqual([]);
  });
});
