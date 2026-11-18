import type { components } from "@vtc/contracts";

type DTO = components["schemas"];

export type TruckersmpCheck = DTO["ApplicationStage4TruckersmpCheck"];
export type ReferralSource = NonNullable<DTO["ApplicationInput"]["referralSource"]>;
export type CheckFailure = NonNullable<TruckersmpCheck["failure"]>;

/**
 * One phrase of the check line. `key` is an `applicationChecks` translation key, except `player`,
 * which renders the provider display name linked to its profile. Provider strings (`text`) keep
 * their own spelling; dates (`at`) are formatted by the component in the display timezone.
 */
export interface CheckPart {
  key: string;
  count?: number;
  text?: string;
  href?: string;
  at?: string | null;
  reason?: CheckFailure;
}
export interface CheckView {
  /** The current state; shown as a live status only while the check is running. */
  parts: CheckPart[];
  live: boolean;
  /** The earlier stored result kept while a new check runs or after it failed. */
  previous: CheckPart[] | null;
  recheck: "hidden" | "check" | "recheck";
}

function vtcPart(vtc: TruckersmpCheck["vtc"]): CheckPart | null {
  if (!vtc) return null;
  if (!vtc.inVtc) return { key: "notInVtc" };
  const name = vtc.name?.trim() ? vtc.name : null,
    tag = vtc.tag?.trim() ? `[${vtc.tag}]` : null,
    label = [name, tag].filter(Boolean).join(" ");
  return label ? { key: "vtc", text: label } : { key: "inVtc" };
}
function bansPart(bans: TruckersmpCheck["bans"]): CheckPart {
  if (!bans) return { key: "bansHidden" };
  if (bans.count > 0) return { key: "bans", count: bans.count };
  return { key: bans.any ? "banned" : "noBans" };
}
/** The stored provider result, or null when no result exists yet. */
function result(check: TruckersmpCheck): CheckPart[] | null {
  if (check.found === null) return null;
  const checked: CheckPart = { key: "checkedAt", at: check.checkedAt };
  if (!check.found) return [{ key: "notFound" }, checked];
  const vtc = vtcPart(check.vtc);
  return [
    { key: "found" },
    ...(check.displayName
      ? [
          {
            key: "player",
            text: check.displayName,
            ...(check.profileUrl ? { href: check.profileUrl } : {}),
          },
        ]
      : []),
    bansPart(check.bans),
    ...(vtc ? [vtc] : []),
    checked,
  ];
}

/** Text, not colour, carries the state. Rechecks are offered only where the API can start one. */
export function checkView(check: TruckersmpCheck | null | undefined): CheckView {
  const view = (parts: CheckPart[], recheck: CheckView["recheck"]): CheckView => ({
    parts,
    live: false,
    previous: null,
    recheck,
  });
  if (!check) return view([{ key: "noData" }], "hidden");
  switch (check.state) {
    case "completed":
      return view(result(check) ?? [{ key: "notFound" }], "recheck");
    case "checking":
      return {
        parts: [{ key: "checking" }],
        live: true,
        previous: result(check),
        recheck: "hidden",
      };
    case "failed":
      return {
        parts: [
          { key: "failed", reason: check.failure ?? "unavailable" },
          ...(check.lastAttemptAt ? [{ key: "attempted", at: check.lastAttemptAt }] : []),
        ],
        live: false,
        previous: result(check),
        recheck: "recheck",
      };
    default:
      // A vanity /id/ link has no SteamID64, so the API answers a recheck with 409.
      return check.notCheckedReason === "steam_vanity_url"
        ? view([{ key: "vanity" }], "hidden")
        : view([{ key: "notRequested" }], "check");
  }
}

export type CheckGroup = "passed" | "attention" | "failed" | "pending";
export type CheckBadgeLabel =
  | "noBans"
  | "notFound"
  | "hasBans"
  | "bansHidden"
  | "inVtc"
  | "failed"
  | "checking"
  | "notChecked";
/** The list badge: the group decides symbol and tone, `label` names the reason in `badge.*`. */
export interface CheckBadge {
  group: CheckGroup;
  label: CheckBadgeLabel;
}
/** Icons are decorative (aria-hidden); the label carries the state. */
export const checkBadgeLook: Record<
  CheckGroup,
  {
    tone: "ok" | "warn" | "error" | "neutral";
    icon: "shield-check" | "triangle-alert" | "x" | "circle-help";
  }
> = {
  passed: { tone: "ok", icon: "shield-check" },
  attention: { tone: "warn", icon: "triangle-alert" },
  failed: { tone: "error", icon: "x" },
  pending: { tone: "neutral", icon: "circle-help" },
};
/**
 * Owner rule (VTC-161): passed = found, no bans, not in a VTC; attention = not found, bans present
 * or hidden, or in a VTC (an unknown membership counts as one); failed = the check itself failed;
 * pending = running, not checked or no data. The current state wins over an earlier result.
 */
export function checkBadge(check: TruckersmpCheck | null | undefined): CheckBadge {
  const badge = (group: CheckGroup, label: CheckBadgeLabel): CheckBadge => ({ group, label });
  if (!check) return badge("pending", "notChecked");
  if (check.state === "failed") return badge("failed", "failed");
  if (check.state === "checking") return badge("pending", "checking");
  if (check.state !== "completed") return badge("pending", "notChecked");
  if (check.found !== true) return badge("attention", "notFound");
  if (!check.bans) return badge("attention", "bansHidden");
  if (check.bans.any || check.bans.count > 0) return badge("attention", "hasBans");
  if (!check.vtc || check.vtc.inVtc) return badge("attention", "inVtc");
  return badge("passed", "noBans");
}

/** Poll delays after each read while a check runs: 5, 10, 20, 30 s, then once a minute. */
export function pollDelay(step: number) {
  return ([5, 10, 20, 30][step] ?? 60) * 1000;
}

/** The fresher of the detail's check and the latest poll/recheck result. */
export function newerCheck(
  detail: TruckersmpCheck | null | undefined,
  detailAt: number,
  poll: TruckersmpCheck | null | undefined,
  pollAt: number,
) {
  return poll !== undefined && pollAt > detailAt ? poll : detail;
}

export type RecheckFeedback = "forbidden" | "conflict" | "unavailable" | "limited" | "uncertain";
/** Safe feedback for a failed recheck command; unexpected kinds stay uncertain. */
export function recheckFeedback(kind: string): RecheckFeedback {
  return kind === "forbidden" || kind === "conflict" || kind === "unavailable" || kind === "limited"
    ? kind
    : "uncertain";
}

export type ReferralView =
  | { kind: "none" }
  | { kind: "source"; source: ReferralSource }
  | { kind: "other"; text: string };
export function referralView(fields: DTO["ApplicationInput"]): ReferralView {
  const source = fields.referralSource;
  if (!source) return { kind: "none" };
  if (source === "other" && fields.referralOther)
    return { kind: "other", text: fields.referralOther };
  return { kind: "source", source };
}
