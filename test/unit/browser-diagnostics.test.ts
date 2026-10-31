import { resolve } from "node:path";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { expect, test, vi } from "vitest";
import {
  browserFailureLine,
  browserFailurePrefix,
  browserPreparationLine,
  browserPreparationPrefix,
  browserProjects,
  qualificationPhaseAnnotation,
  qualificationPhaseScenario,
  qualificationPromotionPhases,
  safeBrowserFailure,
  safeBrowserPreparation,
  safeQualificationPhase,
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
const promotionPhase = {
  scenario: qualificationPhaseScenario,
  phase: "finally-release-held",
  primaryPhase: "command-arrived",
};
function phaseAnnotation(value: unknown = promotionPhase) {
  return { type: qualificationPhaseAnnotation, description: JSON.stringify(value) };
}
function phasePipeline(annotations: unknown, file = "qualifications", status = "timedOut") {
  const output = vi.spyOn(console, "log").mockImplementation(() => {}),
    forbidden = () => {
      throw new Error("PRIVATE_FIELD_READ");
    };
  try {
    const reporter = new SafeBrowserReporter();
    reporter.onTestBegin();
    reporter.onTestEnd(
      {
        location: { file: resolve(`test/e2e/${file}.spec.ts`), line: 73 },
        parent: { project: () => ({ name: "tablet-chromium" }) },
        get title() {
          return forbidden();
        },
        get annotations() {
          return forbidden();
        },
      } as unknown as TestCase,
      {
        status,
        annotations,
        get errors() {
          return forbidden();
        },
        get attachments() {
          return forbidden();
        },
      } as unknown as TestResult,
    );
    const collector = collectEvents();
    for (const [line] of output.mock.calls) collector.push(`${line}\n`);
    const event = safeEvent({ stage: "e2e", status: "failure", exitCode: 1, durationMs: 20 });
    if (!event) throw Error("MISSING_EVENT");
    return qualityReport(1, 20, [event], undefined, collector.browserFailures) as {
      browserFailures: unknown[];
      status: string;
      exitCode: number;
    };
  } finally {
    output.mockRestore();
  }
}
test("runtime result annotations retain only the controlled promotion's closed phases through the real pipeline", () => {
  const annotation = phaseAnnotation();
  Object.defineProperty(annotation, "location", {
    enumerable: true,
    get() {
      throw Error("PRIVATE_LOCATION_READ");
    },
  });
  const report = phasePipeline([annotation]);
  expect(report.browserFailures).toEqual([
    {
      kind: "test",
      file: "qualifications",
      project: "tablet-chromium",
      line: 73,
      status: "timedOut",
      ...promotionPhase,
    },
  ]);
  expect(report.status).toBe("failure");
  expect(report.exitCode).toBe(1);
  for (const phase of qualificationPromotionPhases)
    expect(safeQualificationPhase({ ...promotionPhase, phase })).toBeDefined();
  expect(safeQualificationPhase({ ...promotionPhase, primaryPhase: "none" })).toBeDefined();
  for (const primaryPhase of ["complete", "finally-release-held"])
    expect(safeQualificationPhase({ ...promotionPhase, primaryPhase })).toBeUndefined();
  const safe = safeBrowserFailure(report.browserFailures[0]);
  expect(safe).not.toBe(report.browserFailures[0]);
});
test("invalid, private and extra annotation metadata keeps the known coarse failure", () => {
  const forbidden = () => {
    throw Error("PRIVATE_ANNOTATION_FIELD_READ");
  };
  const getter = {
    type: qualificationPhaseAnnotation,
    get description() {
      return forbidden();
    },
  };
  const unrelated = {
    type: "unrelated",
    get description() {
      return forbidden();
    },
  };
  const invalid: unknown[] = [
    undefined,
    null,
    {},
    [],
    [getter],
    [unrelated],
    [phaseAnnotation({ ...promotionPhase, phase: privateText })],
    [phaseAnnotation({ ...promotionPhase, primaryPhase: privateText })],
    [phaseAnnotation({ ...promotionPhase, scenario: privateText })],
    [phaseAnnotation({ ...promotionPhase, payload: privateText })],
    [{ ...phaseAnnotation(), error: privateText }],
    [phaseAnnotation(), phaseAnnotation()],
    Array(33).fill(phaseAnnotation()),
    [{ type: qualificationPhaseAnnotation, description: privateText.repeat(40) }],
    [{ type: qualificationPhaseAnnotation, description: "{" }],
    [phaseAnnotation([privateText])],
  ];
  for (const annotations of invalid) {
    const report = phasePipeline(annotations);
    expect(report.browserFailures).toEqual([
      {
        kind: "test",
        file: "qualifications",
        project: "tablet-chromium",
        line: 73,
        status: "timedOut",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(privateText);
    expect(report.status).toBe("failure");
  }
});
test("unknown or other file metadata cannot carry phases and is not inspected", () => {
  const poisonous = new Proxy([], {
    get() {
      throw Error("ANNOTATIONS_READ");
    },
  });
  for (const file of ["landing", "unknown-file"]) {
    const report = phasePipeline(poisonous, file);
    expect(report.browserFailures).toEqual(
      file === "landing"
        ? [{ kind: "test", file, project: "tablet-chromium", line: 73, status: "timedOut" }]
        : [{ kind: "global", category: "unmapped-test", status: "timedOut" }],
    );
  }
  expect(safeBrowserFailure({ ...valid, ...promotionPhase })).toBeUndefined();
});
test("an unavailable runtime annotation property cannot suppress a known failure", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const reporter = new SafeBrowserReporter();
    reporter.onTestBegin();
    reporter.onTestEnd(
      {
        location: { file: resolve("test/e2e/qualifications.spec.ts"), line: 73 },
        parent: { project: () => ({ name: "tablet-chromium" }) },
      } as unknown as TestCase,
      {
        status: "failed",
        get annotations() {
          throw Error(privateText);
        },
        get errors() {
          throw Error("PRIVATE_ERRORS_READ");
        },
        get attachments() {
          throw Error("PRIVATE_ATTACHMENTS_READ");
        },
      } as unknown as TestResult,
    );
    const collector = collectEvents();
    for (const [line] of output.mock.calls) collector.push(`${line}\n`);
    expect(qualityReport(1, 1, [], undefined, collector.browserFailures)).toMatchObject({
      browserFailures: [
        {
          kind: "test",
          file: "qualifications",
          project: "tablet-chromium",
          line: 73,
          status: "failed",
        },
      ],
    });
    expect(JSON.stringify(output.mock.calls)).not.toContain(privateText);
  } finally {
    output.mockRestore();
  }
});
test("extended records are revalidated at collector and report boundaries with exact keys and unchanged bounds", () => {
  const value = { ...valid, file: "qualifications", ...promotionPhase };
  const invalid = [
    { ...value, error: privateText },
    { ...value, phase: privateText },
    { ...value, file: "landing" },
    { ...value, primaryPhase: {} },
    { ...value, scenario: null },
  ];
  const collector = collectEvents();
  for (const item of invalid) {
    expect(safeBrowserFailure(item)).toBeUndefined();
    collector.push(record(item));
  }
  expect(collector.browserFailures).toEqual([]);
  expect(qualityReport(1, 1, [], undefined, invalid)).toMatchObject({ browserFailures: [] });
  const line = browserFailureLine(value);
  expect(line.length).toBeLessThan(1024);
  collector.push(`${browserFailurePrefix}${"x".repeat(1025)}\n`);
  for (let i = 0; i < 40; i++) collector.push(`${line}\n`);
  expect(collector.browserFailures).toHaveLength(32);
  expect(qualityReport(0, 1, [], undefined, collector.browserFailures)).toMatchObject({
    status: "success",
  });
  expect(JSON.stringify(qualityReport(1, 1, [], undefined, invalid))).not.toContain(privateText);
});
test("phase records keep the reporter's existing 32-record bound", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const reporter = new SafeBrowserReporter();
    reporter.onTestBegin();
    for (let line = 1; line <= 40; line++)
      reporter.onTestEnd(
        {
          location: { file: resolve("test/e2e/qualifications.spec.ts"), line },
          parent: { project: () => ({ name: "tablet-chromium" }) },
        } as unknown as TestCase,
        { status: "failed", annotations: [phaseAnnotation()] } as TestResult,
      );
    expect(output).toHaveBeenCalledTimes(32);
    const collector = collectEvents();
    for (const [line] of output.mock.calls) collector.push(`${line}\n`);
    expect(collector.browserFailures).toHaveLength(32);
    expect(qualityReport(1, 1, [], undefined, collector.browserFailures)).toMatchObject({
      exitCode: 1,
      status: "failure",
      browserFailures: expect.arrayContaining([expect.objectContaining(promotionPhase)]),
    });
  } finally {
    output.mockRestore();
  }
});
test("catalog browser failures retain only allowlisted file identifiers", () => {
  for (const file of [
    "catalogs",
    "catalogs-real",
    "administration-real",
    "events",
    "events-real",
    "dashboard",
    "navigation",
  ]) {
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

test("preparation wrapper diagnostics retain each actual category and explicit fixture bound", () => {
  for (const category of [
    "completed",
    "nonzero-exit",
    "signal-exit",
    "spawn-error",
    "pipe-error",
    "deadline",
  ]) {
    const value = {
      kind: "wrapper",
      state: category === "completed" ? "success" : "failed",
      category,
      configuredTimeoutMs: 60000,
      durationMs: 30091,
    };
    expect(safeBrowserPreparation(value)).toEqual(value);
    expect(browserPreparationLine(value)).toBe(
      `${browserPreparationPrefix}${JSON.stringify(value)}`,
    );
    expect(safeBrowserFailure(value)).toBeUndefined();
    const collector = collectEvents();
    collector.push(`${browserPreparationLine(value)}\n${browserFailureLine(valid)}\n`);
    expect(collector.browserFailures).toEqual([valid]);
  }
  expect(
    safeBrowserPreparation({
      kind: "wrapper",
      state: "failed",
      category: "completed",
      configuredTimeoutMs: 30000,
      durationMs: 2,
    }),
  ).toMatchObject({ state: "failed", configuredTimeoutMs: 30000 });
});

test("preparation phases expose only finite progress and existing database side metadata", () => {
  const value = {
    kind: "phase",
    phase: "migrations",
    state: "started",
    durationMs: 0,
    totalDurationMs: 10,
  };
  for (const phase of [
    "ownership",
    "synthetic_ddl",
    "ownership_close",
    "migrations",
    "bootstrap",
    "credential_hash",
    "credential_insert",
    "unit_close",
  ])
    for (const state of ["started", "success", "failed"])
      expect(safeBrowserPreparation({ ...value, phase, state })).toEqual({
        ...value,
        phase,
        state,
      });
  for (const credential of [1, 2, 3])
    expect(safeBrowserPreparation({ ...value, phase: "credential_hash", credential })).toEqual({
      ...value,
      phase: "credential_hash",
      credential,
    });
  // Counts come from the real migrator; diagnostics do not freeze the migration-chain size.
  expect(safeBrowserPreparation({ ...value, state: "success", applied: 13 })).toEqual({
    ...value,
    state: "success",
    applied: 13,
  });
  const failure = {
    ...value,
    state: "failed",
    databaseOperation: {
      operation: "migration_journal_finalize",
      wireDeadlineMs: 5000,
      elapsedMs: 5001,
    },
  };
  expect(safeBrowserPreparation(failure)).toEqual(failure);
  const reconstructed = safeBrowserPreparation(failure);
  expect(reconstructed).not.toBe(failure);
  if (reconstructed?.kind !== "phase") throw new Error("MISSING_PREPARATION_PHASE");
  expect(reconstructed.databaseOperation).not.toBe(failure.databaseOperation);
});

test("preparation diagnostics reject private fields and malformed progress without reading errors", () => {
  const value = {
    kind: "phase",
    phase: "migrations",
    state: "failed",
    durationMs: 1,
    totalDurationMs: 2,
  };
  const wrapper = {
    kind: "wrapper",
    state: "failed",
    category: "deadline",
    configuredTimeoutMs: 60000,
    durationMs: 60001,
  };
  const invalid: unknown[] = [
    null,
    [],
    privateText,
    ...["message", "error", "stack", "cause", "settings", "token", "path", "sql"].map((key) => ({
      ...value,
      [key]: privateText,
    })),
    { ...value, phase: privateText },
    { ...value, state: privateText },
    { ...value, applied: 12 },
    { ...value, phase: "bootstrap", state: "success", applied: 1 },
    { ...value, credential: 1 },
    ...[0, 4, 1.5, privateText].map((credential) => ({
      ...value,
      phase: "credential_insert",
      credential,
    })),
    ...[-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, 86400001, privateText].flatMap((n) => [
      { ...value, durationMs: n },
      { ...value, totalDurationMs: n },
      { ...wrapper, configuredTimeoutMs: n },
    ]),
    ...[-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, privateText].map((applied) => ({
      ...value,
      state: "success",
      applied,
    })),
    { ...wrapper, configuredTimeoutMs: 0 },
    { ...wrapper, state: "success" },
    { ...wrapper, category: privateText },
    { ...wrapper, message: privateText },
    {
      ...value,
      databaseOperation: {
        operation: "migration_statement",
        wireDeadlineMs: 30000,
        elapsedMs: 3,
        sql: privateText,
      },
    },
    ...[privateText, {}, { operation: privateText, wireDeadlineMs: 1, elapsedMs: 1 }].map(
      (databaseOperation) => ({ ...value, databaseOperation }),
    ),
    {
      ...value,
      get error() {
        throw new Error("PRIVATE_FIELD_READ");
      },
    },
  ];
  for (const item of invalid) {
    expect(safeBrowserPreparation(item)).toBeUndefined();
    expect(() => browserPreparationLine(item)).toThrow("INVALID_BROWSER_PREPARATION");
  }
  expect(browserPreparationLine(wrapper)).not.toContain(privateText);
  expect(safeBrowserPreparation(valid)).toBeUndefined();
});
