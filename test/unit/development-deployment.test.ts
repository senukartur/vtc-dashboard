import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { requireRelease, validateManifest } from "../../deploy/development/policy.mjs";

const revision = "a".repeat(40);
function fixture() {
  return {
    revision,
    mode: "auto",
    workflow: { id: 23, path: ".github/workflows/ci.yml" },
    run: {
      id: 123,
      run_attempt: 2,
      workflow_id: 23,
      repository: { full_name: "senukartur/vtc-dashboard" },
      head_repository: { full_name: "senukartur/vtc-dashboard" },
      event: "push",
      head_branch: "main",
      head_sha: revision,
      status: "completed",
      conclusion: "success",
    },
    ancestor: true,
    current: revision,
    artifacts: [
      {
        id: 77,
        name: `development-123-2-${revision}`,
        expired: false,
        size_in_bytes: 123,
        workflow_run: { id: 123, head_sha: revision },
      },
    ],
  };
}
test("only successful canonical main-push artifacts are eligible, including explicit historical manual release", () => {
  expect(requireRelease(fixture())).toMatchObject({
    revision,
    runId: 123,
    attempt: 2,
    mode: "auto",
  });
  const historical = fixture();
  historical.mode = "manual";
  historical.current = "b".repeat(40);
  expect(requireRelease(historical)).toMatchObject({ mode: "manual" });
  for (const conclusion of ["failure", "cancelled", "skipped", "unknown", "", "neutral"]) {
    const value = fixture();
    value.run.conclusion = conclusion;
    expect(() => requireRelease(value)).toThrow();
  }
  for (const [field, replacement] of [
    ["event", "pull_request"],
    ["head_branch", "feature"],
    ["head_sha", "b".repeat(40)],
    ["status", "queued"],
  ]) {
    const value = fixture();
    Object.assign(value.run, { [field as string]: replacement });
    expect(() => requireRelease(value)).toThrow();
  }
  const mutations: ((value: ReturnType<typeof fixture>) => void)[] = [
    (value) => {
      value.run.repository.full_name = "untrusted/fork";
    },
    (value) => {
      value.run.head_repository.full_name = "untrusted/fork";
    },
    (value) => {
      value.workflow.path = ".github/workflows/untrusted.yml";
    },
    (value) => {
      value.run.workflow_id++;
    },
    (value) => {
      value.revision = "main;id";
    },
    (value) => {
      value.ancestor = false;
    },
    (value) => {
      value.current = "b".repeat(40);
    },
    (value) => {
      value.artifacts = [];
    },
    (value) => {
      value.artifacts.push(...fixture().artifacts);
    },
    (value) => {
      value.artifacts = value.artifacts.map((artifact) => ({ ...artifact, expired: true }));
    },
    (value) => {
      value.run.run_attempt++;
    },
  ];
  for (const mutation of mutations) {
    const value = fixture();
    mutation(value);
    expect(() => requireRelease(value)).toThrow();
  }
  for (const field of ["name", "id", "size_in_bytes", "expired", "workflow_run"]) {
    const value = fixture();
    value.artifacts = value.artifacts.map((artifact) =>
      Object.assign(artifact, { [field]: undefined }),
    );
    expect(() => requireRelease(value)).toThrow();
  }
});
test("manifest is closed, bounded and bound to exact revision/run/attempt", () => {
  const selected = requireRelease(fixture());
  const manifest = {
    version: 1,
    revision,
    runId: 123,
    attempt: 2,
    bytes: 100,
    imageId: `sha256:${"b".repeat(64)}`,
    sha256: "c".repeat(64),
  };
  expect(validateManifest(manifest, selected)).toEqual(manifest);
  for (const patch of [
    { revision: "b".repeat(40) },
    { runId: 124 },
    { attempt: 1 },
    { bytes: 0 },
    { bytes: 900000000 },
    { bytes: 1.1 },
    { sha256: "bad" },
    { imageId: "tag" },
    { extra: true },
  ])
    expect(() => validateManifest({ ...manifest, ...patch }, selected)).toThrow();
});

test("independent recovery copy authenticates ciphertext before publishing plaintext and preserves existing outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc011-copy-"));
  const script = resolve("deploy/development/recovery-copy.mjs");
  const invoke = (args: string[], input?: Buffer) =>
    spawnSync(process.execPath, [script, ...args], { input, stdio: ["pipe", "pipe", "pipe"] })
      .status;
  const key = join(directory, "key");
  const encrypted = join(directory, "export.encrypted");
  const decrypted = join(directory, "restored.tar");
  const sentinel = Buffer.from("fictional SQL and evidence recovery sentinel");
  try {
    expect(invoke(["key", key])).toBe(0);
    expect(invoke(["seal", encrypted, key], sentinel)).toBe(0);
    expect(invoke(["open", encrypted, key, decrypted])).toBe(0);
    expect(await readFile(decrypted)).toEqual(sentinel);
    expect(invoke(["open", encrypted, key, decrypted])).toBe(1);
    expect(await readFile(decrypted)).toEqual(sentinel);
    const corrupted = await readFile(encrypted);
    corrupted[21] = (corrupted[21] ?? 0) ^ 1;
    await writeFile(encrypted, corrupted);
    const rejected = join(directory, "rejected");
    expect(invoke(["open", encrypted, key, rejected])).toBe(1);
    await expect(readFile(rejected)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
