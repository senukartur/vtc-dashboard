import type { components } from "@vtc/contracts";
import type { TxContext } from "@vtc/db";
import type { Catalogs } from "../catalogs/service.js";

type S = components["schemas"];
type ReadDepots = Catalogs["depotRefsInTransaction"];
type DepotRef = Awaited<ReturnType<ReadDepots>> extends Map<string, infer T> ? T : never;

/** A page has up to two depots per trip; preserve the catalog's 100-ID read bound. */
export async function tripDepotRefs(
  tx: TxContext,
  ids: readonly string[],
  read: ReadDepots | undefined,
) {
  const result = new Map<string, DepotRef>();
  if (!read) return result;
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = await read(tx, unique.slice(offset, offset + 100));
    for (const [id, depot] of batch) result.set(id, depot);
  }
  return result;
}

/** Stage 3 has its own closed DTO; journal metadata must not expand that wire shape. */
export function reviewQueueTrip(
  summary: S["TripSummary"],
  createdAt: string,
  number: number,
): S["TripStage3ReviewQueueTrip"] {
  return {
    view: summary.view,
    id: summary.id,
    version: summary.version,
    owner: summary.owner,
    game: summary.game,
    outcome: summary.outcome,
    decision: summary.decision,
    origin: summary.origin,
    destination: summary.destination,
    cargo: summary.cargo,
    actualDistanceM: summary.actualDistanceM,
    reportingAt: summary.reportingAt,
    sourceKinds: summary.sourceKinds,
    number,
    createdAt,
    ...(summary.recording !== undefined && { recording: summary.recording }),
    ...(summary.reportingBasis !== undefined && { reportingBasis: summary.reportingBasis }),
    ...(summary.submittedAt !== undefined && { submittedAt: summary.submittedAt }),
    ...(summary.event !== undefined && { event: summary.event }),
    ...(summary.gameMode !== undefined && { gameMode: summary.gameMode }),
  };
}
