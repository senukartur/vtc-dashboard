import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  affectedTests,
  ciGroups,
  groupSelection,
  laneOf,
  laneShardFiles,
  listTestFiles,
  parseLocalArguments,
  parseSelection,
  planShards,
  selectableLanes,
  serializeSelection,
  shardableLanes,
  shardFiles,
  shardWeights,
  validShard,
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
      shard: "",
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
      ["core", "--skip-check"],
      ["unit", "--shard", "1/4"],
      ["persistence-recovery", "--shard", "1/2"],
      ["integration", "--probe", "--shard", "1/2"],
      ["e2e", "--shard", "5/4"],
      ["e2e", "--shard", "0/4"],
      ["e2e", "--shard", "1/9"],
      ["e2e", "--probe", "--shard", "1/4"],
    ])
      expect(() => parseLocalArguments(argv), argv.join(" ")).toThrow();
  });
});

describe("CI groups", () => {
  test("together run every stage of the aggregate exactly once", () => {
    const stages = Object.values(ciGroups).flat();
    expect(stages.toSorted()).toEqual(
      ["isolation", ...selectableLanes, "failure-reporting"].toSorted(),
    );
    expect(new Set(stages).size).toBe(stages.length);
  });

  test("accept a shard for the integration and browser groups only", () => {
    expect(parseLocalArguments(["e2e", "--skip-check", "--shard", "2/4"])).toMatchObject({
      focus: "e2e",
      skipCheck: true,
      shard: "2/4",
    });
    expect(parseLocalArguments(["integration", "--skip-check", "--shard", "1/2"])).toMatchObject({
      focus: "integration",
      shard: "1/2",
    });
    expect(shardableLanes).toEqual(["integration", "e2e"]);
    expect(parseLocalArguments(["persistence-recovery", "--skip-check"]).focus).toBe(
      "persistence-recovery",
    );
    expect(parseLocalArguments(["core"])).toMatchObject({ focus: "core", skipCheck: false });
    for (const value of ["1/1", "4/4", "8/8"]) expect(validShard(value)).toBe(true);
    for (const value of ["", "4", "2/1", "1/4/4", " 1/4", undefined])
      expect(validShard(value)).toBe(false);
  });
});

describe("duration-weighted shards", () => {
  const file = (name: string) => `test/integration/${name}.test.ts`;
  const [a, b, c, d, e] = [file("a"), file("b"), file("c"), file("d"), file("e")];
  const files = [a, b, c, d, e];

  test("pack heaviest first into the lightest shard", () => {
    const weights = { [a]: 100, [b]: 60, [c]: 50, [d]: 30, [e]: 20 };
    // a → 1 (100), b → 2 (60), c → 2 (110), d → 1 (130), e → 2 (130).
    expect(planShards(files, 2, weights)).toEqual([
      [a, d],
      [b, c, e],
    ]);
    expect(planShards(files.toReversed(), 2, weights)).toEqual(planShards(files, 2, weights));
    expect(planShards(files, 1, weights)).toEqual([files]);
  });

  test("give unknown or invalid weights the mean of the known ones", () => {
    // Zero, fractional and inherited weights are ignored; c gets the mean of a and b (40).
    const weights: Record<string, number> = Object.assign(Object.create({ [c]: 999 }), {
      [a]: 60,
      [b]: 20,
      [d]: 0,
      [e]: 1.5,
    });
    expect(planShards([a, b, c], 2, weights)).toEqual([[a], [b, c]]);
    // Without any weight every file counts the same and the shards differ by at most one.
    const even = planShards(files, 3);
    expect(even.map((shard) => shard.length).toSorted()).toEqual([1, 2, 2]);
  });

  test("run every file exactly once for every shard count", () => {
    const weights = shardWeights(root);
    for (const lane of shardableLanes) {
      const laneFiles = inventory.filter((file) => laneOf(file) === lane);
      for (let total = 1; total <= 8; total += 1) {
        const shards = Array.from({ length: total }, (_, index) =>
          laneShardFiles(root, lane, `${index + 1}/${total}`),
        );
        expect(shards.flat().toSorted()).toEqual(laneFiles);
        expect(shards.every((shard) => shard.length > 0)).toBe(true);
        expect(shards).toEqual(planShards(laneFiles, total, weights[lane] ?? {}));
      }
    }
  });

  test("refuse invalid or empty shards", () => {
    expect(() => shardFiles(files, "3/2")).toThrow("TEST_SHARD_INVALID");
    expect(() => shardFiles([a], "2/2")).toThrow("TEST_SHARD_EMPTY");
    expect(() => planShards(files, 9)).toThrow("TEST_SHARD_INVALID");
    expect(() => laneShardFiles(root, "unit", "1/2")).toThrow("TEST_SHARD_INVALID");
  });

  test("keep only positive integer weights for shardable lanes", () => {
    const weights = shardWeights(root);
    expect(Object.keys(weights)).toEqual(shardableLanes);
    for (const lane of shardableLanes)
      for (const [path, weight] of Object.entries(weights[lane] ?? {})) {
        expect(laneOf(path)).toBe(lane);
        expect(Number.isSafeInteger(weight) && weight > 0).toBe(true);
      }
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

  test("selects the overview convoy blocks for an events change", () => {
    const { tokens } = affectedTests(["apps/web/src/features/events/x.ts"], inventory);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "test/e2e/dashboard-blocks.spec.ts",
        "test/unit/dashboard-blocks.test.ts",
        "test/e2e/events-layout.spec.ts",
      ]),
    );
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
