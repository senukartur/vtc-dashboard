import type { components } from "@vtc/contracts";
import { formatDecimal, formatQuantity } from "../../shared/formatting.js";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { schema } from "../dashboard/transport.js";
import { publicContent, type PublicLocale } from "./content.js";
import { monthLabel } from "./model.js";

export type CompanyStats = components["schemas"]["CompanyStatsPublic"];
export const statsUnavailable = "PUBLIC_COMPANY_STATS_UNAVAILABLE";

/**
 * Anonymous VTC-052 aggregate read. Cookies are never sent; every failure collapses into one
 * fixed error so no server text can reach the page.
 */
export async function readCompanyStats(signal: AbortSignal): Promise<CompanyStats> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    const response = await withReadSlot(bounded, () =>
      fetch("/api/v1/public/company-stats", {
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: bounded,
      }),
    );
    if (response.status !== 200) throw new Error(statsUnavailable);
    const parsed = schema("EnvelopeCompanyStatsPublic").safeParse(await response.json());
    if (!parsed.success) throw new Error(statsUnavailable);
    return parsed.data.data;
  } catch {
    throw new Error(statsUnavailable);
  }
}

export type StatsTile = {
  key: "members" | "trips" | "distance" | "games";
  label: string;
  value: string;
};
export type StatsView = { caption: string | null; tiles: StatsTile[] };

/** Exact, unrounded presentation. An unavailable month shows only the member count, never zeros. */
export function statsView(stats: CompanyStats, locale: PublicLocale): StatsView {
  const c = publicContent[locale],
    month = stats.currentMonth,
    tiles: StatsTile[] = [
      {
        key: "members",
        label: c.statsMembers,
        value: formatDecimal(String(stats.activeMembers), locale),
      },
    ];
  if (month.status !== "available") return { caption: null, tiles };
  tiles.push(
    {
      key: "trips",
      label: c.statsTrips,
      value: formatDecimal(String(month.acceptedTrips), locale),
    },
    {
      key: "distance",
      label: c.statsDistance,
      value: formatQuantity(month.actualDistanceM, "km", locale),
    },
  );
  const games = (["ets2", "ats"] as const).filter((game) => month.games.includes(game));
  if (games.length)
    tiles.push({
      key: "games",
      label: c.statsGames,
      value: games.map((game) => game.toUpperCase()).join(" · "),
    });
  return {
    caption: `${c.statsMonth}: ${monthLabel(month.month, locale)} · ${c.statsTimezone}: ${month.reportingTimezone}`,
    tiles,
  };
}
