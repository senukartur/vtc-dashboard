import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
// The production smoke invokes the same offline verifier on its copied artifact.
// @ts-expect-error The operations module is intentionally deployed as native JavaScript.
import { verifyNativeNotices } from "../../deploy/development/manual-native-notices.mjs";

const bundle = fileURLToPath(new URL("../../third_party/sharp-libvips-1.3.4/", import.meta.url));
test("native original notices retain all pinned bytes and full license sections offline", async () => {
  expect(await verifyNativeNotices(bundle)).toMatchObject({
    components: 385,
    originalFiles: 803,
    uniqueTexts: 343,
    uniqueBytes: 1656228,
  });
});

test("notice verifier rejects modified original bytes and unsafe manifest paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtc-native-notices-"));
  try {
    await cp(bundle, root, { recursive: true });
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const ref = manifest.entries[0].files[0];
    const bytes = await readFile(join(root, ref.file));
    await writeFile(join(root, ref.file), Buffer.concat([bytes, Buffer.from("changed")]));
    await expect(verifyNativeNotices(root)).rejects.toThrow("NATIVE_NOTICE_HASH");
    await writeFile(join(root, ref.file), bytes);
    ref.file = "../outside.txt";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyNativeNotices(root)).rejects.toThrow("NATIVE_NOTICE_PATH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
