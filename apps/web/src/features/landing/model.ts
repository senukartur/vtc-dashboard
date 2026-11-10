import type { components } from "@vtc/contracts";
import { type PublicLocale, publicContent } from "./content.js";

type EventPublic = components["schemas"]["EventPublic"];
type ConvoyLike = Pick<EventPublic, "id" | "status" | "startsAt">;

/** Largest delay a browser timer accepts without firing immediately. */
export const maxTimerDelay = 2147483647;

/** The earliest scheduled convoy that has not started yet; cancelled/completed/started never count. */
export function nextConvoy<T extends ConvoyLike>(items: readonly T[], now: number): T | undefined {
  let next: T | undefined;
  for (const item of items) {
    if (item.status !== "scheduled") continue;
    const start = Date.parse(item.startsAt);
    if (!(start > now)) continue;
    if (!next || start < Date.parse(next.startsAt)) next = item;
  }
  return next;
}

/** Minute-granular countdown, rounded up so it never shows less time than remains. */
export function formatCountdown(ms: number, locale: PublicLocale): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.ceil(ms / 60000),
    days = Math.floor(total / 1440),
    hours = Math.floor((total % 1440) / 60),
    minutes = total % 60,
    units = publicContent[locale].units,
    pad = (value: number) => String(value).padStart(2, "0");
  if (days) return `${days} ${units.d} ${pad(hours)} ${units.h} ${pad(minutes)} ${units.min}`;
  if (hours) return `${hours} ${units.h} ${pad(minutes)} ${units.min}`;
  return `${minutes} ${units.min}`;
}

/** Milliseconds until the rounded-up countdown text changes. */
export function nextChangeDelay(ms: number): number {
  return ms % 60000 || 60000;
}

export function routeLabel(event: Pick<EventPublic, "origin" | "destination" | "route">): string {
  return event.origin && event.destination
    ? `${event.origin.label} → ${event.destination.label}`
    : event.route;
}

/** Day and short month for the card's date tile, in the display timezone. */
export function convoyDateParts(
  startsAt: string,
  locale: PublicLocale,
  timeZone: string,
): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(new Date(startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return { day: part("day"), month: part("month").replace(/\.$/, "") };
}

/** Reporting month label; the month string is a calendar value, so it is formatted in UTC. */
export function monthLabel(month: string, locale: PublicLocale): string {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(year ?? 1970, (value ?? 1) - 1, 1));
}
