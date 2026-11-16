import { paths } from "../../app/navigation-model.js";
import { accountTimeZone } from "../../shared/formatting.js";

export type AccountSectionId = "profile" | "security" | "connections" | "preferences";
export interface AccountSection {
  id: AccountSectionId;
  to: string;
  /** Presentation only: the server still authorizes every read and command. */
  capability?: string;
}

/** Account settings sections in navigation order. */
export const accountSections: readonly AccountSection[] = [
  { id: "profile", to: paths.accountProfile },
  { id: "security", to: paths.accountSecurity },
  { id: "connections", to: paths.connections, capability: "company.read" },
  { id: "preferences", to: paths.accountPreferences },
];

export function visibleAccountSections(capabilities: readonly string[]): AccountSection[] {
  return accountSections.filter(
    (section) => !section.capability || capabilities.includes(section.capability),
  );
}

/** Maps the fragment anchors of the former single account page to their section. */
export function legacyAccountSection(hash: string): AccountSectionId {
  if (hash === "#preferences") return "preferences";
  return "security";
}

/** Same technical bounds as the API: a non-empty IANA zone the runtime can format. */
export function timezoneValid(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's offset from UTC at an instant, from the runtime's long offset name: "GMT" becomes
 * "UTC+0", "GMT+05:30" becomes "UTC+5:30". The zone must be valid for this runtime.
 */
export function utcOffset(zone: string, at: number | Date = Date.now()): string {
  const name =
    new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{1,2}):?(\d{2})?$/.exec(name);
  if (!match) return "UTC+0";
  const minutes = match[3] && match[3] !== "00" ? `:${match[3]}` : "";
  return `UTC${match[1]}${Number(match[2])}${minutes}`;
}

export interface TimezoneChoice {
  /** Select value; "" means "as on the device" and saves as null. */
  value: string;
  zone: string;
  /** Offset label, or null for a saved zone this browser cannot format. */
  offset: string | null;
  kind: "device" | "unknown" | "zone";
}

/**
 * Display timezone options: "as on the device" first, then a saved zone this browser does not
 * know (kept selectable so the form shows the truth), then the runtime's zones plus UTC and the
 * saved value, unique and sorted by ID.
 */
export function timezoneChoices(saved: string | null, at: number | Date = Date.now()) {
  const device = accountTimeZone(null);
  const choices: TimezoneChoice[] = [
    { value: "", zone: device, offset: utcOffset(device, at), kind: "device" },
  ];
  const extra: string[] = [];
  if (saved !== null) {
    if (timezoneValid(saved)) extra.push(saved);
    else choices.push({ value: saved, zone: saved, offset: null, kind: "unknown" });
  }
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  for (const zone of [...new Set([...supported, "UTC", ...extra])].sort())
    choices.push({ value: zone, zone, offset: utcOffset(zone, at), kind: "zone" });
  return choices;
}
