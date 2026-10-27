import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { type DTO, dashboardRead } from "./transport.js";

export function useCompanyAnalytics(params: {
  fromDate: string;
  toDateExclusive: string;
  game?: "ets2" | "ats" | undefined;
  granularity?: "day" | "month" | undefined;
}) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();

  const search = new URLSearchParams({
    fromDate: params.fromDate,
    toDateExclusive: params.toDateExclusive,
    ...(params.granularity ? { granularity: params.granularity } : {}),
    ...(params.game ? { game: params.game } : {}),
  }).toString();

  const path = `/analytics/company?${search}`;

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
    enabled: !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeAnalytics", signal)).data.data;
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

export function useDriverLeaderboard(params: {
  fromDate: string;
  toDateExclusive: string;
  game?: "ets2" | "ats" | undefined;
  limit?: number | undefined;
}) {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();

  const search = new URLSearchParams({
    fromDate: params.fromDate,
    toDateExclusive: params.toDateExclusive,
    limit: String(params.limit ?? 10),
    ...(params.game ? { game: params.game } : {}),
  }).toString();

  const path = `/analytics/leaderboard?${search}`;

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
    enabled: !!session.self?.capabilities.includes("company.read"),
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

export function useUpcomingEvent() {
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
    enabled: !!session.self?.capabilities.includes("company.read"),
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

export function useMyQualificationProgress(game: "ets2" | "ats") {
  const session = useSession();
  const { i18n } = useTranslation();
  const path = `/me/qualification-progress?game=${game}`;

  return useQuery({
    queryKey: [
      "dashboard-my-progress",
      game,
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
        return (await dashboardRead(path, "EnvelopeProgress", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useReviewQueueTrips() {
  const session = useSession();
  const { i18n } = useTranslation();
  const path = "/trips?scope=review&decision=pending_review&limit=5";

  return useQuery({
    queryKey: [
      "dashboard-review-queue",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!session.self?.capabilities.includes("trips.review"),
    retry: false,
    staleTime: 15000,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead(path, "EnvelopeListTripSummary", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}
