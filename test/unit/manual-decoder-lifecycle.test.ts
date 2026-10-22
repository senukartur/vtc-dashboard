import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: boundary.spawn }));

import { validateImage } from "../../apps/api/src/platform/blob-storage/filesystem.ts";

class Decoder extends EventEmitter {
  pid: number | undefined = 42;
  stdout = new PassThrough();
  kill = vi.fn(() => true);
  close(code: number | null = 0) {
    this.stdout.end();
    this.emit("close", code, code === null ? "SIGKILL" : null);
  }
}
const children: Decoder[] = [];
const config = { timeoutMs: 100, maxPixels: 10000 };
const start = (signal?: AbortSignal) => {
  const child = new Decoder();
  children.push(child);
  boundary.spawn.mockReturnValueOnce(child);
  return { child, work: validateImage("synthetic-image", config, signal) };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const child of children.splice(0)) child.close(null);
  vi.clearAllTimers();
  vi.useRealTimers();
  boundary.spawn.mockReset();
});

test.each(["image/png", "image/jpeg"])(
  "exit before final %s output does not settle or release its decoder slot",
  async (mime) => {
    const controller = new AbortController();
    const { child, work } = start(controller.signal);
    const completed = vi.fn();
    const outcome = work.then(completed);
    child.emit("exit", 0, null);
    await flush();
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    child.stdout.write(mime);
    child.close();
    await outcome;
    expect(completed).toHaveBeenCalledWith(mime);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stdout.listenerCount("error")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    controller.abort();
    child.emit("exit", 1, null);
    child.close(1);
    expect(completed).toHaveBeenCalledTimes(1);
  },
);

test.each([
  ["nonzero", "invalid"],
  ["wrong_mime", "invalid"],
  ["empty", "invalid"],
  ["output32", "invalid"],
  ["overlong", "invalid"],
  ["spawn_error", "unavailable"],
  ["stream_error", "unavailable"],
  ["timeout_after_exit", "cancelled"],
  ["abort_after_exit", "cancelled"],
] as const)("%s waits for closure and retains its first %s failure", async (scenario, category) => {
  const controller = new AbortController();
  const { child, work } = start(controller.signal);
  const settled = vi.fn();
  const outcome = work.catch((error: unknown) => {
    settled();
    return error;
  });
  child.emit("exit", scenario === "nonzero" ? 1 : 0, null);
  if (scenario === "nonzero") child.stdout.write("image/png");
  if (scenario === "wrong_mime") child.stdout.write("image/gif");
  if (scenario === "output32") child.stdout.write("x".repeat(32));
  if (scenario === "overlong") child.stdout.write("x".repeat(33));
  if (scenario === "spawn_error") {
    child.pid = undefined;
    child.emit("error", Error("SYNTHETIC_PRIVATE_NATIVE_ERROR"));
  }
  if (scenario === "stream_error")
    child.stdout.emit("error", Error("SYNTHETIC_PRIVATE_STREAM_ERROR"));
  if (scenario === "timeout_after_exit") await vi.advanceTimersByTimeAsync(config.timeoutMs);
  if (scenario === "abort_after_exit") controller.abort();
  await flush();
  expect(settled).not.toHaveBeenCalled();
  if (!["nonzero", "wrong_mime", "empty", "output32"].includes(scenario)) {
    expect(child.stdout.destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(config.timeoutMs);
  } else expect(child.kill).not.toHaveBeenCalled();
  if (!["nonzero", "wrong_mime", "empty", "output32", "spawn_error"].includes(scenario))
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  child.close(scenario === "nonzero" ? 1 : 0);
  expect(await outcome).toMatchObject({ category });
  expect(settled).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stdout.listenerCount("error")).toBe(0);
  expect(child.listenerCount("error")).toBe(0);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  controller.abort();
  child.close(1);
  expect(settled).toHaveBeenCalledTimes(1);
});

test("both stopped decoders keep admission until actual closure, then both slots can be reused", async () => {
  const a = new AbortController(),
    b = new AbortController();
  const first = start(a.signal),
    second = start(b.signal);
  const settled = Promise.allSettled([first.work, second.work]);
  first.child.emit("exit", 0, null);
  second.child.emit("exit", 0, null);
  a.abort();
  b.abort();
  await expect(validateImage("synthetic-image", config)).rejects.toMatchObject({
    category: "unavailable",
  });
  expect(boundary.spawn).toHaveBeenCalledTimes(2);
  first.child.close(null);
  second.child.close(null);
  expect((await settled).every((result) => result.status === "rejected")).toBe(true);
  const next = start(),
    last = start();
  next.child.stdout.write("image/png");
  last.child.stdout.write("image/jpeg");
  next.child.close();
  last.child.close();
  expect(await Promise.all([next.work, last.work])).toEqual(["image/png", "image/jpeg"]);
  expect(vi.getTimerCount()).toBe(0);
});

test("already cancelled input and synchronous spawn failure do not strand an admission slot", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(validateImage("synthetic-image", config, controller.signal)).rejects.toMatchObject({
    category: "cancelled",
  });
  expect(boundary.spawn).not.toHaveBeenCalled();
  const failure = Error("SYNTHETIC_SPAWN_FAILURE");
  boundary.spawn.mockImplementationOnce(() => {
    throw failure;
  });
  await expect(validateImage("synthetic-image", config)).rejects.toMatchObject({
    category: "unavailable",
  });
  const { child, work } = start();
  child.stdout.write("image/png");
  child.close();
  expect(await work).toBe("image/png");
});
