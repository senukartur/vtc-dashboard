import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { open } from "node:fs/promises";

const evidenceNames = new Set([
  "notifications-acceptance-evidence.json",
  "notifications-acceptance-last.json",
  "rehearsal-core.json",
  "rehearsal-window.json",
  "rehearsal-recovery.json",
]);

const allScenarios = [1, 2, 3, 4, 5, 6, 7, 8, 9];
// Owner-approved split (VTC-072, 2026-11-04): CI runs the window as three parallel shards,
// each after its own core group. Shards keep the original ascending order (scenario 1 reads
// the whole feed, 4 relies on actor roles that 5 later changes) and are balanced by the
// hosted durations; together they cover every scenario exactly once.
export const windowShards = [
  [2, 3, 5],
  [4, 6, 9],
  [1, 7, 8],
];

export function validateEvidenceCollector(actual, expected) {
  if (
    !actual ||
    actual.Id !== expected.id ||
    !/^[a-f0-9]{64}$/.test(expected.id) ||
    actual.Name !== `/${expected.name}` ||
    actual.Image !== expected.imageId ||
    actual.Config?.Labels?.["vtc011.rehearsal"] !== expected.project ||
    actual.Config?.Labels?.["vtc011.evidence-attempt"] !== expected.attempt ||
    actual.HostConfig?.NetworkMode !== "none" ||
    actual.HostConfig?.ReadonlyRootfs !== true ||
    JSON.stringify(actual.HostConfig.CapDrop) !== JSON.stringify(["ALL"]) ||
    (actual.HostConfig.CapAdd?.length ?? 0) !== 0 ||
    !actual.HostConfig.SecurityOpt?.includes("no-new-privileges:true") ||
    actual.Mounts?.length !== 1 ||
    actual.Mounts[0].Type !== "volume" ||
    actual.Mounts[0].Name !== expected.volume ||
    actual.Mounts[0].Destination !== "/evidence" ||
    actual.Mounts[0].RW !== false
  )
    throw new Error("REHEARSAL_EVIDENCE_COLLECTOR_BINDING_INVALID");
}

export async function retainRehearsalEvidence(
  bytes,
  path,
  {
    requireWindow,
    scenarios = allScenarios,
    requiredGroups = [],
    sourceSha,
    sourceFingerprint,
    project,
    revision,
    volume,
    expectedImageId,
  },
) {
  if (bytes.length > 1024 * 1024) throw new Error("REHEARSAL_EVIDENCE_TOO_LARGE");
  const bundle = JSON.parse(bytes);
  if (
    bundle.version !== 1 ||
    !bundle.files ||
    typeof bundle.files !== "object" ||
    Array.isArray(bundle.files) ||
    Object.keys(bundle).sort().join(",") !== "digests,files,version,windowFenced" ||
    typeof bundle.windowFenced !== "boolean" ||
    !bundle.digests ||
    typeof bundle.digests !== "object" ||
    Array.isArray(bundle.digests) ||
    Object.keys(bundle.digests).sort().join(",") !== Object.keys(bundle.files).sort().join(",") ||
    Object.keys(bundle.files).some(
      (name) => !evidenceNames.has(name) || !/^[a-f0-9]{64}$/.test(bundle.digests[name]),
    )
  )
    throw new Error("REHEARSAL_EVIDENCE_SHAPE_INVALID");
  if (
    requiredGroups.some(
      (group) =>
        !["core", "window", "recovery"].includes(group) || !bundle.files[`rehearsal-${group}.json`],
    )
  )
    throw new Error("REHEARSAL_GROUP_EVIDENCE_MISSING");
  for (const group of requiredGroups) {
    const binding = bundle.files[`rehearsal-${group}.json`].binding;
    if (
      !binding ||
      Object.entries({ sourceSha, sourceFingerprint, project, revision, volume }).some(
        ([key, value]) => binding[key] !== value,
      )
    )
      throw new Error("REHEARSAL_GROUP_EVIDENCE_BINDING_INVALID");
  }
  if (
    requireWindow &&
    (bundle.windowFenced ||
      bundle.files["notifications-acceptance-last.json"]?.result !== "cleaned" ||
      bundle.files["notifications-acceptance-last.json"]?.scenario !== scenarios.at(-1) ||
      bundle.files["notifications-acceptance-last.json"]?.sharedGrantsUnchanged !== true ||
      bundle.files["notifications-acceptance-last.json"]?.sharedFilesUnchanged !== true ||
      bundle.files["notifications-acceptance-last.json"]?.evidenceSha256 !==
        bundle.digests["notifications-acceptance-evidence.json"] ||
      bundle.files["notifications-acceptance-evidence.json"]?.revision !== revision ||
      bundle.files["notifications-acceptance-evidence.json"]?.imageId !== expectedImageId ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        bundle.files["notifications-acceptance-evidence.json"]?.runId ?? "",
      ) ||
      bundle.files["notifications-acceptance-evidence.json"]?.fixture?.status !== "pass" ||
      bundle.files["notifications-acceptance-evidence.json"]?.fixture?.runId !==
        bundle.files["notifications-acceptance-evidence.json"]?.runId ||
      JSON.stringify(
        bundle.files["notifications-acceptance-evidence.json"]?.fixture?.scenarios?.map((row) => [
          row.ordinal,
          row.status,
        ]),
      ) !== JSON.stringify(scenarios.map((ordinal) => [ordinal, "pass"])))
  )
    throw new Error("REHEARSAL_WINDOW_EVIDENCE_MISSING");
  // The window receipt names the scenario list this leg was asked to run.
  if (
    requiredGroups.includes("window") &&
    JSON.stringify(bundle.files["rehearsal-window.json"].scenarios) !== JSON.stringify(scenarios)
  )
    throw new Error("REHEARSAL_GROUP_EVIDENCE_BINDING_INVALID");
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ sourceSha, sourceFingerprint, ...bundle }) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.keys(bundle.files).length;
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const boundedMs = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 7_200_000;

// Public window timing is rebuilt from fixed numeric fields of the private evidence; names,
// identifiers, samples and worker metrics never leave the runner. Partial evidence still
// yields the scenarios that passed, so a slow or failed window can be located.
export function rehearsalTiming(bundle) {
  const evidence = bundle?.files?.["notifications-acceptance-evidence.json"];
  const fixture = evidence?.fixture;
  if (!isoInstant.test(fixture?.startedUtc ?? "") || !Array.isArray(fixture.scenarios)) return null;
  const started = Date.parse(fixture.startedUtc);
  const scenarios = [];
  for (const row of fixture.scenarios.slice(0, 9)) {
    const offset = isoInstant.test(row?.startedUtc ?? "")
      ? Date.parse(row.startedUtc) - started
      : -1;
    // A window shard runs an ascending subset of 1..9, so ordinals must only strictly increase.
    const previous = scenarios.at(-1)?.ordinal ?? 0;
    if (
      !Number.isSafeInteger(row?.ordinal) ||
      row.ordinal <= previous ||
      row.ordinal > 9 ||
      !boundedMs(row?.durationMs) ||
      !boundedMs(offset)
    )
      return null;
    scenarios.push({ ordinal: row.ordinal, startOffsetMs: offset, durationMs: row.durationMs });
  }
  const ticks = Array.isArray(evidence.ticks) ? evidence.ticks.slice(0, 240) : [];
  let busySeconds = 0;
  for (const tick of ticks) {
    const busy = tick?.finishedUtc - tick?.startedUtc;
    if (Number.isSafeInteger(busy) && busy >= 0 && busy <= 120) busySeconds += busy;
  }
  return {
    event: "deployment_rehearsal_timing",
    scenarios,
    ticks: { count: ticks.length, busySeconds },
  };
}

export function rehearsalPlan(args) {
  if (Array.isArray(args) && args.length === 2 && args[0] === "--window-shard") {
    const match = /^([1-9])\/([1-9])$/.exec(typeof args[1] === "string" ? args[1] : "");
    if (
      !match ||
      Number(match[2]) !== windowShards.length ||
      Number(match[1]) > windowShards.length
    )
      throw new Error("REHEARSAL_MODE_INVALID");
    return {
      mode: "full",
      groups: ["core", "window"],
      requireWindow: true,
      fullCoverage: false,
      scenarios: windowShards[Number(match[1]) - 1],
    };
  }
  if (
    !Array.isArray(args) ||
    args.length > 1 ||
    (args.length === 1 && !["--manual-only", "--core-recovery"].includes(args[0]))
  )
    throw new Error("REHEARSAL_MODE_INVALID");
  const manual = args[0] === "--manual-only";
  return {
    mode: manual ? "manual-only" : "full",
    groups: manual ? ["core"] : args.length ? ["core", "recovery"] : ["core", "window", "recovery"],
    requireWindow: args.length === 0,
    fullCoverage: args.length === 0,
    scenarios: args.length ? [] : allScenarios,
  };
}

const errorCodes = new Set(["ENOENT", "EACCES", "EPERM", "EIO", "ETIMEDOUT"]);
const cleanupGraceMs = 1000;
const signals = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"]);

// Public metadata is constructed from fixed categories, never native messages or arguments.
export function runRehearsalChild(command, args, options) {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false,
      timer,
      escalationTimer,
      settlementTimer;
    let terminationRequested = false,
      escalationRequested = false,
      terminationError = false,
      unrefAttempted = false,
      unrefSucceeded = false;
    let child,
      spawned = false,
      errorCategory = null,
      deadlineExceeded = false;
    const finish = (code, signal, settledByClose) => {
      if (settled) return;
      settled = true;
      if (!settledByClose && child) {
        unrefAttempted = true;
        try {
          child.unref();
          unrefSucceeded = true;
        } catch {
          /* Unconfirmed client ownership remains explicit. */
        }
      }
      clearTimeout(timer);
      clearTimeout(escalationTimer);
      clearTimeout(settlementTimer);
      const portable = Number.isInteger(code) && code >= 0 && code <= 255;
      const category = deadlineExceeded
        ? "deadline"
        : errorCategory
          ? "spawn-error"
          : signal
            ? "signal-exit"
            : code === 0
              ? "completed"
              : "nonzero-exit";
      resolve({
        category,
        exitCode: category === "completed" ? 0 : portable && code !== 0 ? code : 1,
        nativeExitCode: Number.isSafeInteger(code) ? code : null,
        signal: signal ? (signals.has(signal) ? signal : "other") : null,
        errorCategory,
        deadlineExceeded,
        spawned,
        settledByClose,
        terminationRequested,
        escalationRequested,
        terminationError,
        cleanupGraceMs,
        unrefAttempted,
        unrefSucceeded,
        elapsedMs: Math.round(performance.now() - started),
        timeoutMs: options.timeout,
      });
    };
    try {
      child = (options.spawnChild ?? spawn)(command, args, {
        stdio: options.stdio,
        windowsHide: true,
      });
    } catch {
      errorCategory = "synchronous-spawn";
      finish(null, null, false);
      return;
    }
    function terminate(signal) {
      try {
        if (!child.kill(signal)) terminationError = true;
      } catch {
        terminationError = true;
      }
    }
    timer = setTimeout(() => {
      deadlineExceeded = true;
      terminationRequested = true;
      terminate("SIGTERM");
      if (settled) return;
      escalationTimer = setTimeout(() => {
        escalationRequested = true;
        terminate("SIGKILL");
        if (settled) return;
        // Releasing this client handle is not cancellation of Docker/server work.
        settlementTimer = setTimeout(() => finish(null, null, false), cleanupGraceMs);
      }, cleanupGraceMs);
    }, options.timeout);
    child.once("spawn", () => {
      spawned = true;
    });
    child.on("error", (error) => {
      if (settled) return;
      errorCategory = errorCodes.has(error?.code) ? error.code : "other";
      // Kill failures can emit repeatedly during escalation. Keep errors handled and
      // the log descriptor open until close or explicitly unconfirmed settlement.
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      finish(code, signal, true);
    });
  });
}
