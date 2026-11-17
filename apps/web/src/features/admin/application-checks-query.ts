import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { qualificationRead } from "../qualifications/transport.js";
import type { TruckersmpCheck } from "./application-checks-model.js";

/**
 * Re-reads only an application's TruckersMP check while it runs. The query never fetches on its
 * own: the detail read supplies the first state, a recheck seeds it with the 202 result and the
 * component's timer calls refetch. The key carries the same identity scope as workspace reads, so
 * session changes and admissions command refreshes drop it with them.
 */
export function useCheckPoll(id: string) {
  const session = useSession(),
    client = useQueryClient(),
    path = `/admin/applications/${id}`;
  const queryKey = [
    "administration",
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
    path,
    "TruckersmpCheckPoll",
  ];
  const query = useQuery<TruckersmpCheck | null>({
    queryKey,
    meta: { private: true },
    enabled: false,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      try {
        const result = await qualificationRead(path, "EnvelopeApplication", signal);
        signal.throwIfAborted();
        return result.data.data.truckersmpCheck ?? null;
      } catch (error) {
        if (!signal.aborted && error instanceof AccountFailure) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") await session.refresh();
        }
        throw error;
      }
    },
  });
  return {
    query,
    seed: (check: TruckersmpCheck) => client.setQueryData(queryKey, check),
  };
}
