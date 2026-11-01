import { paths } from "../../app/navigation-model.js";

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

/** Suggestions for the free-text timezone field: runtime zones, UTC and the current value. */
export function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...supported, "UTC", ...(current ? [current] : [])])].sort();
}
