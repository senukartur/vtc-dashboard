import type { components } from "@vtc/contracts";
import { publicContent, type PublicLocale } from "./content.js";

type EventPublic = components["schemas"]["EventPublic"];
type ConvoyLike = Pick<EventPublic, "id" | "status" | "startsAt">;

/** Largest delay a browser timer accepts without firing immediately. */
export const maxTimerDelay = 2147483647;
/** Every ticker half repeats the scheduled routes to this many items. */
export const tickerHalf = 8;

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

export type TickerRoute = { key: string; game: EventPublic["game"]; label: string; copy: boolean };

/** Scheduled routes cycled to two identical halves; the second half only exists for a seamless loop. */
export function tickerRoutes(
  items: readonly Pick<
    EventPublic,
    "id" | "status" | "game" | "origin" | "destination" | "route"
  >[],
): TickerRoute[] {
  const scheduled = items.filter((item) => item.status === "scheduled");
  if (!scheduled.length) return [];
  return Array.from({ length: tickerHalf * 2 }, (_, index) => {
    const event = scheduled[(index % tickerHalf) % scheduled.length] as (typeof scheduled)[number];
    return {
      key: `${event.id}-${index}`,
      game: event.game,
      label: routeLabel(event),
      copy: index >= tickerHalf,
    };
  });
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
