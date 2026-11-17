import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { readCompanyStats } from "../landing/stats.js";
import type { PeriodQuery } from "./model.js";
import { DashboardPayloadFailure, dashboardRead } from "./transport.js";
import {
  analyticsPath,
  type BreakdownData,
  type BreakdownDimension,
  breakdownPath,
  leaderboardPath,
  recentTripsPath,
} from "./view-model.js";

/**
 * Source of the company reporting timezone for the period anchors. Same key, reader and public
 * meta as the landing StatsBand, so both share one cached anonymous read; only
 * `currentMonth.reportingTimezone` is used here.
 */
export function useReportingTimezoneSource() {
  const session = useSession();
  return useQuery({
    queryKey: ["public-company-stats"],
    queryFn: ({ signal }) => readCompanyStats(signal),
    meta: { private: false },
    enabled: !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    // A failed read has no data, so a reconnect would reread it, reset it to pending and turn a
    // page already showing UTC-anchored data back to loading (unmounting forms, dropping focus).
    // The UTC fallback lasts until Retry or a remount instead.
    refetchOnReconnect: false,
  });
}

export function useCompanyAnalytics(params: {
  query: PeriodQuery;
  game?: "ets2" | "ats" | undefined;
  granularity: "day" | "month";
  enabled?: boolean | undefined;
}) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();
  const path = analyticsPath(params.query, params);

  return useQuery({
    queryKey: [
      "dashboard-company-analytics",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: params.enabled !== false && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "AnalyticsStage4CompanyEnvelope", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (q) => q.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
}

/** The top ten plus the viewer's own place (`viewer`) and the ranked members count. */
export function useDriverLeaderboard(params: {
  query: PeriodQuery;
  game?: "ets2" | "ats" | undefined;
  enabled?: boolean | undefined;
}) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();
  const path = leaderboardPath(params.query, params.game);

  return useQuery({
    queryKey: [
      "dashboard-driver-leaderboard",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: params.enabled !== false && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeListLeaderboardEntry", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (q) => q.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
}

export function useTripStatusSummary(game?: "ets2" | "ats") {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();

  const search = game ? `?game=${game}` : "";
  const path = `/me/trip-status-summary${search}`;

  return useQuery({
    queryKey: [
      "dashboard-trip-status-summary",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!session.self?.capabilities.includes("trips.submit_own"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeOwnTripStatusSummary", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

/** The shell chip calls this without options; the overview gates its own observer. */
export function useUpcomingEvent(options?: { enabled?: boolean | undefined }) {
  const session = useSession();
  const path = "/me/upcoming-event";

  return useQuery({
    queryKey: [
      "dashboard-upcoming-event",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      path,
    ],
    meta: { private: true },
    enabled: options?.enabled !== false && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 60000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeOptionalEvent", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useMyQualificationProgress(
  game: "ets2" | "ats",
  options?: { enabled?: boolean | undefined },
) {
  const session = useSession();
  const { i18n } = useTranslation();
  const path = "/me/qualifications";

  // Both games read one list: the shared key makes them one request, and `select` picks the game.
  return useQuery({
    queryKey: [
      "dashboard-my-progress",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled:
      options?.enabled !== false && !!session.self?.capabilities.includes("trips.submit_own"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeMyQualificationList", signal)).data.data.items;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
    select: (items) => items.find((item) => item.game === game && item.level) ?? null,
  });
}

/**
 * Latest accepted company trips for the overview. It follows the page game filter; the period
 * filter does not apply because the trips list has no date filter.
 */
export function useRecentCompanyTrips(
  game?: "ets2" | "ats",
  options?: { enabled?: boolean | undefined },
) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();
  const path = recentTripsPath(game, i18n.resolvedLanguage === "en" ? "en" : "ru");

  return useQuery({
    queryKey: [
      "dashboard-recent-trips",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: options?.enabled !== false && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeListTripSummary", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (q) => q.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
}

/**
 * One trip breakdown card (VTC-148): top routes or cargo, or the source split, for the page
 * filters and labelled in the interface language. A body for another dimension is a payload error.
 */
export function useCompanyBreakdown<D extends BreakdownDimension>(
  dimension: D,
  params: {
    query: PeriodQuery;
    game?: "ets2" | "ats" | undefined;
    enabled?: boolean | undefined;
  },
) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();
  const path = breakdownPath(dimension, params.query, {
    game: params.game,
    locale: i18n.resolvedLanguage === "en" ? "en" : "ru",
  });

  return useQuery({
    queryKey: [
      "dashboard-company-breakdown",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: params.enabled !== false && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }): Promise<BreakdownData[D]> => {
      try {
        const body = (await dashboardRead(path, "AnalyticsStage4BreakdownEnvelope", signal)).data
          .data;
        if (body.dimension !== dimension) throw new DashboardPayloadFailure();
        return body as BreakdownData[D];
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (q) => q.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
}
