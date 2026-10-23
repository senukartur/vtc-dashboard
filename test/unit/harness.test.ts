import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { type CleanupDiagnostic, cleanupAllocation } from "../support/allocation-cleanup.ts";
import { isDeliberateFailure, probeIdentity } from "../support/failure-proof.ts";

test("failure proof accepts only the reached deliberate assertion diagnostic with exit one", () => {
  const identity = probeIdentity("integration");
  const positive = {
    code: 1,
    output: `FAIL ${identity}\nAssertionError: ${identity}: deliberate assertion reached\n`,
  };
  expect(isDeliberateFailure("integration", positive)).toBe(true);
  for (const code of [0, 2, 130])
    expect(isDeliberateFailure("integration", { ...positive, code })).toBe(false);
  expect(isDeliberateFailure("unit", positive)).toBe(false);
  for (const output of [
    `FAIL ${identity}\nAssertionError: launcher must hold this allocation's suite ownership lock\n  8 | deliberateFailure("integration");\n  9 | // AssertionError: ${identity}: deliberate assertion reached`,
    `FAIL ${identity}\nAssertionError: unrelated setup failure\n`,
    `FAIL ${identity}\nexpected guard value to be correct\n`,
    `${identity}\nError: browser launch failed\n`,
    `FAIL ${identity}\n > 8 | assert.fail("${identity}: deliberate assertion reached");\n`,
  ])
    expect(isDeliberateFailure("integration", { code: 1, output })).toBe(false);
});

test("allocation cleanup attempts every owned step, removes its file and preserves safe categories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc008-cleanup-"));
  const file = join(directory, "owned.json");
  await writeFile(file, "synthetic allocation");
  const calls: string[] = [];
  try {
    const failures = await cleanupAllocation(
      { schema: true, user: true, file: true },
      {
        lock: async () => {
          calls.push("lock");
          throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
        },
        schema: async () => {
          calls.push("schema");
          throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
        },
        user: async () => {
          calls.push("user");
        },
        file: async () => {
          calls.push("file");
          await rm(file);
        },
        admin: async () => {
          calls.push("admin");
          throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
        },
        destroyAdmin: () => {
          calls.push("transport");
        },
      },
    );
    expect(failures).toEqual(["LOCK", "SCHEMA", "ADMIN"]);
    expect(calls).toEqual(["lock", "schema", "user", "file", "admin", "transport"]);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("failed allocation collisions clean only resources created by that invocation", async () => {
  const calls: string[] = [];
  const step = (name: string) => async () => {
    calls.push(name);
  };
  const operations = {
    lock: step("lock"),
    schema: step("schema"),
    user: step("user"),
    file: step("file"),
    admin: step("admin"),
    destroyAdmin: () => {
      calls.push("destroyAdmin");
    },
  };
  expect(await cleanupAllocation({ schema: false, user: false, file: false }, operations)).toEqual(
    [],
  );
  expect(calls).toEqual(["lock", "admin", "destroyAdmin"]);
  calls.length = 0;
  expect(await cleanupAllocation({ schema: true, user: false, file: false }, operations)).toEqual(
    [],
  );
  expect(calls).toEqual(["lock", "schema", "admin", "destroyAdmin"]);
});

test("user and file cleanup failures still close and force-close the provisioner", async () => {
  const calls: string[] = [];
  const failures = await cleanupAllocation(
    { schema: false, user: true, file: true },
    {
      lock: async () => {},
      schema: async () => {},
      user: async () => {
        calls.push("user");
        throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
      },
      file: async () => {
        calls.push("file");
        throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
      },
      admin: async () => {
        calls.push("admin");
      },
      destroyAdmin: () => {
        calls.push("transport");
      },
    },
  );
  expect(failures).toEqual(["USER", "FILE"]);
  expect(calls).toEqual(["user", "file", "admin", "transport"]);
});

test("schema cleanup has a separate DDL allowance while other steps keep their three-second bound", async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  try {
    const result = cleanupAllocation(
      { schema: true, user: true, file: true },
      {
        lock: async () => {},
        schema: async () => {
          calls.push("schema");
          await new Promise<void>((resolve) => setTimeout(resolve, 4000));
        },
        user: async () => {
          calls.push("user");
          await new Promise<void>(() => {});
        },
        file: async () => {
          calls.push("file");
        },
        admin: async () => {
          calls.push("admin");
        },
        destroyAdmin: () => calls.push("transport"),
      },
    );
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toEqual(["schema", "user"]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toEqual(["schema", "user"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(["USER"]);
    expect(calls).toEqual(["schema", "user", "file", "admin", "transport"]);
  } finally {
    vi.useRealTimers();
  }
});

function cleanupFixture() {
  const calls: string[] = [];
  const operation = (name: string) => async () => {
    calls.push(name);
  };
  return {
    calls,
    operations: {
      lock: operation("lock"),
      schema: operation("schema"),
      user: operation("user"),
      file: operation("file"),
      admin: operation("admin"),
      userAbsence: async () => {
        calls.push("user_absence");
        return true;
      },
      destroyAdmin: () => {
        calls.push("transport");
      },
    },
  };
}
const allOwned = { schema: true, user: true, file: true };

test("acknowledged user deletion is verified after file removal and before provisioner close", async () => {
  const { calls, operations } = cleanupFixture();
  const records: CleanupDiagnostic[] = [];
  expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual(
    [],
  );
  expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence", "admin", "transport"]);
  expect(
    records.find((record) => record.phase === "user_absence" && record.state === "success"),
  ).toMatchObject({
    wireTimeoutMs: 2000,
    wallTimeoutMs: 3000,
    settlement: "fulfilled",
    serverOutcome: "acknowledged",
    userAbsent: true,
    category: "none",
  });
  expect(
    records.find((record) => record.phase === "user" && record.state === "success"),
  ).toMatchObject({ wireTimeoutMs: 2000, wallTimeoutMs: 3000, userAbsent: null });
  expect(
    records.find((record) => record.phase === "schema" && record.state === "success"),
  ).toMatchObject({ wireTimeoutMs: 10000, wallTimeoutMs: 12000 });
});

test("cleanup observations distinguish an acknowledged server rejection from driver uncertainty", async () => {
  for (const code of ["ER_CANNOT_USER", "PROTOCOL_SEQUENCE_TIMEOUT", "ECONNRESET"] as const) {
    const { calls, operations } = cleanupFixture();
    operations.user = async () => {
      throw Object.assign(new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC"), { code });
    };
    const records: CleanupDiagnostic[] = [];
    expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual(
      ["USER"],
    );
    const category =
      code === "ER_CANNOT_USER"
        ? "server_rejection"
        : code === "ECONNRESET"
          ? "transport_failure"
          : "driver_timeout";
    expect(
      records.find((record) => record.phase === "user" && record.state === "failed"),
    ).toMatchObject({
      settlement: "rejected",
      category,
      nativeCodes: [code],
      serverOutcome: category === "server_rejection" ? "rejected" : "unknown",
      userAbsent: null,
    });
    expect(records.find((record) => record.phase === "user_absence")).toMatchObject({
      state: "not_checked",
      settlement: "not_started",
      userAbsent: null,
    });
    expect(calls).toEqual(["lock", "schema", "file", "admin", "transport"]);
  }
});

test("an earlier uncertain schema operation fences the optional probe even after user acknowledgment", async () => {
  for (const error of [
    Object.assign(new Error(), { code: "PROTOCOL_SEQUENCE_TIMEOUT" }),
    new Error(),
  ]) {
    const { calls, operations } = cleanupFixture();
    operations.schema = async () => {
      throw error;
    };
    const records: CleanupDiagnostic[] = [];
    expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual(
      ["SCHEMA"],
    );
    expect(calls).toEqual(["lock", "user", "file", "admin", "transport"]);
    expect(records.find((record) => record.phase === "user_absence")).toMatchObject({
      state: "not_checked",
      serverOutcome: "unknown",
      userAbsent: null,
    });
  }
});

test("an acknowledged schema rejection preserves the failure and permits exact-user verification", async () => {
  const { calls, operations } = cleanupFixture();
  operations.schema = async () => {
    throw { code: "ER_DB_DROP_EXISTS" };
  };
  expect(await cleanupAllocation(allOwned, operations)).toEqual(["SCHEMA"]);
  expect(calls).toEqual(["lock", "user", "file", "user_absence", "admin", "transport"]);
});

test("optional absence verification never enumerates an unowned user and cannot hide a remaining account", async () => {
  const { calls, operations } = cleanupFixture();
  expect(await cleanupAllocation({ schema: false, user: false, file: false }, operations)).toEqual(
    [],
  );
  expect(calls).toEqual(["lock", "admin", "transport"]);
  calls.length = 0;
  operations.userAbsence = async () => {
    calls.push("user_absence");
    return false;
  };
  const records: CleanupDiagnostic[] = [];
  expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual([
    "USER_ABSENCE",
  ]);
  expect(
    records.find((record) => record.phase === "user_absence" && record.state === "failed"),
  ).toMatchObject({ category: "account_present", userAbsent: false, settlement: "fulfilled" });
  expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence", "admin", "transport"]);
});

test("absence query failure and file failure remain aggregate failures while close and force-close continue", async () => {
  const { calls, operations } = cleanupFixture();
  operations.file = async () => {
    calls.push("file");
    throw { code: "EACCES" };
  };
  operations.userAbsence = async () => {
    calls.push("user_absence");
    throw { code: "ER_ACCESS_DENIED_ERROR" };
  };
  const records: CleanupDiagnostic[] = [];
  expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual([
    "FILE",
    "USER_ABSENCE",
  ]);
  expect(
    records.find((record) => record.phase === "file" && record.state === "failed"),
  ).toMatchObject({
    category: "filesystem_failure",
    nativeCodes: ["EACCES"],
    serverOutcome: "not_applicable",
  });
  expect(
    records.find((record) => record.phase === "user_absence" && record.state === "failed"),
  ).toMatchObject({ userAbsent: null, serverOutcome: "rejected" });
  expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence", "admin", "transport"]);
});

test("wall expiry retains pending uncertainty, handles late rejection, and never schedules the probe", async () => {
  vi.useFakeTimers();
  try {
    const { calls, operations } = cleanupFixture();
    let rejectUser: (error: unknown) => void = () => {};
    operations.user = () =>
      new Promise<void>((_, reject) => {
        calls.push("user");
        rejectUser = reject;
      });
    const records: CleanupDiagnostic[] = [];
    const work = cleanupAllocation(allOwned, operations, (record) => records.push(record));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await work).toEqual(["USER"]);
    expect(
      records.find((record) => record.phase === "user" && record.state === "failed"),
    ).toMatchObject({
      category: "wall_timeout",
      elapsedMs: 3000,
      settlement: "pending",
      serverOutcome: "unknown",
      nativeCodes: [],
    });
    expect(calls).toEqual(["lock", "schema", "user", "file", "admin", "transport"]);
    rejectUser({ code: "PROTOCOL_SEQUENCE_TIMEOUT", message: "NONFUNCTIONAL_PRIVATE_DIAGNOSTIC" });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      records.find((record) => record.phase === "user" && record.state === "late_failed"),
    ).toMatchObject({
      category: "driver_timeout",
      settlement: "rejected",
      serverOutcome: "unknown",
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a late user acknowledgment never erases an expired cleanup or authorizes a probe", async () => {
  vi.useFakeTimers();
  try {
    const { calls, operations } = cleanupFixture();
    let resolveUser = () => {};
    operations.user = () =>
      new Promise<void>((resolve) => {
        resolveUser = resolve;
      });
    const records: CleanupDiagnostic[] = [];
    const work = cleanupAllocation(allOwned, operations, (record) => records.push(record));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await work).toEqual(["USER"]);
    resolveUser();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      records.find((record) => record.phase === "user" && record.state === "late_success"),
    ).toMatchObject({ settlement: "fulfilled", serverOutcome: "acknowledged", userAbsent: null });
    expect(calls).not.toContain("user_absence");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a bounded absence probe cannot delay file removal and still force-closes an unconfirmed provisioner", async () => {
  vi.useFakeTimers();
  try {
    const { calls, operations } = cleanupFixture();
    operations.userAbsence = async () => {
      calls.push("user_absence");
      return new Promise<boolean>(() => {});
    };
    operations.admin = async () => {
      calls.push("admin");
      return new Promise<void>(() => {});
    };
    const records: CleanupDiagnostic[] = [];
    const work = cleanupAllocation(allOwned, operations, (record) => records.push(record));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence"]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await work).toEqual(["USER_ABSENCE", "ADMIN"]);
    expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence", "admin", "transport"]);
    expect(
      records.find((record) => record.phase === "user_absence" && record.state === "failed"),
    ).toMatchObject({ category: "wall_timeout", userAbsent: null, serverOutcome: "unknown" });
    expect(records.find((record) => record.phase === "admin_transport")).toMatchObject({
      state: "success",
      serverOutcome: "not_applicable",
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("cleanup diagnostics defend against hostile, cyclic and excessive causes without private output", async () => {
  const privateValue = "NONFUNCTIONAL_PRIVATE_DIAGNOSTIC";
  const cyclic: Record<string, unknown> = {
    code: "ER_CANNOT_USER",
    message: privateValue,
    sql: privateValue,
  };
  cyclic.cause = cyclic;
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error(privateValue);
      },
    },
  );
  const tooDeep = { code: privateValue, cause: {} };
  let tail: { cause?: unknown } = tooDeep;
  for (let depth = 0; depth < 10; depth++) {
    const next = { cause: {} };
    tail.cause = next;
    tail = next;
  }
  tail.cause = { code: "ER_CANNOT_USER" };
  for (const [error, codes, category] of [
    [cyclic, ["ER_CANNOT_USER"], "server_rejection"],
    [hostile, [], "unknown"],
    [tooDeep, [], "unknown"],
    [
      { code: "ER_CANNOT_USER", cause: { code: "ECONNRESET" } },
      ["ER_CANNOT_USER", "ECONNRESET"],
      "transport_failure",
    ],
  ] as const) {
    const { operations } = cleanupFixture();
    operations.user = async () => {
      throw error;
    };
    const records: CleanupDiagnostic[] = [];
    expect(await cleanupAllocation(allOwned, operations, (record) => records.push(record))).toEqual(
      ["USER"],
    );
    expect(
      records.find((record) => record.phase === "user" && record.state === "failed"),
    ).toMatchObject({ nativeCodes: codes, category });
    const output = JSON.stringify(records);
    expect(output).not.toContain(privateValue);
    expect(output).not.toContain('"sql"');
    expect(output).not.toContain('"message"');
  }
});

test("diagnostic consumer failures cannot suppress cleanup and failed transport destruction remains visible", async () => {
  const { calls, operations } = cleanupFixture();
  operations.destroyAdmin = () => {
    calls.push("transport");
    throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  };
  expect(
    await cleanupAllocation(allOwned, operations, () => {
      throw new Error();
    }),
  ).toEqual(["ADMIN_TRANSPORT"]);
  expect(calls).toEqual(["lock", "schema", "user", "file", "user_absence", "admin", "transport"]);
});
