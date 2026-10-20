import { resolve } from "node:path";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { expect, test, vi } from "vitest";
import {
  browserFailureLine,
  browserFailurePrefix,
  browserProjects,
  safeBrowserFailure,
} from "../../scripts/browser-diagnostics.mjs";
import { collectEvents, qualityReport, safeEvent } from "../../scripts/ci-result.mjs";
import { browserFailureProof } from "../support/browser-failure-proof.ts";
import SafeBrowserReporter from "../support/safe-browser-reporter.ts";

const valid = {
  kind: "test",
  file: "landing",
  project: "desktop-chromium",
  line: 12,
  status: "failed",
};
const privateText = "SYNTHETIC_PRIVATE_TOKEN=never-publish";
test("catalog browser failures retain only allowlisted file identifiers", () => {
  for (const file of ["catalogs", "catalogs-real"]) {
    expect(safeBrowserFailure({ ...valid, file })).toEqual({ ...valid, file });
  }
});
function record(value: unknown) {
  return `${browserFailurePrefix}${JSON.stringify(value)}\n`;
}

test("browser diagnostics reject malformed and extra fields at collection and report boundaries", () => {
  const invalid: unknown[] = [
    null,
    [],
    privateText,
    ...["file", "project", "status", "kind", "line"].map((field) => ({
      ...valid,
      [field]: privateText,
    })),
    ...[0, -1, 1.5, 100001, null].map((line) => ({ ...valid, line })),
    ...["title", "error", "headers", "payload", "path", "__proto__"].map((field) => ({
      ...valid,
      [field]: privateText,
    })),
    { kind: "global", status: "failed", category: privateText },
    { kind: "global", status: "failed", category: "runner-error", message: privateText },
  ];
  const collector = collectEvents();
  for (const value of invalid) {
    expect(safeBrowserFailure(value)).toBeUndefined();
    expect(() => browserFailureLine(value)).toThrow("INVALID_BROWSER_FAILURE");
    collector.push(record(value));
  }
  expect(collector.browserFailures).toEqual([]);
  expect(qualityReport(1, 2, [], undefined, invalid)).toMatchObject({ browserFailures: [] });
  expect(JSON.stringify(qualityReport(1, 2, [], undefined, invalid))).not.toContain(privateText);
});

test("browser collector handles chunks and oversized lines, bounds records and keeps stage verdicts", () => {
  const collector = collectEvents();
  collector.push(`${browserFailurePrefix}${"x".repeat(2000)}\n`);
  const line = browserFailureLine(valid);
  collector.push(line.slice(0, 8));
  collector.push(`${line.slice(8)}\n`);
  for (let index = 0; index < 100; index++) collector.push(`${line}\n`);
  expect(collector.browserFailures).toHaveLength(32);
  expect(qualityReport(0, 2, [], undefined, collector.browserFailures)).toMatchObject({
    status: "success",
    exitCode: 0,
    browserFailures: Array(32).fill(valid),
  });
  const event = safeEvent({ stage: "e2e", status: "failure", exitCode: 1, durationMs: 2 });
  if (!event) throw new Error("MISSING_EVENT");
  expect(qualityReport(1, 2, [event])).toMatchObject({
    status: "failure",
    browserFailures: [{ kind: "global", category: "unreported-runner-failure", status: "failed" }],
  });
});

test("reporter reads locations and status without touching titles, errors or attachments", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const reporter = new SafeBrowserReporter();
  const forbidden = () => {
    throw new Error("PRIVATE_FIELD_READ");
  };
  const testcase = {
    location: { file: resolve("test/e2e/landing.spec.ts"), line: 12 },
    parent: { project: () => ({ name: "desktop-chromium" }) },
    get title() {
      return forbidden();
    },
  } as unknown as TestCase;
  const result = {
    status: "failed",
    get errors() {
      return forbidden();
    },
    get attachments() {
      return forbidden();
    },
  } as unknown as TestResult;
  reporter.onTestBegin();
  reporter.onTestEnd(testcase, result);
  reporter.onTestEnd(testcase, result);
  const collector = collectEvents();
  for (const [line] of output.mock.calls) collector.push(`${line}\n`);
  expect(collector.browserFailures).toEqual([valid]);
  expect(output).toHaveBeenCalledTimes(1);
});

test("unmapped locations and startup errors produce only coarse categories", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const reporter = new SafeBrowserReporter();
  reporter.onError();
  reporter.onTestEnd(
    {
      location: { file: privateText, line: 12 },
      parent: { project: () => ({ name: privateText }) },
    } as unknown as TestCase,
    { status: "timedOut" } as TestResult,
  );
  reporter.onEnd({ status: "timedout" } as FullResult);
  const collector = collectEvents();
  for (const [line] of output.mock.calls) collector.push(`${line}\n`);
  expect(collector.browserFailures).toEqual([
    { kind: "global", category: "runner-error", status: "failed" },
    { kind: "global", category: "unmapped-test", status: "timedOut" },
    { kind: "global", category: "no-tests-started", status: "timedOut" },
  ]);
  expect(JSON.stringify(output.mock.calls)).not.toContain(privateText);
});

test("failure proof requires safe assertion records from every configured browser project", () => {
  const output = browserProjects
    .map((project) => record({ ...valid, file: "assertion-probe", project }))
    .join("");
  expect(browserFailureProof(`${privateText}\n${output}`)).toHaveLength(3);
  expect(() => browserFailureProof(output.replaceAll("assertion-probe", "landing"))).toThrow(
    "FAILURE_PROBE_BROWSER_DIAGNOSTICS_INVALID",
  );
  expect(() =>
    browserFailureProof(record({ ...valid, file: "assertion-probe" }).repeat(3)),
  ).toThrow("FAILURE_PROBE_BROWSER_DIAGNOSTICS_INVALID");
});
