import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import { and, eq, inArray, isNull, or, trips } from "@vtc/db/trips-schema";
import { identityError } from "../identity/service.js";
export type TripState = typeof trips.$inferSelect;
// Flat aliases preserve original identities. Every writer holds the company/member locks first.
export function createTripGroups(unit: UnitOfWork) {
  const c = (tx: TxContext) => unit.client(tx);
  async function resolve(tx: TxContext, id: string, lock: boolean | "share" = false) {
    const query = c(tx)
      .select()
      .from(trips)
      .where(eq(trips.id, applicationId(id)));
    const [original] = await (lock ? query.for(lock === "share" ? "share" : "update") : query);
    if (!original) throw identityError(404);
    if (!original.aliasOf) return original;
    const target = c(tx).select().from(trips).where(eq(trips.id, original.aliasOf));
    const [root] = await (lock ? target.for(lock === "share" ? "share" : "update") : target);
    if (!root || root.aliasOf || root.ownerId !== original.ownerId || root.game !== original.game)
      throw new Error("TRIP_GROUP_INVALID");
    return root;
  }
  async function members(tx: TxContext, ids: string[], lock: boolean | "share" = false) {
    const roots = new Set<string>();
    for (const id of [...new Set(ids)].sort()) roots.add((await resolve(tx, id, lock)).id);
    if (!roots.size) return [];
    const query = c(tx)
      .select()
      .from(trips)
      .where(or(inArray(trips.id, [...roots]), inArray(trips.aliasOf, [...roots])))
      .orderBy(trips.id);
    const rows = await (lock ? query.for(lock === "share" ? "share" : "update") : query);
    const rootRows = new Map(rows.filter((t) => !t.aliasOf).map((t) => [t.id, t]));
    for (const row of rows) {
      const root = rootRows.get(row.aliasOf ?? row.id);
      if (!root || root.ownerId !== row.ownerId || root.game !== row.game)
        throw new Error("TRIP_GROUP_INVALID");
    }
    return rows;
  }
  return {
    resolve,
    members,
    async contains(tx: TxContext, rootId: string, originalId: string, current = false) {
      const root = await resolve(tx, originalId, current ? "share" : false);
      return root.id === rootId;
    },
    async discover(tx: TxContext, ownerId: string, game: "ets2" | "ats", limit: number) {
      return c(tx)
        .select()
        .from(trips)
        .where(and(eq(trips.ownerId, ownerId), eq(trips.game, game), isNull(trips.aliasOf)))
        .orderBy(trips.id)
        .limit(limit)
        .for("update");
    },
  };
}
