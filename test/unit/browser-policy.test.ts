import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { browserTimingLimit } from "../../scripts/browser-diagnostics.mjs";
import { assertBrowserPolicy, browserCase, browserSmokeAreas } from "../support/browser-policy.ts";

interface Spec {
  title: string;
  file: string;
  line: number;
  tags: string[];
  tests: { projectName: string }[];
}
interface Suite {
  specs: Spec[];
  suites: Suite[];
}
function enumerate(probe = false, unfiltered = false) {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--list",
        "--reporter=json",
        ...(unfiltered ? ["--config", "test/support/browser-enumeration.config.ts"] : []),
      ],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, VTC_FAILURE_PROBE: probe ? "assertion" : "" },
      },
    ),
  );
  expect(result.errors).toEqual([]);
  const specs: Spec[] = [];
  function visit(suite: Suite) {
    specs.push(...suite.specs);
    for (const nested of suite.suites ?? []) visit(nested);
  }
  for (const suite of result.suites) visit(suite);
  expect(specs.length).toBeGreaterThan(0);
  const expanded = new Map<string, Spec>();
  for (const spec of specs) {
    const key = JSON.stringify([spec.file, spec.line, spec.title]);
    const previous = expanded.get(key);
    if (previous) previous.tests.push(...spec.tests);
    else
      expanded.set(key, {
        ...spec,
        file: resolve(probe ? "test/probes" : "test/e2e", spec.file),
        tags: spec.tags.map((tag) => `@${tag}`),
      });
  }
  return [...expanded.values()];
}
test("browser declaration metadata rejects missing, unknown and contradictory classifications", () => {
  for (const invalid of [
    undefined,
    [],
    ["@unknown"],
    ["@layout", "@functional"],
    ["@functional", "@viewport-mobile"],
    ["@real", "@smoke-account"],
    ["@layout", "@viewport-desktop", "@viewport-mobile"],
    ["@functional", "@smoke-account", "@smoke-events"],
    ["@layout", "@layout"],
  ])
    expect(() => assertBrowserPolicy(invalid)).toThrow("INVALID_BROWSER_POLICY");
  expect(browserCase(["@functional"])).toEqual({ tag: ["@functional"] });
  expect(() => browserCase([])).toThrow("INVALID_BROWSER_POLICY");
});
test("expanded browser cases follow the approved per-case policy and every area has one mobile functional smoke", () => {
  // Override project filters to find missing/contradictory tags even if all filters hide a case.
  const all = enumerate(false, true);
  const selected = enumerate();
  expect(
    selected.map(({ file, line, title }) => JSON.stringify([file, line, title])).sort(),
  ).toEqual(all.map(({ file, line, title }) => JSON.stringify([file, line, title])).sort());
  for (const spec of all) {
    assertBrowserPolicy(spec.tags);
    expect(spec.tests).toHaveLength(3);
    // The reporter maps only real declaration paths. A wrapped test() silently shifts these.
    expect(spec.file).toMatch(/(?:^|[/\\])test[/\\]e2e[/\\][a-z-]+\.spec\.ts$/);
    const source = readFileSync(spec.file, "utf8").split(/\r?\n/);
    expect(source[spec.line - 1]?.trim()).toMatch(/^test\(/);
  }
  const smokes = new Map<string, number>();
  let executions = 0;
  for (const spec of selected) {
    assertBrowserPolicy(spec.tags);
    expect(spec.tags).not.toContain("@probe");
    const scope = spec.tags.find((tag) => tag.startsWith("@viewport-"));
    const smoke = spec.tags.find((tag) => tag.startsWith("@smoke-"));
    if (smoke) smokes.set(smoke.slice(7), (smokes.get(smoke.slice(7)) ?? 0) + 1);
    // Independent truth table, deliberately not the configuration's grep implementation.
    const expected = spec.tags.includes("@layout")
      ? scope === "@viewport-desktop"
        ? ["desktop-chromium"]
        : scope === "@viewport-mobile"
          ? ["mobile-chromium"]
          : scope === "@viewport-non-mobile"
            ? ["desktop-chromium", "tablet-chromium"]
            : scope === "@viewport-narrow"
              ? ["tablet-chromium", "mobile-chromium"]
              : ["desktop-chromium", "tablet-chromium", "mobile-chromium"]
      : smoke
        ? ["desktop-chromium", "mobile-chromium"]
        : ["desktop-chromium"];
    const projects = spec.tests.map((item) => item.projectName);
    expect(projects, `${spec.file}:${spec.line}`).toEqual(expected);
    executions += projects.length;
  }
  expect(Object.fromEntries(smokes)).toEqual(
    Object.fromEntries(browserSmokeAreas.map((area) => [area, 1])),
  );
  expect(executions).toBeLessThan(browserTimingLimit);
});
test("deliberate assertion probes remain selected in all three projects", () => {
  const specs = enumerate(true);
  expect(specs).toHaveLength(1);
  expect(specs[0]?.tags).toEqual(["@probe"]);
  expect(specs[0]?.tests.map((item) => item.projectName)).toEqual([
    "desktop-chromium",
    "tablet-chromium",
    "mobile-chromium",
  ]);
});
