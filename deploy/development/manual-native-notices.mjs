import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Offline integrity verification; provenance URLs are never fetched by checks or runtime.
export async function verifyNativeNotices(root) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.formatVersion, 1, "NATIVE_NOTICE_FORMAT");
  assert.equal(manifest.nativeVersion, "1.3.4", "NATIVE_NOTICE_VERSION");
  assert.deepEqual(manifest.failures, [], "NATIVE_NOTICE_GAPS");
  const texts = new Map();
  let originalFiles = 0;
  for (const entry of manifest.entries) {
    assert.ok(entry.name && entry.version, "NATIVE_NOTICE_COMPONENT");
    assert.ok(
      entry.url || (entry.repository && /^[a-f0-9]{40}$/.test(entry.commit)),
      "NATIVE_NOTICE_PROVENANCE",
    );
    assert.ok(entry.files.length > 0, "NATIVE_NOTICE_COMPONENT_EMPTY");
    for (const ref of entry.files) {
      originalFiles++;
      assert.match(ref.sha256, /^[a-f0-9]{64}$/, "NATIVE_NOTICE_HASH_FORMAT");
      assert.equal(ref.file, `texts/${ref.sha256}.txt`, "NATIVE_NOTICE_PATH");
      assert.ok(ref.sourcePath, "NATIVE_NOTICE_SOURCE_PATH");
      if (!texts.has(ref.file)) {
        const bytes = await readFile(join(root, ref.file));
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          ref.sha256,
          "NATIVE_NOTICE_HASH",
        );
        texts.set(ref.file, bytes);
      }
      assert.equal(texts.get(ref.file).length, ref.bytes, "NATIVE_NOTICE_SIZE");
    }
  }
  assert.deepEqual(
    (await readdir(join(root, "texts"))).sort(),
    [...texts.keys()].map((file) => file.slice(6)).sort(),
    "NATIVE_NOTICE_FILE_SET",
  );
  const summary = {
    components: manifest.entries.length,
    originalFiles,
    uniqueTexts: texts.size,
    uniqueBytes: [...texts.values()].reduce((sum, bytes) => sum + bytes.length, 0),
  };
  assert.deepEqual(summary, manifest.contentSummary, "NATIVE_NOTICE_COUNTS");
  assert.deepEqual(
    summary,
    { components: 385, originalFiles: 803, uniqueTexts: 343, uniqueBytes: 1656228 },
    "NATIVE_NOTICE_PINNED_COUNTS",
  );
  const body = (ref) => {
    assert.equal(ref.file, `texts/${ref.sha256}.txt`, "NATIVE_NOTICE_ASSOCIATION");
    assert.ok(texts.has(ref.file), "NATIVE_NOTICE_MISSING_ASSOCIATION");
    return texts.get(ref.file).toString("utf8").replace(/\s+/g, " ");
  };
  const gnu = body(manifest.resolutions[0]);
  for (const section of [
    "GNU GENERAL PUBLIC LICENSE",
    "GNU LESSER GENERAL PUBLIC LICENSE",
    "Version 3",
    "4. Combined Works.",
    "17. Interpretation of Sections 15 and 16.",
  ])
    assert.ok(gnu.includes(section), "NATIVE_NOTICE_GNU_FULL_TEXT");
  const full = manifest.fullDeclaredLicenseTexts;
  for (const section of ["Permission is hereby granted", "THE SOFTWARE IS PROVIDED"])
    assert.ok(body(full.MIT).includes(section), "NATIVE_NOTICE_MIT_FULL_TEXT");
  for (const section of [
    "Mozilla Public License Version 2.0",
    "10.3. Modified Versions",
    "Exhibit B",
  ])
    assert.ok(body(full["MPL-2.0"]).includes(section), "NATIVE_NOTICE_MPL_FULL_TEXT");
  for (const section of [
    "Apache License",
    "Version 2.0",
    "9. Accepting Warranty or Additional Liability.",
  ])
    assert.ok(body(full["Apache-2.0"]).includes(section), "NATIVE_NOTICE_APACHE_FULL_TEXT");
  assert.equal(Object.keys(manifest.nativeVersions).length, 28, "NATIVE_NOTICE_VERSION_COUNT");
  const mappings = manifest.mappingCoverage.mappings;
  assert.equal(
    new Set(mappings.map((mapping) => mapping.library)).size,
    29,
    "NATIVE_NOTICE_MAPPING_COUNT",
  );
  for (const mapping of mappings) {
    assert.ok(mapping.noticeFiles.length > 0, "NATIVE_NOTICE_MAPPING_EMPTY");
    for (const file of mapping.noticeFiles)
      assert.ok(texts.has(file), "NATIVE_NOTICE_MAPPING_MISSING");
  }
  const vendored = manifest.mappingCoverage.additionalVendoredLibrary;
  assert.equal(vendored.name, "libnsgif");
  assert.equal(vendored.notice.bytes, 1133);
  assert.ok(body(vendored.notice).includes("Permission is hereby granted"));
  return {
    ...summary,
    nativeVersions: manifest.nativeVersions,
    libraries: mappings.map((mapping) => mapping.library),
  };
}
