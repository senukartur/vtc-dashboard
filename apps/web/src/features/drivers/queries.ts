import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { type Game, ownTrips, tripsPath } from "./model.js";
import { type DTO, driversRead } from "./transport.js";

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

/**
 * Shared private-read wiring for the profile: identity/access-scoped keys, no retries, session
 * loss on 401 and, like the overview, cache cleanup plus a session refresh on 403.
 */
function useProfileRead() {
  const session = useSession();
  const client = useQueryClient();
  const { i18n } = useTranslation();
  const allowed = !!session.self?.capabilities.includes("company.read");

  function key(name: string, memberId: string, path: string) {
    return [
      name,
      memberId,
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
    ];
  }

  async function read<K extends keyof DTO>(path: string, name: K, signal: AbortSignal) {
    try {
      return (await driversRead(path, name, signal)).data;
    } catch (error) {
      if (error instanceof AccountFailure && !signal.aborted) {
        if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
        if (error.kind === "forbidden") {
          client.removeQueries({
            type: "inactive",
            predicate: (query) => query.meta?.private === true,
          });
          await session.refresh();
        }
      }
      throw error;
    }
  }

  return { allowed, key, read };
}

const common = { meta: { private: true }, retry: false, staleTime: 30000 } as const;

export function useMemberProfile(memberId: string) {
  const { allowed, key, read } = useProfileRead();
  const path = `/members/${encodeURIComponent(memberId)}`;
  return useQuery({
    ...common,
    queryKey: key("driver-profile", memberId, path),
    enabled: !!memberId && allowed,
    // The profile is not localized: a language switch keeps it on screen while it refetches.
    // The page remounts per member, so another member's data is never reused.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => (await read(path, "EnvelopeMemberProfile", signal)).data,
  });
}

/** Monthly accepted-trip analytics for the given window; the game filter is optional. */
export function useMemberAnalytics(
  memberId: string,
  params: { fromDate: string; toDateExclusive: string; game?: Game | undefined },
) {
  const { allowed, key, read } = useProfileRead();
  const search = new URLSearchParams({
    fromDate: params.fromDate,
    toDateExclusive: params.toDateExclusive,
    granularity: "month",
    ...(params.game ? { game: params.game } : {}),
  }).toString();
  const path = `/members/${encodeURIComponent(memberId)}/analytics?${search}`;
  return useQuery({
    ...common,
    queryKey: key("driver-analytics", memberId, path),
    enabled: !!memberId && allowed,
    queryFn: async ({ signal }) => (await read(path, "EnvelopeAnalytics", signal)).data,
  });
}

/**
 * Public qualification progress of another member (or oneself). Enabled only when the profile
 * reported an assignment for the game, so members without one cause no request.
 */
export function useMemberProgress(memberId: string, game: Game, enabled: boolean) {
  const { allowed, key, read } = useProfileRead();
  const path = `/members/${encodeURIComponent(memberId)}/qualification-progress?game=${game}`;
  return useQuery({
    ...common,
    queryKey: key("driver-progress", memberId, path),
    enabled: !!memberId && allowed && enabled,
    queryFn: async ({ signal }) => (await read(path, "EnvelopeProgressPublic", signal)).data,
  });
}

export type AcceptedTrips = {
  items: DTO["TripSummary"][];
  nextCursor: string | null;
  /** Other member only: the scanned company window has older trips that were not checked. */
  windowIncomplete: boolean;
};

/**
 * Recent accepted trips. Own profile: the exact first page of `scope=mine`. Another member: the
 * latest accepted company trips filtered by owner, because the contract has no owner filter.
 */
export function useMemberAcceptedTrips(
  memberId: string,
  params: { isSelf: boolean; game?: Game | undefined },
) {
  const { allowed, key, read } = useProfileRead();
  const path = tripsPath(params);
  return useQuery({
    ...common,
    queryKey: key("driver-accepted-trips", memberId, path),
    enabled: !!memberId && allowed,
    queryFn: async ({ signal }): Promise<AcceptedTrips> => {
      const page = (await read(path, "EnvelopeListTripSummary", signal)).data;
      if (params.isSelf)
        return { items: page.items, nextCursor: page.nextCursor, windowIncomplete: false };
      return {
        items: ownTrips(page.items, memberId),
        nextCursor: null,
        windowIncomplete: page.nextCursor !== null,
      };
    },
  });
}
