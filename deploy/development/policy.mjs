export const repository = "senukartur/vtc-dashboard";
export const maxImageBytes = 800 * 1024 * 1024;
export const shaPattern = /^[a-f0-9]{40}$/;
export function requireRelease({ revision, run, workflow, artifacts, ancestor, current, mode }) {
  if (
    !shaPattern.test(revision) ||
    !["auto", "manual"].includes(mode) ||
    workflow?.path !== ".github/workflows/ci.yml" ||
    run?.repository?.full_name !== repository ||
    run?.head_repository?.full_name !== repository ||
    run?.workflow_id !== workflow?.id ||
    run?.event !== "push" ||
    run?.head_branch !== "main" ||
    run?.head_sha !== revision ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !Number.isSafeInteger(run?.id) ||
    run.id < 1 ||
    !Number.isSafeInteger(run?.run_attempt) ||
    run.run_attempt < 1 ||
    ancestor !== true ||
    (mode === "auto" && current !== revision)
  )
    throw new Error("RELEASE_INELIGIBLE");
  const expected = `development-${run.id}-${run.run_attempt}-${revision}`;
  if (!Array.isArray(artifacts) || artifacts.length !== 1) throw new Error("ARTIFACT_AMBIGUOUS");
  const artifact = artifacts[0];
  if (
    artifact.name !== expected ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.id < 1 ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifact.size_in_bytes > maxImageBytes + 1048576 ||
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== revision
  )
    throw new Error("ARTIFACT_INELIGIBLE");
  return { revision, runId: run.id, attempt: run.run_attempt, artifactId: artifact.id, mode };
}
export function validateManifest(value, selected) {
  if (
    !value ||
    Object.keys(value).sort().join() !== "attempt,bytes,imageId,revision,runId,sha256,version" ||
    value.version !== 1 ||
    value.revision !== selected.revision ||
    value.runId !== selected.runId ||
    value.attempt !== selected.attempt ||
    !/^sha256:[a-f0-9]{64}$/.test(value.imageId) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > maxImageBytes
  )
    throw new Error("MANIFEST_INVALID");
  return value;
}
