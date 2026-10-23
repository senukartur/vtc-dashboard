import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, dedicatedConnection } from "@vtc/db";
import { type Connection, createConnection } from "mysql2/promise";
import { SCHEMA_SETUP_TIMEOUT_MS } from "../test/persistence/support.ts";
import {
  cleanupAllocation,
  type OwnedAllocation,
  SCHEMA_DROP_QUERY_TIMEOUT_MS,
} from "../test/support/allocation-cleanup.ts";
import {
  assertScreenshotsRetained,
  screenshotInventory,
} from "../test/support/browser-artifacts.ts";
import { browserFailureProof } from "../test/support/browser-failure-proof.ts";
import { bounded } from "../test/support/concurrency.ts";
import { type Allocation, safeChildEnvironment } from "../test/support/environment.ts";
import { isDeliberateFailure, probeIdentity } from "../test/support/failure-proof.ts";
import { browserFailureLine, browserPreparationLine } from "./browser-diagnostics.mjs";
import { eventLine } from "./ci-result.mjs";
import { runTestProcess } from "./test-process.mjs";

const lanes = ["unit", "contracts", "integration", "persistence", "recovery", "e2e"];
const lane = process.argv[2];
if (!lane || ![...lanes, "all", "failure-reporting"].includes(lane))
  throw new Error("INVALID_TEST_LANE");
const cli = (name: string) => resolve(`node_modules/${name}`);
let active: ReturnType<typeof spawn> | undefined;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    interrupted = true;
    active?.kill(signal);
  });

async function child(args: string[], env: NodeJS.ProcessEnv, capture = false) {
  let output = "";
  const code = await new Promise<number>((accept, reject) => {
    active = spawn(process.execPath, args, {
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (capture)
      for (const stream of [active.stdout, active.stderr])
        stream?.on("data", (chunk) => {
          output = (output + String(chunk)).slice(-200000);
        });
    active.once("error", reject);
    active.once("exit", (status) => accept(status ?? 1));
  });
  return { code, output };
}

async function execute(name: string, probe = false, capture = false, guardFailure = false) {
  const started = Date.now();
  const env: NodeJS.ProcessEnv = {
    ...safeChildEnvironment(),
    VTC_TEST_LANE: name,
    ...(probe ? { VTC_FAILURE_PROBE: "assertion" } : {}),
  };
  const databaseLane = ["integration", "persistence", "recovery", "e2e"].includes(name);
  let cleanup = async () => {};
  if (databaseLane) cleanup = await allocate(name, env);
  try {
    if (guardFailure) {
      const path = env.VTC_TEST_CONFIG ?? "";
      const allocation = JSON.parse(await readFile(path, "utf8")) as Allocation;
      allocation.ownerConnectionId += 1;
      await writeFile(path, JSON.stringify(allocation));
    }
    const args = ["unit", "contracts", "integration"].includes(name)
      ? [cli("vitest/vitest.mjs"), "run", "--config", "vitest.config.ts"]
      : name === "e2e"
        ? [cli("@playwright/test/cli.js"), "test", "--config", "playwright.config.ts"]
        : [
            "--import",
            "tsx",
            "--test",
            `test/persistence/${name === "persistence" ? "persistence" : "recovery"}.test.ts`,
          ];
    let prepared = true;
    if (name === "e2e") {
      const setupStarted = Date.now();
      const setup = await runTestProcess(
        process.execPath,
        ["--import", "tsx", "test/e2e/support/prepare.ts"],
        {
          cwd: process.cwd(),
          env,
          // Fresh browser schema/credentials share the expanded schema fixture allowance.
          // This outer child budget is separate from real server readiness and SQL bounds.
          cleanup: true,
          timeout: SCHEMA_SETUP_TIMEOUT_MS,
          onSpawn: (process) => {
            active = process;
          },
        },
      );
      prepared = setup.exitCode === 0 && !interrupted;
      const durationMs = Date.now() - setupStarted;
      console.log(
        browserPreparationLine({
          kind: "wrapper",
          state: prepared ? "success" : "failed",
          category: setup.category,
          configuredTimeoutMs: SCHEMA_SETUP_TIMEOUT_MS,
          durationMs,
        }),
      );
      console.log(
        `BROWSER fixture preparation: ${prepared ? "PASS" : "FAIL"} (${setup.category}, ${durationMs}ms)`,
      );
    }
    const result = prepared
      ? await child(args, env, capture)
      : { code: 1, output: "SYNTHETIC_BROWSER_FIXTURE_SETUP_FAILED" };
    if (!capture) console.log(`LANE ${name}: ${result.code === 0 ? "PASS" : "FAIL"}`);
    if (!probe) console.log(eventLine(name, result.code, Date.now() - started));
    return result;
  } finally {
    await cleanup();
  }
}

async function allocate(name: string, env: NodeJS.ProcessEnv) {
  const run = process.env.VTC_TEST_RUN;
  const password = process.env.VTC_TEST_ROOT_PASSWORD;
  if (
    process.env.VTC_TEST_LAUNCH !== "isolated-compose" ||
    !run ||
    !/^[a-f0-9]{16}$/.test(run) ||
    !password ||
    !/^[a-f0-9]{64}$/.test(password)
  )
    throw new Error("ISOLATED_TEST_LAUNCH_REQUIRED");
  const database = `vtc_test_${run}_${name}`;
  const user = `t_${randomBytes(8).toString("hex")}`;
  const settings = {
    host: "db",
    port: 3306,
    database,
    user,
    password: randomBytes(32).toString("hex"),
  };
  // Only this provisioner receives disposable admin credentials. Children receive one schema grant.
  const admin = await createConnection({
    host: "db",
    user: "root",
    password,
    connectTimeout: 1000,
  });
  let lock: Awaited<ReturnType<typeof dedicatedConnection>> | undefined;
  const path = resolve(`.local/testing/${run}-${name}.json`);
  const owned: OwnedAllocation = { schema: false, user: false, file: false };
  const cleanup = () =>
    cleanupAllocation(
      owned,
      {
        lock: async () => {
          if (lock) destroyTransport(lock);
        },
        schema: async () => {
          await admin.query({
            sql: `DROP DATABASE \`${database}\``,
            timeout: SCHEMA_DROP_QUERY_TIMEOUT_MS,
          });
        },
        user: async () => {
          await admin.query({ sql: "DROP USER ?@'%'", values: [user], timeout: 2000 });
        },
        file: () => rm(path, { force: true }),
        userAbsence: async () => {
          const [rows] = await admin.query({
            sql: "SELECT COUNT(*) AS count FROM mysql.user WHERE User = ? AND Host = ?",
            values: [user, "%"],
            timeout: 2000,
          });
          const count = (rows as { count: unknown }[])[0]?.count;
          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            !(
              (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) ||
              (typeof count === "string" && /^[0-9]+$/.test(count))
            )
          )
            throw new Error("TEST_OWNED_USER_ABSENCE_INVALID_RESULT");
          return count === 0 || count === "0";
        },
        admin: () => admin.end(),
        destroyAdmin: () => destroyTransport(admin),
      },
      (diagnostic) => {
        const allocation = [
          "integration",
          "persistence",
          "recovery",
          "e2e",
          "isolationa",
          "isolationb",
          "wrongbaseline",
        ].includes(name)
          ? name
          : "unknown";
        console.log(JSON.stringify({ ...diagnostic, allocation }));
      },
    );
  let phase = "baseline";
  try {
    // Fail closed on baseline drift BEFORE creating/resetting any schema.
    const baseline = createDatabase({ ...settings, database: "mysql", user: "root", password });
    try {
      if (!(await baseline.check())) throw new Error("TEST_DATABASE_BASELINE_MISMATCH");
    } finally {
      await baseline.close();
    }
    phase = "schema";
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    owned.schema = true;
    phase = "user";
    await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [user, settings.password]);
    owned.user = true;
    // Escape underscores in the database grant: MySQL otherwise treats them as wildcards.
    phase = "grant";
    await admin.query(`GRANT ALL ON \`${database.replaceAll("_", "\\_")}\`.* TO ?@'%'`, [user]);
    phase = "lock_connection";
    lock = await dedicatedConnection(settings);
    phase = "lock_query";
    const [rows] = await lock.query("SELECT GET_LOCK(?, 0) AS acquired, CONNECTION_ID() AS owner", [
      `vtc008:${database}`,
    ]);
    phase = "lock_assertion";
    if (Number((rows as { acquired: number }[])[0]?.acquired) !== 1)
      throw new Error("TEST_SCHEMA_ALREADY_OWNED");
    phase = "configuration";
    await mkdir(resolve(".local/testing"), { recursive: true });
    const file = await open(path, "wx", 0o600);
    owned.file = true;
    try {
      await file.writeFile(
        JSON.stringify({
          run,
          lane: name,
          token: randomBytes(16).toString("hex"),
          ownerConnectionId: Number((rows as { owner: number }[])[0]?.owner),
          settings,
        }),
      );
    } finally {
      await bounded(file.close(), "allocation_file_close");
    }
    Object.assign(env, {
      MYSQL_HOST: settings.host,
      MYSQL_PORT: "3306",
      MYSQL_DATABASE: database,
      MYSQL_USER: user,
      MYSQL_PASSWORD: settings.password,
      DB_TEST_RESET_ACK: "synthetic-only",
      VTC_TEST_CONFIG: path,
    });
  } catch (error) {
    const failures = await cleanup();
    const category =
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_PARSE_ERROR"].includes(
        String(error.code),
      )
        ? `_${String(error.code)}`
        : "";
    throw new Error(
      `TEST_DATABASE_ALLOCATION_FAILED_${phase.toUpperCase()}${category}${failures.length ? `_CLEANUP_${failures.join("_")}` : ""}`,
    );
  }
  return async () => {
    const failures = await cleanup();
    if (failures.length) throw new Error(`TEST_ALLOCATION_CLEANUP_FAILED_${failures.join("_")}`);
  };
}

function destroyTransport(connection: Connection) {
  try {
    connection.destroy();
  } finally {
    (
      connection as unknown as { connection: { stream: { destroy(): void } } }
    ).connection.stream.destroy();
  }
}

async function proveFailures() {
  for (const name of ["unit", "contracts", "integration", "e2e"]) {
    const captures = name === "e2e" ? await screenshotInventory() : undefined;
    if (captures && lane === "all" && captures.size === 0)
      throw new Error("BROWSER_CAPTURE_BASELINE_MISSING");
    const result = await execute(name, true, true);
    if (captures) await assertScreenshotsRetained(captures);
    const identity = probeIdentity(name);
    if (!isDeliberateFailure(name, result))
      throw new Error(`FAILURE_PROBE_INVALID_${name.toUpperCase()}`);
    if (name === "e2e") browserFailureProof(result.output);
    console.log(`PROBE ${identity}: identified assertion, exit 1 (expected)`);
  }
  const guarded = await execute("integration", true, true, true);
  if (
    guarded.code !== 1 ||
    !guarded.output.includes(probeIdentity("integration")) ||
    !guarded.output.includes("launcher must hold this allocation's suite ownership lock") ||
    isDeliberateFailure("integration", guarded)
  )
    throw new Error("FAILURE_PROBE_GUARD_NEGATIVE_INVALID");
  console.log(
    "PROBE integration guard assertion: rejected as deliberate-proof evidence (expected)",
  );
  const browserGuard = await execute("e2e", true, true, true);
  if (
    browserGuard.code !== 1 ||
    browserGuard.output !== "SYNTHETIC_BROWSER_FIXTURE_SETUP_FAILED" ||
    isDeliberateFailure("e2e", browserGuard)
  )
    throw new Error("FAILURE_PROBE_BROWSER_SETUP_GUARD_INVALID");
  console.log("PROBE browser setup ownership: refused before browser execution (expected)");
  const result = await child(
    ["--import", "tsx", "scripts/test-lanes.ts", "all", "--assertion-probe"],
    safeChildEnvironment(),
    true,
  );
  if (
    !isDeliberateFailure("unit", result) ||
    !result.output.includes("AGGREGATE child unit failed")
  )
    throw new Error("AGGREGATE_FAILURE_PROBE_INVALID");
  console.log("PROBE aggregate: identified unit assertion propagated, exit 1 (expected)");
}

async function proveIsolation() {
  const a: NodeJS.ProcessEnv = {};
  const b: NodeJS.ProcessEnv = {};
  const disposeA = await allocate("isolationa", a);
  let disposeB = async () => {};
  try {
    disposeB = await allocate("isolationb", b);
    const clients: Connection[] = [];
    try {
      for (const env of [a, b]) {
        const allocation = JSON.parse(
          await readFile(env.VTC_TEST_CONFIG ?? "", "utf8"),
        ) as Allocation;
        clients.push(await dedicatedConnection(allocation.settings));
      }
      const [left, right] = clients;
      if (!left || !right) throw new Error("ISOLATION_CONNECTION_MISSING");
      await left.query("CREATE TABLE synthetic_sentinel (value INT)");
      await left.query("INSERT INTO synthetic_sentinel VALUES (1)");
      await right.query("CREATE TABLE synthetic_sentinel (value INT)");
      await right.query("INSERT INTO synthetic_sentinel VALUES (2)");
      for (const [client, other] of [
        [left, b.MYSQL_DATABASE],
        [right, a.MYSQL_DATABASE],
      ] as const) {
        let rejected = false;
        try {
          await client.query(`SELECT value FROM \`${other}\`.synthetic_sentinel`);
        } catch (error) {
          rejected =
            !!error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ER_TABLEACCESS_DENIED_ERROR";
        }
        if (!rejected) throw new Error("TEST_ALLOCATION_ISOLATION_FAILED");
      }
      let collisionRejected = false;
      const priorConfiguration = await readFile(a.VTC_TEST_CONFIG ?? "", "utf8");
      try {
        await allocate("isolationa", {});
      } catch {
        collisionRejected = true;
      }
      if (!collisionRejected) throw new Error("TEST_ALLOCATION_COLLISION_ACCEPTED");
      if ((await readFile(a.VTC_TEST_CONFIG ?? "", "utf8")) !== priorConfiguration)
        throw new Error("TEST_ALLOCATION_COLLISION_CHANGED_FILE");
      const [rows] = await left.query("SELECT value FROM synthetic_sentinel");
      if ((rows as { value: number }[])[0]?.value !== 1)
        throw new Error("TEST_ALLOCATION_SENTINEL_CHANGED");
      const admin = await createConnection({
        host: "db",
        user: "root",
        password: process.env.VTC_TEST_ROOT_PASSWORD ?? "",
        connectTimeout: 1000,
      });
      try {
        let refused = false;
        try {
          await admin.query("SET GLOBAL time_zone = '+01:00'");
          try {
            await allocate("wrongbaseline", {});
          } catch {
            refused = true;
          }
        } finally {
          await admin.query("SET GLOBAL time_zone = '+00:00'");
        }
        if (!refused) throw new Error("TEST_WRONG_BASELINE_ACCEPTED");
        const [schemas] = await admin.query(
          "SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
          [`vtc_test_${process.env.VTC_TEST_RUN}_wrongbaseline`],
        );
        if (Number((schemas as { count: number }[])[0]?.count) !== 0)
          throw new Error("TEST_WRONG_BASELINE_MUTATED_SCHEMA");
        const [baseline] = await left.query(
          "SELECT VERSION() AS version, @@global.time_zone AS serverUtc, @@session.time_zone AS sessionUtc, @@session.transaction_isolation AS isolationLevel, @@session.sql_mode AS modes, @@collation_database AS collationName",
        );
        console.log(`BASELINE ${JSON.stringify(baseline)}`);
        console.log("SAFETY: actual wrong-server-timezone rejected before schema creation PASS");
      } finally {
        await admin.end();
      }
      console.log(
        "ISOLATION: distinct schema sentinels, cross-grant denial and occupied allocation rejection PASS",
      );
    } finally {
      for (const client of clients) {
        client.destroy();
        (
          client as unknown as { connection: { stream: { destroy(): void } } }
        ).connection.stream.destroy();
      }
    }
  } finally {
    await disposeAllocations([disposeB, disposeA]);
  }
}

async function disposeAllocations(disposers: (() => Promise<void>)[]) {
  const cleanup = await Promise.allSettled(disposers.map((dispose) => dispose()));
  const failure = cleanup.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

try {
  if (process.env.VTC_TEST_PROBE === "assertion") {
    if (!["unit", "integration", "e2e"].includes(lane)) throw new Error("INVALID_TEST_LANE");
    const started = Date.now();
    const result = await execute(lane, true, true);
    if (!isDeliberateFailure(lane, result)) throw new Error("FAILURE_PROBE_INVALID");
    if (lane === "e2e")
      for (const failure of browserFailureProof(result.output))
        console.log(browserFailureLine(failure));
    console.log(eventLine(lane, 1, Date.now() - started));
    process.exitCode = 1;
  } else if (lane === "failure-reporting") await proveFailures();
  else if (lane === "all") {
    if (!process.argv.includes("--assertion-probe")) {
      const started = Date.now();
      await proveIsolation();
      console.log(eventLine("isolation", 0, Date.now() - started));
    }
    for (const name of lanes) {
      const result = await execute(
        name,
        process.argv.includes("--assertion-probe") && name === "unit",
      );
      if (result.code !== 0 || interrupted) {
        console.log(`AGGREGATE child ${name} failed`);
        process.exitCode = result.code || 1;
        break;
      }
    }
    if (!process.exitCode) {
      const started = Date.now();
      await proveFailures();
      console.log(eventLine("failure-reporting", 0, Date.now() - started));
    }
  } else process.exitCode = (await execute(lane)).code;
} catch (error) {
  console.error(
    error instanceof Error &&
      /^(?:TEST_|ISOLATED_|FAILURE_PROBE_|AGGREGATE_)[A-Z_]+$/.test(error.message)
      ? error.message
      : "TEST_LANE_FAILED: inspect test identity/status; private database diagnostics suppressed",
  );
  process.exitCode = 1;
}
if (interrupted) process.exitCode = 130;
