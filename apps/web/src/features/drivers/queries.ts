import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { driversRead } from "./transport.js";

export function useMembersList(
  params: { limit?: number | undefined; cursor?: string | undefined } = {},
) {
  const session = useSession();
  const { i18n } = useTranslation();

  const search = new URLSearchParams({
    limit: String(params.limit ?? 50),
    ...(params.cursor ? { cursor: params.cursor } : {}),
  }).toString();

  const path = `/members?${search}`;

  return useQuery({
    queryKey: [
      "drivers-list",
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
        return (await driversRead(path, "EnvelopeListMemberSummary", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useMemberProfile(memberId: string) {
  const session = useSession();
  const { i18n } = useTranslation();
  const path = `/members/${memberId}`;

  return useQuery({
    queryKey: [
      "driver-profile",
      memberId,
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!memberId && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await driversRead(path, "EnvelopeMemberProfile", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useMemberAnalytics(
  memberId: string,
  params: {
    fromDate: string;
    toDateExclusive: string;
    game?: "ets2" | "ats" | undefined;
    granularity?: "day" | "month" | undefined;
  },
) {
  const session = useSession();
  const { i18n } = useTranslation();

  const search = new URLSearchParams({
    fromDate: params.fromDate,
    toDateExclusive: params.toDateExclusive,
    ...(params.granularity ? { granularity: params.granularity } : {}),
    ...(params.game ? { game: params.game } : {}),
  }).toString();

  const path = `/members/${memberId}/analytics?${search}`;

  return useQuery({
    queryKey: [
      "driver-analytics",
      memberId,
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!memberId && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await driversRead(path, "EnvelopeAnalytics", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useMemberProgress(memberId: string, game: "ets2" | "ats") {
  const session = useSession();
  const { i18n } = useTranslation();
  const path = `/members/${memberId}/qualification-progress?game=${game}`;

  return useQuery({
    queryKey: [
      "driver-progress",
      memberId,
      game,
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!memberId && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return (await driversRead(path, "EnvelopeProgress", signal)).data.data;
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}

export function useMemberAcceptedTrips(
  memberId: string,
  params: { limit?: number | undefined; game?: "ets2" | "ats" | undefined } = {},
) {
  const session = useSession();
  const { i18n } = useTranslation();

  const search = new URLSearchParams({
    scope: "company",
    decision: "accepted",
    limit: String(params.limit ?? 50),
    ...(params.game ? { game: params.game } : {}),
  }).toString();

  const path = `/trips?${search}`;

  return useQuery({
    queryKey: [
      "driver-accepted-trips",
      memberId,
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ],
    meta: { private: true },
    enabled: !!memberId && !!session.self?.capabilities.includes("company.read"),
    retry: false,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        const result = (await driversRead(path, "EnvelopeListTripSummary", signal)).data.data;
        // Note: The VTC-022 /api/v1/trips contract does not currently support server-side
        // filtering by memberId. Trips are scoped to company accepted trips and filtered
        // in-memory by ownerId until a server-side member query parameter is introduced.
        return {
          ...result,
          items: result.items.filter((trip) => trip.owner.id === memberId),
        };
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        }
        throw error;
      }
    },
  });
}
