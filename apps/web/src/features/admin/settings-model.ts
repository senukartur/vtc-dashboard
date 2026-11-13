import type { components } from "@vtc/contracts";
import type { TFunction } from "i18next";

// Pure helpers for company settings, leadership transfer and the audit log. Countdown values
// come from the server (`expiresAt`, `resendAvailableAt`, Retry-After).

/** Whole seconds until `iso`, rounded up; 0 when past, missing or invalid. */
export function secondsUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** ASCII "m:ss" for a non-negative number of seconds. */
export function countdown(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type PendingCode = { expiresAt: string; attemptsRemaining: number };
export type LeadershipView = {
  step: "successor" | "code";
  /** The server-reported code passed its expiry on this clock. */
  expired: boolean;
  /** A requested code is no longer reported by the server (used up, replaced or expired). */
  gone: boolean;
  codeUsable: boolean;
  attemptsLeft: number | null;
  expiresIn: number;
  resendIn: number;
  canRequest: boolean;
};

/**
 * `pending` is the server's current usable code. `requested` is true while this page still shows a
 * code it requested or restored, so a code the server no longer reports stays on the code step
 * with an explanation instead of silently returning to the successor choice. `changing` is the
 * explicit Change successor choice. `resendIn` is the later of the server's `resendAvailableAt` and
 * the transport's Retry-After wait.
 */
export function leadershipView(input: {
  pending: PendingCode | null;
  requested: boolean;
  changing: boolean;
  resendAvailableAt: string | null;
  requestSeconds: number;
  now: number;
}): LeadershipView {
  const { pending, now } = input;
  const expiresIn = pending ? secondsUntil(pending.expiresAt, now) : 0,
    expired = !!pending && expiresIn === 0,
    attemptsLeft = pending ? pending.attemptsRemaining : null,
    resendIn = Math.max(
      secondsUntil(input.resendAvailableAt, now),
      Math.max(0, Math.ceil(input.requestSeconds)),
    );
  return {
    step: !input.changing && (pending || input.requested) ? "code" : "successor",
    expired,
    gone: !pending && input.requested,
    codeUsable: !!pending && !expired && (attemptsLeft ?? 0) > 0,
    attemptsLeft,
    expiresIn,
    resendIn,
    canRequest: resendIn === 0,
  };
}

export const readinessCodes = [
  "company_reporting_timezone",
  "qualification_configuration",
] as const;
export type ReadinessItem = { code: string; ok: boolean; known: boolean };

/** Known setup items first (in a fixed order), then any unknown missing codes as incomplete. */
export function readinessItems(input: {
  reportingTimezone: string | null;
  missingSetup: readonly string[];
}): ReadinessItem[] {
  const missing = new Set(input.missingSetup);
  return [
    ...readinessCodes.map((code) => ({
      code,
      ok:
        !missing.has(code) && (code !== "company_reporting_timezone" || !!input.reportingTimezone),
      known: true,
    })),
    ...[...missing]
      .filter((code) => !(readinessCodes as readonly string[]).includes(code))
      .map((code) => ({ code, ok: false, known: false })),
  ];
}

/** A deferred adapter is "unavailable" at runtime regardless of its runtime flag. */
export function sourceBadges(source: { implemented: boolean; runtimeEnabled: boolean }): {
  implemented: "implemented" | "planned";
  runtime: "enabled" | "disabled" | "unavailable";
} {
  return {
    implemented: source.implemented ? "implemented" : "planned",
    runtime: !source.implemented ? "unavailable" : source.runtimeEnabled ? "enabled" : "disabled",
  };
}

export const settingsTabs = ["general", "qualifications", "audit"] as const;
type SettingsTab = (typeof settingsTabs)[number];

export function settingsTab(value: string | null): SettingsTab {
  return settingsTabs.find((tab) => tab === value) ?? "general";
}

export function validReportingTimezone(value: string | null | undefined): value is string {
  if (!value || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const auditActions = {
  "configuration.changed": "configuration_changed",
  "membership.changed": "membership_changed",
  "report.reviewed": "report_reviewed",
  "leadership.transferred": "leadership_transferred",
  "catalog.published": "catalog_published",
  "catalog.imported": "catalog_imported",
  "catalog.changed": "catalog_changed",
  "application.submitted": "application_submitted",
  "application.reviewed": "application_reviewed",
  "invitation.reissued": "invitation_reissued",
  "invitation.copied": "invitation_copied",
  "invitation.redeemed": "invitation_redeemed",
  "steam.linked": "steam_linked",
  "steam.replaced": "steam_replaced",
  "trip.reconciled": "trip_reconciled",
  "manual.submitted": "manual_submitted",
  "manual.correction_requested": "manual_correction_requested",
  "report.accepted_over_limits": "report_accepted_over_limits",
  "roles.changed": "roles_changed",
  "duplicate.dismissed": "duplicate_dismissed",
  "duplicate.dismissal_undone": "duplicate_dismissal_undone",
  "qualification.assigned": "qualification_assigned",
  "qualification.promoted": "qualification_promoted",
  "qualification.level_changed": "qualification_level_changed",
  "qualification.rules_published": "qualification_rules_published",
} as const;
type AuditAction = keyof typeof auditActions;

export function auditAction(value: string | null): AuditAction | null {
  return value && Object.hasOwn(auditActions, value) ? (value as AuditAction) : null;
}

export function auditPath(action: AuditAction | null, cursor?: string): string {
  const params = new URLSearchParams({ view: "stage3", limit: "25" });
  if (action) params.set("action", action);
  if (cursor && cursor.length <= 2048) params.set("cursor", cursor);
  return `/admin/audit?${params}`;
}

export function shortAuditId(id: string): string {
  // UUID v4 references remain identifiable without a full technical identifier.
  return id.slice(0, 8);
}

export function auditSnapshot(
  row: components["schemas"]["AuditStage3Entry"],
  side: "before" | "after",
  t: TFunction<"administration">,
): string {
  if (!row.details || row.details[side] === null) return t("settingsUi.audit.noSnapshot");

  switch (row.action) {
    case "configuration.changed":
      return row.details[side].reportingTimezone ?? t("notSet");
    case "roles.changed":
      return (
        row.details[side].roles.map((role) => t(role)).join(", ") || t("settingsUi.audit.none")
      );
    case "membership.changed": {
      const { role, status } = row.details[side];
      const membership = t(`settingsUi.audit.value.${status}`);
      return role ? [membership, t(role)].join(" · ") : membership;
    }
    case "leadership.transferred":
      return t(row.details[side].director ? "director" : "settingsUi.audit.value.notDirector");
    case "application.submitted":
    case "application.reviewed":
      return t(`settingsUi.audit.value.${row.details[side].status}`);
    case "invitation.reissued":
    case "invitation.copied":
    case "invitation.redeemed":
      return t(`settingsUi.audit.value.${row.details[side].state}`);
    case "report.reviewed":
    case "report.accepted_over_limits": {
      const { acceptedOverLimits, decision } = row.details[side];
      const label = t(`settingsUi.audit.value.${decision}`);
      return acceptedOverLimits
        ? [label, t("settingsUi.audit.value.overLimits")].join(" · ")
        : label;
    }
    case "trip.reconciled":
      return t(`settingsUi.audit.value.${row.details[side].state}`);
    case "duplicate.dismissed":
    case "duplicate.dismissal_undone": {
      const { dismissed, version } = row.details[side];
      return [
        t(dismissed ? "settingsUi.audit.value.dismissed" : "settingsUi.audit.value.open"),
        t("settingsUi.audit.version", { version }),
      ].join(" · ");
    }
    case "qualification.assigned":
    case "qualification.promoted": {
      const { game, levelId } = row.details[side];
      return t("settingsUi.audit.levelReference", {
        game: game.toUpperCase(),
        id: shortAuditId(levelId),
      });
    }
    case "qualification.level_changed": {
      const { game, active, position, version } = row.details[side];
      return [
        game.toUpperCase(),
        t(active ? "settingsUi.audit.value.active" : "settingsUi.audit.value.inactive"),
        t("settingsUi.audit.position", { position }),
        t("settingsUi.audit.version", { version }),
      ].join(" · ");
    }
    case "qualification.rules_published": {
      const { game, version } = row.details[side];
      return [game.toUpperCase(), t("settingsUi.audit.version", { version })].join(" · ");
    }
  }
}
