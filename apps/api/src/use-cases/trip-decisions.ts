import { applicationId, type TxContext } from "@vtc/db";
import { type Actor, type Identity, identityError } from "../modules/identity/service.js";
import type { ManualReports } from "../modules/manual-reports/service.js";
import type { Qualifications } from "../modules/qualifications/service.js";
import type { Trips } from "../modules/trips/service.js";
// Owning facades participate on the caller transaction; no coordinator reaches through module tables.
export function tripDecisionCoordinator(ports: {
  identity: Identity;
  trips: Trips;
  qualifications: Qualifications;
  manual: ManualReports;
}) {
  async function prepare(tx: TxContext, id: string, actor?: Actor, review = true) {
    const owners = await ports.trips.contributions.owners(tx, [applicationId(id)]);
    await ports.qualifications.prepareInTransaction(tx, owners, review ? actor : undefined);
    if (actor && !review) await ports.identity.authorizeInTransaction(tx, actor, "company.read");
    const members = await ports.trips.groups.members(tx, [id], true),
      row = members.find((t) => !t.aliasOf);
    if (!row) throw identityError(404);
    const manual = await ports.manual.reviewContextInTransaction(tx, row.id);
    if (actor && review && manual.reports.some((r) => r.ownerId === actor.userId))
      throw identityError(403, "SELF_REVIEW_FORBIDDEN");
    if (
      actor &&
      !review &&
      row.ownerId !== actor.userId &&
      !actor.capabilities.includes("trips.review")
    )
      throw identityError(404);
    return { row, members, manual };
  }
  return { prepare };
}
