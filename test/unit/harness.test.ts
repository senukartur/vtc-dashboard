import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cleanupAllocation } from "../support/allocation-cleanup.ts";
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
