import type { TxContext, UnitOfWork } from "@vtc/db";
import { eq, sql, tripOwnerRevisions } from "@vtc/db/trips-schema";

/** Called only by producers, with the company/member fence held, on their transaction. */
export function createOwnerRevision(unit: UnitOfWork) {
  return {
    async bump(tx: TxContext, ownerId: string) {
      await unit
        .client(tx)
        .insert(tripOwnerRevisions)
        .values({ ownerId, revision: 1n })
        .onDuplicateKeyUpdate({ set: { revision: sql`${tripOwnerRevisions.revision} + 1` } });
    },
    async read(tx: TxContext, ownerId: string) {
      const [row] = await unit
        .client(tx)
        .select({ revision: tripOwnerRevisions.revision })
        .from(tripOwnerRevisions)
        .where(eq(tripOwnerRevisions.ownerId, ownerId))
        .for("share");
      return String(row?.revision ?? 0n);
    },
  };
}
