import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure } from "../account/transport.js";
import { fail, schema } from "../events/transport.js";

const path = "/public/events?period=upcoming&limit=3";
// The existing list and its staged projection share the same route.
const envelope = z.lazy(() =>
  z.union([schema("EnvelopeListEventPublic"), schema("EventStage2EnvelopePublicList")]),
);
export type Convoy = z.infer<typeof envelope>["data"]["items"][number];

async function readConvoys(signal: AbortSignal): Promise<Convoy[]> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    return await withReadSlot(bounded, async () => {
      const response = await fetch(`/api/v1${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: bounded,
        headers: { Accept: "application/json" },
      });
      try {
        if (response.status !== 200) fail(response);
        const parsed = envelope.safeParse(await response.json());
        if (!parsed.success) throw new AccountFailure("unavailable");
        bounded.throwIfAborted();
        return parsed.data.data.items;
      } finally {
        if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
      }
    });
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("unavailable");
  }
}

/** One shared public read feeds the countdown pill and the cards. */
export function useConvoyQuery() {
  const query = useQuery({
    queryKey: ["public-events", path, "landing-convoys"],
    meta: { private: false },
    retry: false,
    gcTime: 300000,
    staleTime: 30000,
    queryFn: ({ signal }) => readConvoys(signal),
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
