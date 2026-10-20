import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
let run = process.argv[3];
const docker = (allocation, args) =>
  execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      `vtc018-live-${allocation.run}`,
      "--env-file",
      resolve(allocation.directory, "stack.env"),
      "-f",
      resolve(root, "deploy/external-identities-live/compose.yaml"),
      ...args,
    ],
    {
      cwd: root,
      stdio: "pipe",
      timeout: 300000,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("LIVE_")),
      ),
    },
  );
try {
  if (mode === "start") {
    if (process.argv.length > 4 || (run && !/^\d{4,5}$/.test(run))) throw new Error();
    const port = Number(run ?? "4188");
    if (port < 1024 || port > 65535) throw new Error();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    if (status || !/^[a-f0-9]{40}$/.test(sha)) throw new Error();
    run = randomBytes(8).toString("hex");
    const directory = resolve(root, ".local/external-live", run);
    await mkdir(directory, { recursive: true });
    const allocation = { run, directory, port, sha, owner: "vtc018-local-live" };
    await writeFile(resolve(directory, "allocation.json"), JSON.stringify(allocation), {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      resolve(directory, "stack.env"),
      `LIVE_RUN=${run}\nLIVE_SHA=${sha}\nLIVE_PORT=${port}\nLIVE_ROOT_PASSWORD=${randomBytes(32).toString("hex")}\nLIVE_DB_PASSWORD=${randomBytes(32).toString("hex")}\nLIVE_IDENTITY_SECRET=${randomBytes(32).toString("hex")}\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Owned local check: ${run}`);
    docker(allocation, ["up", "--build", "--detach"]);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/live/result`, {
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && (await response.json()).candidate === sha;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error();
    console.log(`Open http://127.0.0.1:${port}/live/start and personally authenticate at Steam.`);
    console.log(`Result: node scripts/external-identities-live.mjs status ${run}`);
    console.log(`Cleanup: node scripts/external-identities-live.mjs stop ${run}`);
  } else if (
    ["status", "stop"].includes(mode ?? "") &&
    run &&
    /^[a-f0-9]{16}$/.test(run) &&
    process.argv.length === 4
  ) {
    const directory = resolve(root, ".local/external-live", run);
    const allocation = JSON.parse(await readFile(resolve(directory, "allocation.json"), "utf8"));
    if (
      allocation.owner !== "vtc018-local-live" ||
      allocation.run !== run ||
      allocation.directory !== directory ||
      !Number.isInteger(allocation.port) ||
      allocation.port < 1024 ||
      allocation.port > 65535
    )
      throw new Error();
    if (mode === "status") {
      const result = await (
        await fetch(`http://127.0.0.1:${allocation.port}/live/result`, {
          signal: AbortSignal.timeout(3000),
        })
      ).json();
      if (
        result.candidate !== allocation.sha ||
        !["pending", "completed"].includes(result.state) ||
        ["verified", "passwordLogin", "replayRejected"].some(
          (name) => typeof result[name] !== "boolean",
        ) ||
        !["not_checked", "available", "stale", "unavailable", "not_linked"].includes(
          result.truckersStatus,
        )
      )
        throw new Error();
      console.log(
        JSON.stringify({
          candidate: allocation.sha,
          state: result.state,
          verified: result.verified,
          passwordLogin: result.passwordLogin,
          replayRejected: result.replayRejected,
          truckersStatus: result.truckersStatus,
        }),
      );
    } else {
      docker(allocation, ["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
      await rm(resolve(directory, "stack.env"));
      await rm(resolve(directory, "allocation.json"));
      await rmdir(directory);
      console.log("LOCAL_STEAM_CHECK_OWNED_ALLOCATION_REMOVED");
    }
  } else throw new Error();
} catch {
  console.error(
    `LOCAL_STEAM_CHECK_OPERATION_FAILED${run && /^[a-f0-9]{16}$/.test(run) ? `; retained owned allocation ${run}; use stop to remove it` : ""}`,
  );
  process.exitCode = 1;
}
