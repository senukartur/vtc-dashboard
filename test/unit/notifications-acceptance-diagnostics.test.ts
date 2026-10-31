import { expect, test } from "vitest";
import {
  acceptanceDeadlineRemaining,
  acceptanceDiagnostic,
  acceptanceWorkerScope,
  acceptanceSentinelMatches,
  acceptanceWorkerPhase,
  acceptanceTeardown,
} from "../../apps/api/src/notifications-acceptance-diagnostics.ts";

test("scenario seven shared deadlines and checkpoints preserve bounded closed observations", () => {
  const deadline = 1000;
  expect(acceptanceDeadlineRemaining(deadline, 100)).toBe(900);
  expect(acceptanceDeadlineRemaining(deadline, 999)).toBe(1);
  for (const now of [deadline, deadline + 1, Infinity, NaN])
    expect(() => acceptanceDeadlineRemaining(deadline, now)).toThrow();
  for (const invalid of [Infinity, -Infinity, NaN])
    expect(() => acceptanceDeadlineRemaining(invalid, 100)).toThrow();
  expect(() => acceptanceDeadlineRemaining(Number.MAX_VALUE, -Number.MAX_VALUE)).toThrow();
  // A read that first became ready after the same deadline may never turn expiry into success.
  expect(() => {
    acceptanceDeadlineRemaining(deadline, 999);
    const ready = true;
    acceptanceDeadlineRemaining(deadline, 1001);
    return ready;
  }).toThrow("ACCEPTANCE_WAIT_EXPIRED");
  const steps = [
    "backlog_seed",
    "backlog_context",
    "backlog_late_append",
    "backlog_witness_publish",
    "backlog_advance",
    "backlog_late_commit",
    "backlog_advance_confirm",
    "backlog_late_effect",
    "backlog_scan_lap",
    "backlog_poll_request",
    "backlog_poll_status",
    "backlog_poll_cursor",
    "backlog_poll_limit",
    "backlog_delivery",
    "backlog_unique",
    "backlog_offline",
  ];
  const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), {
    code: "ERR_ASSERTION",
    actual: { cursor: "SYNTHETIC_PRIVATE_CURSOR" },
    expected: { cookie: "SYNTHETIC_PRIVATE_COOKIE" },
  });
  for (const step of steps) {
    expect(acceptanceDiagnostic(failure, step)).toEqual({
      category: "assertion",
      step,
      nativeErrno: null,
      sqlOperation: "unknown",
      sqlTables: [],
      lockingMode: "unknown",
      deniedTable: null,
    });
    expect(acceptanceWorkerPhase(true, step)).toBeNull();
  }
  for (const step of ["backlog_private_cookie", "backlog_" + "SYNTHETIC_PRIVATE_CURSOR"])
    expect(acceptanceDiagnostic(failure, step).step).toBe("unknown");
  expect(JSON.stringify(steps.map((step) => acceptanceDiagnostic(failure, step)))).not.toContain(
    "SYNTHETIC_PRIVATE",
  );
});

test("teardown preserves a primary failure and separately classifies its secondary failure", async () => {
  const primary = new Error("private primary scenario detail"),
    secondary = new Error("private logout cookie");
  let captured: unknown;
  await expect(
    (async () => {
      try {
        throw primary;
      } finally {
        captured = (
          await acceptanceTeardown(async () => {
            throw secondary;
          }, true)
        )?.error;
      }
    })(),
  ).rejects.toBe(primary);
  expect(captured).toBe(secondary);
  const diagnostic = acceptanceDiagnostic(captured, "scenario_teardown");
  expect(diagnostic.step).toBe("scenario_teardown");
  expect(JSON.stringify(diagnostic)).not.toContain("private");
  await expect(
    acceptanceTeardown(async () => {
      throw secondary;
    }, false),
  ).rejects.toBe(secondary);
  await expect(acceptanceTeardown(async () => {}, false)).resolves.toBeNull();
});

test("normal workers emit no acceptance phases and synthetic phases are closed", () => {
  expect(acceptanceWorkerPhase(false, "jobs_pass")).toBeNull();
  expect(acceptanceWorkerPhase(true, "jobs_pass")).toEqual({
    event: "jobs_acceptance_phase",
    phase: "jobs_pass",
  });
  for (const value of ["private account", "jobs_private_cookie", "scenario", "source_store"])
    expect(acceptanceWorkerPhase(true, value)).toBeNull();
});

test("interruption assertion diagnostics preserve only closed substages", () => {
  for (const step of [
    "interrupt_lock",
    "interrupt_ack",
    "interrupt_drain",
    "interrupt_binding",
    "interrupt_recovery",
    "interrupt_attempts",
    "interrupt_effects",
    "interrupt_duplicates",
  ]) {
    const error = Object.assign(new Error("private assertion values"), {
      code: "ERR_ASSERTION",
      actual: "private cookie",
      expected: "private account",
    });
    const result = acceptanceDiagnostic(error, step);
    expect(result.category).toBe("assertion");
    expect(result.step).toBe(step);
    expect(JSON.stringify(result)).not.toContain("private");
  }
  expect(acceptanceDiagnostic(new Error("private body"), "interrupt_private_account").step).toBe(
    "unknown",
  );
});

test("worker diagnostics require exact synthetic run/schema/account/build and root sentinel image", () => {
  const runId = "12345678-1234-4123-8123-123456789abc",
    suffix = runId.replaceAll("-", "").slice(0, 16),
    revision = "a".repeat(40),
    imageId = "sha256:" + "b".repeat(64);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    VTC_NOTIFICATIONS_ACCEPTANCE: "synthetic-only",
    VTC_NOTIFICATIONS_ACCEPTANCE_RUN: runId,
    VTC_NOTIFICATIONS_ACCEPTANCE_REVISION: revision,
    VTC_REVISION: revision,
    VTC_NOTIFICATIONS_ACCEPTANCE_IMAGE_ID: imageId,
    MYSQL_HOST: "db",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: `vtc_na_${suffix}`,
    MYSQL_USER: `vtc_nw_${suffix}`,
  };
  const scope = acceptanceWorkerScope(env);
  expect(scope).toEqual({ runId, revision, imageId });
  if (!scope) throw Error("fixture scope missing");
  expect(acceptanceSentinelMatches(scope, { run_id: runId, revision, image_id: imageId })).toBe(
    true,
  );
  for (const value of [
    null,
    {},
    { run_id: runId, revision, image_id: "sha256:" + "c".repeat(64) },
    { run_id: "foreign", revision, image_id: imageId },
    { run_id: runId, revision: "d".repeat(40), image_id: imageId },
  ])
    expect(acceptanceSentinelMatches(scope, value)).toBe(false);
  for (const [key, value] of Object.entries({
    NODE_ENV: "test",
    VTC_NOTIFICATIONS_ACCEPTANCE: "",
    VTC_NOTIFICATIONS_ACCEPTANCE_RUN: "foreign",
    VTC_REVISION: "c".repeat(40),
    VTC_NOTIFICATIONS_ACCEPTANCE_IMAGE_ID: "unknown",
    MYSQL_USER: "ordinary_worker",
    MYSQL_DATABASE: "ordinary_company",
    MYSQL_HOST: "external.invalid",
    MYSQL_PORT: "3307",
  }))
    expect(acceptanceWorkerScope({ ...env, [key]: value })).toBeNull();
  expect(acceptanceWorkerScope({})).toBeNull();
});

test("closed worker errors never emit configuration or primary/secondary error bodies", () => {
  const result = acceptanceDiagnostic(
    {
      query: "DELETE FROM catalog_commands WHERE expires_at<=?",
      params: ["private_value"],
      cause: {
        errno: 1142,
        sqlMessage:
          "DELETE command denied to user 'private_account'@'private_host' for table 'catalog_commands'",
      },
      config: { MYSQL_PASSWORD: "private_password" },
      message: "private_primary",
      body: "private_secondary",
    },
    "jobs_catalog_cleanup",
  );
  expect(result.step).toBe("jobs_catalog_cleanup");
  expect(result.deniedTable).toBe("catalog_commands");
  for (const value of [
    "private_value",
    "private_account",
    "private_host",
    "private_password",
    "private_primary",
    "private_secondary",
  ])
    expect(JSON.stringify(result)).not.toContain(value);
});

test("denied immutable read exposes only registered operation/table/lock and facade categories", () => {
  const diagnostic = acceptanceDiagnostic(
    {
      query:
        "select * from `private_schema_value`.`qualification_rule_versions` where reason=? for update",
      params: ["private reason"],
      cause: {
        errno: 1142,
        sqlMessage:
          "SELECT command denied to user 'private_account'@'private_host' for table 'qualification_rule_versions'",
      },
    },
    "source_store",
  );
  expect(diagnostic).toEqual({
    category: "database",
    step: "source_store",
    nativeErrno: 1142,
    sqlOperation: "select",
    sqlTables: ["qualification_rule_versions"],
    lockingMode: "for_update",
    deniedTable: "qualification_rule_versions",
  });
  for (const forbidden of [
    "private_schema_value",
    "private reason",
    "private_account",
    "private_host",
    "select *",
  ])
    expect(JSON.stringify(diagnostic)).not.toContain(forbidden);
});

test("SQL values, comments and unknown identifiers cannot become emitted context", () => {
  const secrets = [
    "private_password",
    "private_cookie",
    "private_email@example.invalid",
    "private_database",
    "private_table",
  ];
  const query = `select 'FROM identity_accounts FOR UPDATE private_password', "JOIN qualification_rules private_cookie", 'private_email@example.invalid' from private_database.private_table /* FOR SHARE JOIN identity_users */ -- FOR UPDATE`;
  const diagnostic = acceptanceDiagnostic(
    {
      query,
      params: secrets,
      message: secrets.join(" "),
      body: secrets,
      cause: {
        errno: 1142,
        sqlMessage:
          "SELECT command denied to user 'private_account'@'private_host' for table 'private_table'",
      },
    },
    "private_cookie",
  );
  expect(diagnostic.sqlTables).toEqual([]);
  expect(diagnostic.lockingMode).toBe("none");
  expect(diagnostic.step).toBe("unknown");
  expect(diagnostic.deniedTable).toBeNull();
  for (const secret of [...secrets, "private_account", "private_host"])
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
});

test("prepared values with escaped and doubled quotes do not poison a real shared lock", () => {
  const diagnostic = acceptanceDiagnostic(
    {
      sql: "select * from `trip_facts` where nickname='private \\' FOR UPDATE' and reason='private '' JOIN identity_users' for share",
      cause: { errno: 1143, sqlMessage: "SELECT command denied for table 'trip_facts'" },
    },
    "scenario",
  );
  expect(diagnostic.sqlTables).toEqual(["trip_facts"]);
  expect(diagnostic.lockingMode).toBe("for_share");
  expect(diagnostic.deniedTable).toBe("trip_facts");
});

test("unknown oversized and cyclic errors remain bounded closed categories", () => {
  const error: Record<string, unknown> = {
    query: "private_blob".repeat(10000),
    errno: 999999999,
    message: "private_body",
  };
  error.cause = error;
  expect(acceptanceDiagnostic(error, "private_callsite")).toEqual({
    category: "operation",
    step: "unknown",
    nativeErrno: null,
    sqlOperation: "unknown",
    sqlTables: [],
    lockingMode: "unknown",
    deniedTable: null,
  });
  expect(
    acceptanceDiagnostic({ code: "ERR_ASSERTION", message: "private_body" }, "scenario").category,
  ).toBe("assertion");
});
