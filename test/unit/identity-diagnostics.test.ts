import type { UnitOfWork } from "@vtc/db";
import type { Connection } from "mysql2/promise";
import { expect, test, vi } from "vitest";
import { identityDiagnostics, safeIdentityFailure } from "../support/identity-diagnostics.ts";

test("identity fixture diagnostics retain only allowlisted failure facts through bounded cyclic causes", () => {
  const inner = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL_AND_INPUT"), {
    code: "ETIMEDOUT",
    statusCode: 503,
  });
  const outer = Object.assign(new Error("SYNTHETIC_PRIVATE_CREDENTIAL"), {
    code: "SYNTHETIC_PRIVATE_CODE",
    cause: inner,
  });
  Object.assign(inner, { cause: outer });
  expect(safeIdentityFailure(outer)).toEqual({
    codes: ["ETIMEDOUT"],
    statusCode: 503,
    category: "unclassified",
  });
  expect(
    safeIdentityFailure({ statusCode: "SYNTHETIC_PRIVATE", code: "SYNTHETIC_PRIVATE" }),
  ).toEqual({ codes: [], category: "unclassified" });
});

test("unknown commit capture runs once, keeps fixed numeric counters and never retries the command", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    lines.push(String(value));
  });
  const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), {
    code: "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
  });
  const query = vi.fn(async () => [
    [
      { Variable_name: "Com_commit", Value: "12" },
      { Variable_name: "SYNTHETIC_PRIVATE", Value: "secret" },
      { Variable_name: "Threads_running", Value: "SYNTHETIC_PRIVATE" },
    ],
    [],
  ]);
  const run = vi.fn(async () => {
    throw failure;
  });
  const subject = identityDiagnostics("identity").unit(
    { run, client: vi.fn(), close: async () => {} },
    { query } as unknown as Connection,
  );
  try {
    await expect(subject.run(async () => 0)).rejects.toBe(failure);
    await expect(subject.run(async () => 0)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lines.every((line) => !line.includes("SYNTHETIC_PRIVATE"))).toBe(true);
    const facts = lines.map((line) => JSON.parse(line));
    expect(facts.filter((fact) => fact.event === "identity_fixture_unknown_commit")).toHaveLength(
      1,
    );
    expect(facts.find((fact) => fact.event === "identity_fixture_commit_status").counters).toEqual({
      Com_commit: 12,
    });
  } finally {
    await subject.close();
    output.mockRestore();
  }
});

test("fixture phase errors are sanitized while transaction diagnostics preserve internal error identity", async () => {
  const lines: string[] = [],
    output = vi
      .spyOn(console, "log")
      .mockImplementation((value: unknown) => lines.push(String(value)));
  const diagnostic = identityDiagnostics("identity"),
    failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_NO_SUCH_TABLE" });
  try {
    expect(await diagnostic.phase("connection", async () => 1)).toBe(1);
    await expect(
      diagnostic.phase("migrations", async () => {
        throw failure;
      }),
    ).rejects.toMatchObject({
      message: "IDENTITY_FIXTURE_PHASE_FAILED",
      codes: ["ER_NO_SUCH_TABLE"],
    });
    const unit: UnitOfWork = {
      close: async () => {},
      client: () => {
        throw failure;
      },
      run: async () => {
        throw failure;
      },
    };
    await expect(diagnostic.unit(unit).run(async () => 0)).rejects.toBe(failure);
    expect(lines.length).toBe(5);
    expect(lines.every((line) => !line.includes("SYNTHETIC_PRIVATE"))).toBe(true);
    expect(lines.map((line) => JSON.parse(line).state)).toEqual([
      "started",
      "success",
      "started",
      "failed",
      "failed",
    ]);
  } finally {
    output.mockRestore();
  }
});
