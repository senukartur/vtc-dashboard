// Pure presentation helpers. The server applies every limit and promotes drivers; these only
// format its data, convert form units and preview a draft.
import { decimalShift } from "../../shared/formatting.js";
import { type Conditions, type DTO, type Limits, QualificationFailure } from "./transport.js";

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

function normalized(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return { whole: whole.replace(/^0+(?=\d)/, ""), fraction: trimmed };
}
/** Exact comparison of two non-negative decimal strings. */
export function compareDecimal(a: string, b: string): number {
  const x = normalized(a),
    y = normalized(b);
  if (x.whole.length !== y.whole.length) return x.whole.length < y.whole.length ? -1 : 1;
  if (x.whole !== y.whole) return x.whole < y.whole ? -1 : 1;
  const width = Math.max(x.fraction.length, y.fraction.length);
  const fx = x.fraction.padEnd(width, "0"),
    fy = y.fraction.padEnd(width, "0");
  return fx === fy ? 0 : fx < fy ? -1 : 1;
}
/**
 * A form amount in display units (t or km) as an exact base-unit string (kg or m). Empty is
 * `null` (no limit); anything else that is not a non-negative decimal is `undefined`.
 */
export function baseUnits(value: string): string | null | undefined {
  const clean = value.trim().replace(",", ".");
  if (clean === "") return null;
  if (!DECIMAL.test(clean)) return undefined;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (whole.length > 17 || fraction.length > 21) return undefined;
  const integer = `${whole}${fraction.slice(0, 3).padEnd(3, "0")}`.replace(/^0+(?=\d)/, "");
  const rest = fraction.slice(3).replace(/0+$/, "");
  return rest ? `${integer}.${rest}` : integer;
}
/** A base-unit amount (kg or m) for a form field in display units, in the viewer's notation. */
export function displayUnits(value: string | null, locale: "ru" | "en"): string {
  if (value === null) return "";
  const shifted = decimalShift(value, 3);
  return locale === "ru" ? shifted.replace(".", ",") : shifted;
}
/** A whole trip count; empty is `null`, anything invalid is `undefined`. */
export function tripCount(value: string): number | null | undefined {
  const clean = value.trim();
  if (clean === "") return null;
  if (!/^[1-9]\d*$/.test(clean)) return undefined;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n <= 4294967295 ? n : undefined;
}
export const hasConditions = (conditions: Conditions | null) =>
  !!conditions && (conditions.requiredTrips !== null || conditions.requiredDistanceM !== null);
/** Whether credited progress meets every set condition; no conditions never promote. */
export function meetsConditions(
  progress: DTO["QualificationProgress"],
  conditions: Conditions,
): boolean {
  if (!hasConditions(conditions)) return false;
  if (conditions.requiredTrips !== null && progress.trips < conditions.requiredTrips) return false;
  if (
    conditions.requiredDistanceM !== null &&
    compareDecimal(progress.distanceM, conditions.requiredDistanceM) < 0
  )
    return false;
  return true;
}
/** Drivers on the level whom the draft conditions would promote right after saving. */
export function promotionPreview(
  drivers: readonly DTO["QualificationLevelDriver"][],
  conditions: Conditions,
  hasNext: boolean,
): number {
  return hasNext ? drivers.filter((d) => meetsConditions(d.credited, conditions)).length : 0;
}
/** Progress toward one condition, 0..100, for a decorative bar; null when the condition is unset. */
export function percent(value: string | number, required: string | number | null): number | null {
  if (required === null) return null;
  const current = Number(value),
    target = Number(required);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 100;
  return Math.min(100, Math.max(0, (current / target) * 100));
}
/** Which limits are set; the list and summaries show only these. */
export function setLimits(limits: Limits) {
  return {
    mass: limits.massMinKg !== null || limits.massMaxKg !== null,
    distance: limits.distanceMinM !== null || limits.distanceMaxM !== null,
    trailers: limits.trailers.mode === "selected",
    adr: limits.adr.mode !== "any",
    hardMode: limits.hardModeRequired,
  };
}
/** The message key text for a failed command; the 422 conditions code has its own message. */
type FailureKey =
  | "errorConditions"
  | "errorConflict"
  | "errorForbidden"
  | "errorLimited"
  | "errorInvalid"
  | "errorUnavailable"
  | "errorUncertain";
export function failureText(t: (key: FailureKey) => string, failure: unknown) {
  if (!(failure instanceof QualificationFailure)) return t("errorUncertain");
  if (failure.code === "QUALIFICATION_CONDITIONS_REQUIRED") return t("errorConditions");
  switch (failure.kind) {
    case "conflict":
      return t("errorConflict");
    case "forbidden":
      return t("errorForbidden");
    case "limited":
      return t("errorLimited");
    case "invalid":
      return t("errorInvalid");
    case "unavailable":
      return t("errorUnavailable");
    default:
      return t("errorUncertain");
  }
}
