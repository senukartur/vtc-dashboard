import assert from "node:assert/strict";

// Public schema identifiers are diagnostic enums, never SQL input or an authorization allowlist.
const tables = [
  "_vtc_migrations",
  "admissions_applications",
  "admissions_command_results",
  "admissions_decisions",
  "admissions_invitations",
  "admissions_limits",
  "audit_entries",
  "catalog_aliases",
  "catalog_artifacts",
  "catalog_changes",
  "catalog_commands",
  "catalog_coverage",
  "catalog_entities",
  "catalog_facts",
  "catalog_mapping_issues",
  "catalog_mapping_reviews",
  "catalog_mappings",
  "catalog_operations",
  "catalog_publications",
  "catalog_relations",
  "catalog_revisions",
  "durable_jobs",
  "event_attendance_revisions",
  "event_attendances",
  "event_catalog_pins",
  "event_commands",
  "event_response_revisions",
  "event_responses",
  "event_revisions",
  "events",
  "external_steam_accounts",
  "external_steam_changes",
  "external_steam_links",
  "external_steam_nonces",
  "external_steam_proofs",
  "external_truckers_cache",
  "identity_accounts",
  "identity_challenges",
  "identity_command_results",
  "identity_company",
  "identity_limits",
  "identity_memberships",
  "identity_roles",
  "identity_sessions",
  "identity_users",
  "identity_verifications",
  "job_effect_receipts",
  "job_runner_leases",
  "mail_commands",
  "mail_deliveries",
  "manual_blob_generations",
  "manual_commands",
  "manual_correction_history",
  "manual_correction_requests",
  "manual_draft_evidence",
  "manual_draft_history",
  "manual_drafts",
  "manual_evidence",
  "manual_evidence_refs",
  "manual_reports",
  "manual_review_gates",
  "manual_revisions",
  "notification_acceptance",
  "notification_commands",
  "notification_recipients",
  "notifications",
  "outbox_events",
  "outbox_routing",
  "outbox_routing_scans",
  "qualification_assignments",
  "qualification_initial_assignments",
  "qualification_levels",
  "qualification_promotion_reviews",
  "qualification_promotions",
  "qualification_rule_versions",
  "qualification_states",
  "reconciliation_candidates",
  "reconciliation_commands",
  "reconciliation_history",
  "reconciliation_rules",
  "reconciliation_searches",
  "reconciliations",
  "source_messages",
  "source_payloads",
  "source_trips",
  "telemetry_commands",
  "telemetry_installations",
  "telemetry_limits",
  "telemetry_tokens",
  "trip_contribution_history",
  "trip_contributions",
  "trip_decision_catchup",
  "trip_decision_commands",
  "trip_decisions",
  "trip_event_associations",
  "trip_fact_trailers",
  "trip_facts",
  "trip_history",
  "trip_proposal_reviews",
  "trip_proposals",
  "trip_resolutions",
  "trip_review_work",
  "trips",
] as const;
type Table = (typeof tables)[number];
const registered = new Set<string>(tables);
const steps = new Set([
  "allocation",
  "seed_company",
  "seed_qualification_rules",
  "seed_members",
  "seed_reconciliation_permissions",
  "scenario",
  "scenario_teardown",
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
  "source_store",
  "interrupt_lock",
  "interrupt_company",
  "interrupt_startup",
  "interrupt_commit",
  "interrupt_armed",
  "interrupt_cleanup",
  "interrupt_ack",
  "interrupt_drain",
  "interrupt_binding",
  "interrupt_recovery",
  "interrupt_attempts",
  "interrupt_effects",
  "interrupt_duplicates",
  "worker_permissions",
  "jobs_config",
  "jobs_compose",
  "jobs_trip_catchup",
  "jobs_notification_maintenance",
  "jobs_admissions_cleanup",
  "jobs_mail_cleanup",
  "jobs_catalog_cleanup",
  "jobs_manual_cleanup",
  "jobs_pass",
  "jobs_close",
]);

export function acceptanceWorkerPhase(active: boolean, step: string) {
  return active && steps.has(step) && step.startsWith("jobs_")
    ? { event: "jobs_acceptance_phase", phase: step }
    : null;
}

export async function acceptanceTeardown(teardown: () => Promise<void>, primaryFailed: boolean) {
  try {
    await teardown();
    return null;
  } catch (error) {
    if (!primaryFailed) throw error;
    return { error };
  }
}

export function acceptanceWorkerScope(env: NodeJS.ProcessEnv) {
  const runId = env.VTC_NOTIFICATIONS_ACCEPTANCE_RUN,
    revision = env.VTC_NOTIFICATIONS_ACCEPTANCE_REVISION,
    imageId = env.VTC_NOTIFICATIONS_ACCEPTANCE_IMAGE_ID;
  if (
    env.VTC_NOTIFICATIONS_ACCEPTANCE !== "synthetic-only" ||
    env.NODE_ENV !== "production" ||
    !runId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId) ||
    !revision ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    env.VTC_REVISION !== revision ||
    !imageId ||
    !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
    env.MYSQL_DATABASE !== `vtc_na_${runId.replaceAll("-", "").slice(0, 16)}` ||
    env.MYSQL_USER !== `vtc_nw_${runId.replaceAll("-", "").slice(0, 16)}` ||
    env.MYSQL_HOST !== "db" ||
    env.MYSQL_PORT !== "3306"
  )
    return null;
  return { runId, revision, imageId };
}

export function acceptanceSentinelMatches(
  scope: NonNullable<ReturnType<typeof acceptanceWorkerScope>>,
  value: unknown,
) {
  return (
    !!value &&
    typeof value === "object" &&
    "run_id" in value &&
    value.run_id === scope.runId &&
    "image_id" in value &&
    value.image_id === scope.imageId &&
    "revision" in value &&
    value.revision === scope.revision
  );
}
const knownErrnos = new Set([
  1040, 1044, 1045, 1049, 1054, 1059, 1062, 1142, 1143, 1146, 1205, 1213, 1292, 1317, 1364, 1406,
  1451, 1452, 2013,
]);
type Operation = "select" | "insert" | "update" | "delete" | "unknown";
type Lock = "for_update" | "for_share" | "none" | "unknown";

function withoutValues(query: string): string {
  let result = "";
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === "'" || char === '"') {
      const quote = char;
      while (++i < query.length) {
        if (query[i] === "\\") i++;
        else if (query[i] === quote) {
          if (query[i + 1] === quote) i++;
          else break;
        }
      }
      result += " ";
    } else if (char === "`") {
      let identifier = "";
      while (++i < query.length && query[i] !== "`") identifier += query[i];
      result += /^[a-z_][a-z0-9_]*$/i.test(identifier) ? identifier : " __unknown_identifier__ ";
    } else if (char === "#" || (char === "-" && query[i + 1] === "-")) {
      while (i < query.length && !["\n", "\r"].includes(query[i]!)) i++;
      result += " ";
    } else if (char === "/" && query[i + 1] === "*") {
      i += 2;
      while (i < query.length && !(query[i] === "*" && query[i + 1] === "/")) i++;
      i++;
      result += " ";
    } else result += char;
  }
  return result;
}

function context(value: unknown): { operation: Operation; tables: Table[]; lock: Lock } | null {
  if (typeof value !== "string" || value.length > 65536) return null;
  const query = withoutValues(value),
    match = /^\s*(select|insert|update|delete)\b/i.exec(query);
  if (!match) return null;
  const found: Table[] = [];
  for (const table of query.matchAll(
    /\b(?:from|join|into|update)\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\b/gi,
  )) {
    const name = table[1]!.toLowerCase();
    if (registered.has(name) && !found.includes(name as Table)) found.push(name as Table);
  }
  return {
    operation: match[1]!.toLowerCase() as Operation,
    tables: found.slice(0, 8),
    lock: /\bfor\s+update\b/i.test(query)
      ? "for_update"
      : /\bfor\s+share\b/i.test(query)
        ? "for_share"
        : "none",
  };
}

export function acceptanceDiagnostic(error: unknown, step: string) {
  let cause = error,
    nativeErrno: number | null = null,
    deniedTable: Table | null = null;
  let sql: ReturnType<typeof context> = null;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    if (!sql)
      sql =
        context("query" in cause ? cause.query : null) ??
        context("sql" in cause ? cause.sql : null);
    if ("errno" in cause && typeof cause.errno === "number" && knownErrnos.has(cause.errno)) {
      nativeErrno = cause.errno;
      if (
        [1142, 1143].includes(cause.errno) &&
        "sqlMessage" in cause &&
        typeof cause.sqlMessage === "string" &&
        cause.sqlMessage.length <= 4096
      ) {
        const denied = /\bfor table ['"`]([^'"\r\n]+)['"`]\s*$/i
          .exec(cause.sqlMessage)?.[1]
          ?.split(".")
          .at(-1)
          ?.replaceAll("`", "");
        if (denied && registered.has(denied)) deniedTable = denied as Table;
      }
    }
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return {
    category:
      error && typeof error === "object" && "code" in error && error.code === "ERR_ASSERTION"
        ? "assertion"
        : nativeErrno || sql
          ? "database"
          : "operation",
    step: steps.has(step) ? step : "unknown",
    nativeErrno,
    sqlOperation: sql?.operation ?? "unknown",
    sqlTables: sql?.tables ?? [],
    lockingMode: sql?.lock ?? "unknown",
    deniedTable,
  };
}
export function acceptanceDeadlineRemaining(deadline: number, now = Date.now()): number {
  assert.ok(Number.isFinite(deadline) && Number.isFinite(now), "ACCEPTANCE_DEADLINE_INVALID");
  const remaining = deadline - now;
  assert.ok(Number.isFinite(remaining) && remaining > 0, "ACCEPTANCE_WAIT_EXPIRED");
  return remaining;
}
