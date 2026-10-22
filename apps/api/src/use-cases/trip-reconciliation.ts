import type { TxContext } from "@vtc/db";
import { identityError } from "../modules/identity/service.js";
import type { Actor } from "../modules/identity/service.js";
import type { ManualReports } from "../modules/manual-reports/service.js";
import type { Qualifications } from "../modules/qualifications/service.js";
import type { Trips } from "../modules/trips/service.js";
import type { TripState } from "../modules/trips/groups.js";
import type { GroupSnapshot } from "../modules/trips/reconciliation.js";
export function reconciliationCoordinator(ports: {
  trips: Trips;
  qualifications: Qualifications;
  manual?: ManualReports;
}) {
  async function prepare(tx: TxContext, ids: string[], actor?: Actor) {
    // Discovery is read-only. Company/current members and qualification assignments precede group mutations.
    const rows = await ports.trips.contributions.owners(tx, ids);
    await ports.qualifications.prepareInTransaction(tx, rows, actor);
    const locked = await ports.trips.reconciliation.inspect(tx, ids);
    const authors = await ports.trips.reconciliation.manualAuthors(
      tx,
      locked.map((t) => t.id),
    );
    if (actor && authors.includes(actor.userId)) throw identityError(403, "SELF_REVIEW_FORBIDDEN");
    if (authors.length && !ports.manual) throw identityError(503);
    await ports.manual?.reconciliationGuardInTransaction(tx, ids, actor?.userId);
    return locked;
  }
  async function replace(tx: TxContext, rows: TripState[], saved?: GroupSnapshot["credits"]) {
    const current = await ports.trips.reconciliation.credits(
      tx,
      rows.map((t) => t.id),
    );
    const changes = rows.flatMap((row) => {
      if (!row.currentFactId) return [];
      const credit = current.find((c) => c.tripId === row.id),
        previous = (saved ?? current).find((c) => c.tripId === row.id);
      return [
        {
          tripId: row.id,
          expectedTripVersion: row.version,
          version: (credit?.version ?? 0) + 1,
          factId: row.currentFactId,
          aliasOf: row.aliasOf,
          ...(previous?.attributionBasis === "manual_confirmation" && previous.attributionAt
            ? { manualConfirmedAt: previous.attributionAt }
            : {}),
        },
      ];
    });
    if (changes.length) await ports.qualifications.replaceContributionsInTransaction(tx, changes);
  }
  return { prepare, replace };
}
