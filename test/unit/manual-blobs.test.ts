import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@vtc/db";
import { afterEach, expect, test } from "vitest";
import { calendarYearAfter } from "../../apps/api/src/modules/manual-reports/service.ts";
import {
  BlobFailure,
  createPrivateFilesystem,
  validateImage,
} from "../../apps/api/src/platform/blob-storage/filesystem.ts";
import { pngBytes } from "../fixtures/manual-images.ts";

const roots: string[] = [];
async function fixture(maxFileBytes = 1024 * 1024) {
  const root = await mkdtemp(join(tmpdir(), "vtc-manual-synthetic-"));
  roots.push(root);
  await chmod(root, 0o700);
  const config = { root, maxFileBytes, maxPixels: 10000, timeoutMs: 5000 };
  return {
    root,
    config,
    store: createPrivateFilesystem(config),
    key: { id: newId(), generation: newId() },
  };
}
async function* bytes(value: Buffer) {
  yield value;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
test("calendar retention uses a UTC calendar year, conservatively preserves leap day and overflow", () => {
  expect(calendarYearAfter("2024-02-29T12:00:00.000Z")).toBe("2025-03-01T12:00:00.000Z");
  expect(calendarYearAfter("2025-12-31T23:59:59.999Z")).toBe("2026-12-31T23:59:59.999Z");
  expect(calendarYearAfter("9999-12-31T23:59:59.999Z")).toBeNull();
});
test("private filesystem fully decodes, preserves original bytes/checksum and survives a new adapter instance", async () => {
  const f = await fixture(),
    original = pngBytes();
  const result = await f.store.put(f.key, bytes(original));
  expect(result.contentType).toBe("image/png");
  expect(result.byteLength).toBe(original.length);
  expect(await readFile(join(f.root, `${f.key.id}.${f.key.generation}.blob`))).toEqual(original);
  const restarted = createPrivateFilesystem(f.config);
  expect((await restarted.inspect(f.key))?.sha256).toEqual(result.sha256);
  const stream = await restarted.read(f.key),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(original);
  await expect(restarted.put(f.key, bytes(original))).rejects.toBeInstanceOf(BlobFailure);
  expect((await restarted.inspect(f.key))?.sha256).toEqual(result.sha256);
  await restarted.remove(f.key);
  await restarted.remove(f.key);
  expect(await restarted.inspect(f.key)).toBeNull();
});
test("invalid/truncated files, oversized chunked input, interrupted writes and cancellation never become immutable objects", async () => {
  const f = await fixture(1000);
  for (const invalid of [Buffer.from("not an image"), pngBytes().subarray(0, 45)]) {
    await expect(
      f.store.put({ id: newId(), generation: newId() }, bytes(invalid)),
    ).rejects.toMatchObject({ category: "invalid" });
  }
  await expect(f.store.put(f.key, bytes(Buffer.alloc(1001)))).rejects.toMatchObject({
    category: "oversized",
  });
  async function* interrupted() {
    yield Buffer.from("partial");
    throw Error("SYNTHETIC_INTERRUPTION");
  }
  await expect(f.store.put(f.key, interrupted())).rejects.toBeInstanceOf(BlobFailure);
  const abort = new AbortController();
  async function* paused() {
    yield Buffer.from("partial");
    await new Promise<void>((resolve) =>
      abort.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  }
  const pending = f.store.put(f.key, paused(), abort.signal);
  setTimeout(() => abort.abort(), 20);
  await expect(pending).rejects.toMatchObject({ category: "cancelled" });
  expect(await readdir(f.root)).toEqual([]);
});
test("decoder admission is shared, rejects saturation and releases both cancelled slots", async () => {
  const f = await fixture(),
    file = join(f.root, "synthetic.png");
  await writeFile(file, pngBytes());
  const a = new AbortController(),
    b = new AbortController();
  const first = validateImage(file, f.config, a.signal),
    second = validateImage(file, f.config, b.signal);
  const settled = Promise.allSettled([first, second]),
    third = validateImage(file, f.config);
  a.abort();
  b.abort();
  await expect(third).rejects.toMatchObject({ category: "unavailable" });
  const results = await settled;
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect(await validateImage(file, f.config)).toBe("image/png");
});
test.runIf(process.platform === "linux")(
  "Linux no-follow/nonblocking descriptors reject FIFO, symlink and directory; unsafe roots fail closed",
  async () => {
    const f = await fixture(),
      name = join(f.root, `${f.key.id}.${f.key.generation}.blob`);
    execFileSync("mkfifo", [name]);
    const started = Date.now();
    await expect(f.store.read(f.key)).rejects.toMatchObject({ category: "invalid" });
    expect(Date.now() - started).toBeLessThan(1000);
    await rm(name);
    await mkdir(name);
    await expect(f.store.read(f.key)).rejects.toMatchObject({ category: "invalid" });
    await rm(name, { recursive: true });
    const target = join(f.root, "owned-target");
    await writeFile(target, pngBytes());
    await symlink(target, name);
    await expect(f.store.read(f.key)).rejects.toBeDefined();
    await expect(f.store.remove(f.key)).rejects.toBeDefined();
    expect((await lstat(name)).isSymbolicLink()).toBe(true);
    await chmod(f.root, 0o755);
    await expect(f.store.ready?.()).rejects.toMatchObject({ category: "unavailable" });
  },
);

test("full decode accepts grayscale, grayscale-alpha and RGBA PNG without confusing input and output channels", async () => {
  const f = await fixture();
  for (const channels of [1, 2, 4] as const) {
    const key = { id: newId(), generation: newId() };
    expect((await f.store.put(key, bytes(pngBytes(2, 2, channels)))).contentType).toBe("image/png");
  }
});

test("stalled source deadline closes staging without a detached file write", async () => {
  const f = await fixture(),
    fast = createPrivateFilesystem({ ...f.config, timeoutMs: 100 });
  async function* stalled() {
    yield Buffer.from("partial");
    await new Promise<void>(() => {});
  }
  const started = Date.now();
  await expect(fast.put(f.key, stalled())).rejects.toMatchObject({ category: "cancelled" });
  expect(Date.now() - started).toBeLessThan(1000);
  expect(await readdir(f.root)).toEqual([]);
});
