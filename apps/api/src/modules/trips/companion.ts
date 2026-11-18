import type { companionComponents } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  sourceMessages,
  sourceTrips,
  tripContributions,
  tripFacts,
  trips,
  sql,
} from "@vtc/db/trips-schema";
import type { SQLWrapper } from "drizzle-orm";
import { identityError } from "../identity/service.js";
import { sourceKey } from "../sources/contracts/canonical.js";
import { createTripGroups } from "./groups.js";
import { createOwnerRevision } from "./owner-revision.js";

type Request = companionComponents["schemas"]["SourceRequest"];
/** Exact owned source identities only; no browser projection or history enumeration. */
export function createCompanionTrips(unit: UnitOfWork) {
  const c = (tx: TxContext) => unit.client(tx),
    groups = createTripGroups(unit);
  return {
    revision: createOwnerRevision(unit),
    async eventChanged(tx: TxContext, attendanceOwners: readonly string[], relation: SQLWrapper) {
      const associated = await c(tx)
        .selectDistinct({ ownerId: trips.ownerId })
        .from(trips)
        .where(sql`${trips.id} IN (${relation})`)
        .orderBy(trips.ownerId)
        .limit(1001)
        .for("share");
      const owners = [
        ...new Set([...attendanceOwners, ...associated.map((row) => row.ownerId)]),
      ].sort();
      if (owners.length > 1000) throw identityError(409);
      for (const ownerId of owners) await createOwnerRevision(unit).bump(tx, ownerId);
    },
    async source(tx: TxContext, ownerId: string, request: Request) {
      const [source] = await c(tx)
        .select({
          id: sourceTrips.id,
          canonicalTripId: sourceTrips.canonicalTripId,
          latestRevision: sourceTrips.latestRevision,
        })
        .from(sourceTrips)
        .where(
          and(
            eq(sourceTrips.ownerId, ownerId),
            eq(sourceTrips.provider, request.source.provider),
            eq(sourceTrips.game, request.source.game),
            eq(sourceTrips.sessionKey, sourceKey(request.source.pluginSessionId)),
            eq(sourceTrips.tripKey, sourceKey(request.source.tripId)),
          ),
        )
        .for("share");
      if (!source) return null;
      const root = await groups.resolve(tx, source.canonicalTripId, "share");
      if (root.ownerId !== ownerId) return null;
      const [requested] = await c(tx)
        .select({ id: sourceMessages.id, factId: tripFacts.id })
        .from(sourceMessages)
        .innerJoin(tripFacts, eq(tripFacts.messageId, sourceMessages.id))
        .where(
          and(
            eq(sourceMessages.sourceTripId, source.id),
            eq(sourceMessages.revision, String(request.revision)),
            eq(sourceMessages.eventKey, sourceKey(request.eventId)),
          ),
        )
        .for("share");
      const [credit] = await c(tx)
        .select({
          credited: tripContributions.credited,
          actualDistanceM: tripContributions.actualDistanceM,
          assignmentId: tripContributions.assignmentId,
        })
        .from(tripContributions)
        .where(eq(tripContributions.tripId, root.id))
        .for("share");
      return { source, root, requested: requested ?? null, credit: credit ?? null };
    },
    async material(tx: TxContext, factId: string) {
      const [fact] = await c(tx)
        .select({
          id: tripFacts.id,
          messageId: tripFacts.messageId,
          derivedSourceMessageId: tripFacts.derivedSourceMessageId,
        })
        .from(tripFacts)
        .where(eq(tripFacts.id, factId))
        .for("share");
      const messageId = fact?.messageId ?? fact?.derivedSourceMessageId;
      if (!messageId) return null;
      const [message] = await c(tx)
        .select({
          id: sourceMessages.id,
          revision: sourceMessages.revision,
          eventKey: sourceMessages.eventKey,
        })
        .from(sourceMessages)
        .where(eq(sourceMessages.id, messageId))
        .for("share");
      if (!message) return null;
      const [source] = await c(tx)
        .select({
          provider: sourceTrips.provider,
          game: sourceTrips.game,
          session: sourceTrips.sessionKey,
          trip: sourceTrips.tripKey,
        })
        .from(sourceTrips)
        .innerJoin(sourceMessages, eq(sourceMessages.sourceTripId, sourceTrips.id))
        .where(eq(sourceMessages.id, message.id))
        .for("share");
      return {
        id: message.id,
        game: source?.game ?? null,
        revision: Number(message.revision),
        eventId: message.eventKey.toString(),
        source:
          source?.provider === "ets2telemetry"
            ? {
                provider: "ets2telemetry" as const,
                game: source.game,
                pluginSessionId: source.session.toString(),
                tripId: source.trip.toString(),
              }
            : null,
      };
    },
  };
}
