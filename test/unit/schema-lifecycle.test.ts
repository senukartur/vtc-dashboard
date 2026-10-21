import type { afterAll, beforeAll } from "vitest";
import { expect, test } from "vitest";
import { deferred } from "../support/concurrency.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

test("schema teardown awaits an in-flight setup before releasing its fixture guard", async () => {
  let setup!: () => Promise<void>, teardown!: () => Promise<void>;
  const hooks = schemaLifecycleHooks(
    ((fn: () => Promise<void>) => {
      setup = fn;
    }) as typeof beforeAll,
    ((fn: () => Promise<void>) => {
      teardown = fn;
    }) as typeof afterAll,
  );
  const gate = deferred<void>();
  let released = false;
  hooks.beforeAll(async () => gate.promise);
  hooks.afterAll(async () => {
    released = true;
  });
  const starting = setup();
  const closing = teardown();
  await Promise.resolve();
  expect(released).toBe(false);
  gate.resolve();
  await starting;
  await closing;
  expect(released).toBe(true);
});
test("schema teardown preserves a failed setup outcome and still closes its own fixture", async () => {
  let setup!: () => Promise<void>, teardown!: () => Promise<void>;
  const hooks = schemaLifecycleHooks(
    ((fn: () => Promise<void>) => {
      setup = fn;
    }) as typeof beforeAll,
    ((fn: () => Promise<void>) => {
      teardown = fn;
    }) as typeof afterAll,
  );
  let released = false;
  hooks.beforeAll(async () => {
    throw new Error("SYNTHETIC_SETUP_FAILED");
  });
  hooks.afterAll(async () => {
    released = true;
  });
  await expect(setup()).rejects.toThrow("SYNTHETIC_SETUP_FAILED");
  await teardown();
  expect(released).toBe(true);
});
