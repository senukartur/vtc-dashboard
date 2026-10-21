import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createPrivateFilesystem } from "../dist/platform/blob-storage/filesystem.js";
import { verifyNativeNotices } from "./manual-native-notices.mjs";

// Only the isolated deployment rehearsal invokes these fixed original fixtures.
assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
assert.equal(process.platform, "linux");
assert.equal(process.getuid(), 1000);
const phase = process.argv[2];
assert.ok(["write", "read", "remove"].includes(phase));
const root = "/app/private-evidence";
const proofRun = process.env.MANUAL_REHEARSAL_RUN ?? "";
assert.ok(/^[a-f0-9]{32}$/.test(proofRun), "MANUAL_SYNTHETIC_VOLUME_REQUIRED");
assert.equal(
  await readFile(join(root, ".manual-rehearsal-guard"), "utf8"),
  proofRun,
  "MANUAL_SYNTHETIC_VOLUME_REQUIRED",
);
assert.ok(
  (await readFile(join(root, "sentinel.txt"), "utf8")) === "fictional-evidence-sentinel-vtc011\n",
  "MANUAL_SYNTHETIC_VOLUME_REQUIRED",
);
assert.equal((await lstat(root)).mode & 0o777, 0o700);
const req = createRequire(import.meta.url),
  sharpRoot = dirname(dirname(await realpath(req.resolve("sharp"))));
assert.match(await readFile(join(sharpRoot, "LICENSE"), "utf8"), /Apache License/);
const native = createRequire(req.resolve("sharp"));
const lib = dirname(dirname(await realpath(native.resolve("@img/sharp-libvips-linux-x64/lib"))));
const nativePackage = JSON.parse(await readFile(join(lib, "package.json"), "utf8")),
  nativeNotice = await readFile(join(lib, "README.md"), "utf8");
assert.equal(nativePackage.version, "1.3.4");
assert.equal(nativePackage.license, "LGPL-3.0-or-later");
const notices = await verifyNativeNotices(
  fileURLToPath(new URL("../third_party/sharp-libvips-1.3.4/", import.meta.url)),
);
assert.deepEqual(
  JSON.parse(await readFile(join(lib, "versions.json"), "utf8")),
  notices.nativeVersions,
);
assert.equal(sharp.versions.sharp, "0.35.5");
const actualLibraries = [...nativeNotice.matchAll(/^\| ([a-z][a-z0-9-]*)\s+\|/gm)].map(
  (match) => match[1],
);
assert.deepEqual(actualLibraries.sort(), notices.libraries.sort());
assert.match(nativeNotice, /"any later version" clause of the LGPLv2 or LGPLv2.1/);
assert.ok((await readdir(join(lib, "lib"))).some((name) => /^libvips-cpp\.so\./.test(name)));
assert.ok(sharp.versions.vips);
const store = createPrivateFilesystem({
  root,
  maxFileBytes: 1024 * 1024,
  maxPixels: 10000,
  timeoutMs: 5000,
});
await store.ready();
// Both encodings are generated from original fictional pixels in this process.
const fixtures = [
  await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer(),
  await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer(),
];
for (let i = 0; i < fixtures.length; i++) {
  const key = {
      id: `02500000-0000-4000-8000-00000000000${i}`,
      generation: "02500000-0000-4000-8000-000000000009",
    },
    original = fixtures[i];
  if (phase === "write")
    await store.put(
      key,
      (async function* () {
        yield original;
      })(),
    );
  else if (phase === "remove") {
    await store.remove(key);
    assert.equal(await store.present(key), false);
  }
  if (phase !== "remove") {
    const verified = await store.inspect(key);
    assert.equal(verified?.contentType, i === 0 ? "image/png" : "image/jpeg");
    assert.deepEqual(verified?.sha256, createHash("sha256").update(original).digest());
    const chunks = [];
    for await (const chunk of await store.read(key)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), original);
  }
}
console.log(
  `Manual production smoke: ${phase} PASS (full JPEG/PNG decode, native linkage and offline full notice bundle integrity, uid/root permissions, persistent original bytes)`,
);
