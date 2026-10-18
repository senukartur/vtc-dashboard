import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { repository, requireRelease, shaPattern } from "./policy.mjs";

// Run from trusted main. Neither PR artifacts nor artifact-provided code is executed.
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("GITHUB_LOOKUP_FAILED");
  return response.json();
}
try {
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== "refs/heads/main")
    throw new Error("CONTROL_REF_INVALID");
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const automatic = process.env.GITHUB_EVENT_NAME === "workflow_run";
  if (!automatic && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("EVENT_INVALID");
  const revision = automatic ? event.workflow_run?.head_sha : event.inputs?.revision;
  if (!shaPattern.test(revision ?? "")) throw new Error("REVISION_INVALID");
  const workflow = await api("actions/workflows/ci.yml");
  let run;
  if (automatic) {
    run = await api(`actions/runs/${event.workflow_run.id}`);
    if (run.run_attempt !== event.workflow_run.run_attempt) throw new Error("ATTEMPT_CHANGED");
  } else {
    const found = await api(
      `actions/workflows/${workflow.id}/runs?event=push&branch=main&head_sha=${revision}&per_page=100`,
    );
    const candidates = found.workflow_runs.filter(
      (value) =>
        value.head_sha === revision &&
        value.status === "completed" &&
        value.conclusion === "success",
    );
    if (!candidates.length) throw new Error("SUCCESSFUL_RUN_MISSING");
    run = await api(`actions/runs/${candidates[0].id}`);
  }
  const branch = await api("branches/main");
  const comparison = await api(`compare/${revision}...${branch.commit.sha}`);
  const listing = await api(`actions/runs/${run.id}/artifacts?per_page=100`);
  const name = `development-${run.id}-${run.run_attempt}-${revision}`;
  const selected = requireRelease({
    revision,
    run,
    workflow,
    artifacts: listing.artifacts.filter((value) => value.name === name),
    ancestor: ["ahead", "identical"].includes(comparison.status),
    current: branch.commit.sha,
    mode: automatic ? "auto" : "manual",
  });
  await mkdir(".local/deploy", { recursive: true });
  await writeFile(".local/deploy/selected.json", JSON.stringify(selected), { mode: 0o600 });
  await appendFile(process.env.GITHUB_OUTPUT, `selected=${JSON.stringify(selected)}\n`);
  console.log(`Release eligible: ${revision}`);
} catch {
  console.error("Release eligibility: rejected");
  process.exitCode = 1;
}
