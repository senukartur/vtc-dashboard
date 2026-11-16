import { preferenceNames } from "@vtc/db/notifications-schema";
import type { ReportedTime } from "../sources/contracts/evidence.js";
export const stage4Preferences = [
  "reviewQueue",
  "newApplications",
  "tripAccepted",
  "newEvent",
] as const;
export type PreferenceName = (typeof preferenceNames)[number] | (typeof stage4Preferences)[number];
/**
 * Toggles a viewer can read and must write back exactly. The six original toggles and the
 * company-wide tripAccepted/newEvent are always present; reviewQueue and newApplications only
 * appear with the capability that receives those categories.
 */
export function preferenceKeys(capabilities: readonly string[]): PreferenceName[] {
  return [
    ...preferenceNames,
    ...(capabilities.includes("trips.review") ? (["reviewQueue"] as const) : []),
    ...(capabilities.includes("applications.manage") ? (["newApplications"] as const) : []),
    "tripAccepted",
    "newEvent",
  ];
}
export const freshnessMs = 120000;
export const reminderGraceMs = 120000;
export function sourceLiveUntil(
  context: { provider: string; deliveryMode: string; receivedAt: string },
  time: ReportedTime,
): string | null {
  if (
    context.provider !== "ets2telemetry" ||
    context.deliveryMode !== "live" ||
    !time.verifiedActual ||
    time.basis !== "event" ||
    time.utc === null
  )
    return null;
  const occurred = Date.parse(time.utc),
    received = Date.parse(context.receivedAt);
  if (
    !Number.isFinite(occurred) ||
    !Number.isFinite(received) ||
    received < occurred ||
    received - occurred > freshnessMs
  )
    return null;
  return new Date(occurred + freshnessMs).toISOString();
}
export function reminderWindow(startsAt: string, now: string) {
  const due = Date.parse(startsAt) - 3600000,
    time = Date.parse(now);
  return {
    due: new Date(due).toISOString(),
    eligible: time >= due && time <= due + reminderGraceMs && time < Date.parse(startsAt),
    schedulable: time <= due + reminderGraceMs && time < Date.parse(startsAt),
  };
}
