import type { components } from "@vtc/contracts";
import { applicationId, decimal38_18, type TxContext, type UnitOfWork } from "@vtc/db";
import { eventRevisionDetails, eventRevisionDlcs, inArray } from "@vtc/db/events-schema";
import { closed } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { identityError } from "../identity/service.js";
import { decimal } from "../sources/contracts/canonical.js";

type S = components["schemas"];
export type EventLocale = "en" | "ru";
export type RouteCatalogs = Pick<
  Catalogs,
  "eventRouteCatalogInTransaction" | "labelsInTransaction"
>;
type DetailsRow = typeof eventRevisionDetails.$inferSelect;
type Depots = Pick<DetailsRow, "originDepotId" | "destinationDepotId">;
export type RouteDetails = Omit<DetailsRow, "revisionId"> & { requiredDlcIds: string[] };
type Cities = Pick<S["EventInput"], "originCityId" | "destinationCityId">;
type EventGame = S["EventInput"]["game"];
type PublishedRouteRef = Cities & { id: string; game: EventGame };
type CatalogFacts = Awaited<ReturnType<RouteCatalogs["eventRouteCatalogInTransaction"]>>;
type RouteFields = Cities & Pick<S["EventInput"], "route" | "meetingLocation">;

export const blankLegacyText = "—";

export function routeChanged(
  prior: RouteFields,
  next: RouteFields,
  priorDepots: Depots | null,
  nextDepots: Depots | null,
) {
  if (!nextDepots)
    return prior.route !== next.route || prior.meetingLocation !== next.meetingLocation;
  return (
    prior.originCityId !== next.originCityId ||
    prior.destinationCityId !== next.destinationCityId ||
    (priorDepots?.originDepotId ?? null) !== nextDepots.originDepotId ||
    (priorDepots?.destinationDepotId ?? null) !== nextDepots.destinationDepotId
  );
}

export const definitionFields = [
  "title",
  "game",
  "server",
  "meetingAt",
  "startsAt",
  "endsAt",
  "visibility",
  "originCityId",
  "destinationCityId",
  "prescribedCargoId",
  "prescribedMassKg",
  "prescribedTrailerTypeId",
] as const;

export const legacyTextFields = ["description", "route", "meetingLocation"] as const;

export function eventText(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw identityError(422);
}

export function publishedRouteInput(raw: S["EventStage2Input"]) {
  const optional = [...legacyTextFields, "originDepotId", "destinationDepotId", "distanceKm"];
  try {
    closed(raw, [
      ...definitionFields,
      "platform",
      "organizerMemberId",
      "requiredDlcIds",
      ...optional.filter((field) => Object.hasOwn(raw, field)),
    ]);
    if (!["truckersmp", "haulmp"].includes(raw.platform)) throw new Error();
    applicationId(raw.organizerMemberId);
    if (
      !Array.isArray(raw.requiredDlcIds) ||
      new Set(raw.requiredDlcIds).size !== raw.requiredDlcIds.length
    )
      throw new Error();
    const requiredDlcIds = [...raw.requiredDlcIds].map(applicationId).sort();
    const originDepotId = raw.originDepotId == null ? null : applicationId(raw.originDepotId);
    const destinationDepotId =
      raw.destinationDepotId == null ? null : applicationId(raw.destinationDepotId);
    const distanceKm = raw.distanceKm == null ? null : decimal(decimal38_18(raw.distanceKm));
    if (raw.distanceKm != null && raw.distanceKm !== distanceKm) throw new Error();
    for (const field of legacyTextFields) {
      if (Object.hasOwn(raw, field) && raw[field] !== null)
        eventText(raw[field], field === "description" ? 8000 : 2048);
    }
    return {
      ...raw,
      originDepotId,
      destinationDepotId,
      requiredDlcIds,
      distanceKm,
    };
  } catch {
    throw identityError(422);
  }
}

export function legacyRouteDetails(
  next: S["EventInput"],
  prior: (Cities & Pick<S["EventInput"], "game" | "organizer">) | null,
  details: RouteDetails | null,
): RouteDetails {
  const sameGame = prior?.game === next.game;
  const sameOrigin = sameGame && prior.originCityId === next.originCityId;
  const sameDestination = sameGame && prior.destinationCityId === next.destinationCityId;
  return {
    platform: details?.platform ?? null,
    organizerMemberId:
      prior?.organizer === next.organizer ? (details?.organizerMemberId ?? null) : null,
    originDepotId: sameOrigin ? (details?.originDepotId ?? null) : null,
    destinationDepotId: sameDestination ? (details?.destinationDepotId ?? null) : null,
    distanceKm: sameOrigin && sameDestination ? (details?.distanceKm ?? null) : null,
    requiredDlcIds: sameGame ? (details?.requiredDlcIds ?? []) : [],
  };
}

export function createPublishedRoutes(unit: UnitOfWork, catalogs: RouteCatalogs) {
  const c = (tx: TxContext) => unit.client(tx);
  async function detailsInTransaction(tx: TxContext, revisionIds: string[]) {
    if (!revisionIds.length) return new Map<string, DetailsRow>();
    const rows = await c(tx)
      .select()
      .from(eventRevisionDetails)
      .where(inArray(eventRevisionDetails.revisionId, revisionIds))
      .for("share");
    return new Map(rows.map((row) => [row.revisionId, row]));
  }
  async function routesInTransaction(tx: TxContext, revisionIds: string[]) {
    const details = await detailsInTransaction(tx, revisionIds);
    const routes = new Map<string, RouteDetails>();
    if (!details.size) return routes;
    for (const { revisionId, ...route } of details.values())
      routes.set(revisionId, { ...route, requiredDlcIds: [] });
    const rows = await c(tx)
      .select({ revisionId: eventRevisionDlcs.revisionId, dlcId: eventRevisionDlcs.dlcId })
      .from(eventRevisionDlcs)
      .where(inArray(eventRevisionDlcs.revisionId, [...details.keys()]))
      .orderBy(eventRevisionDlcs.revisionId, eventRevisionDlcs.dlcId)
      .for("share");
    for (const { revisionId, dlcId } of rows) routes.get(revisionId)?.requiredDlcIds.push(dlcId);
    return routes;
  }

  function publicFields(value: Cities, details: RouteDetails | undefined, facts: CatalogFacts) {
    const { depots, dlcs, cityDlcs } = facts;
    const originDepot = details?.originDepotId ? depots.get(details.originDepotId) : undefined;
    const destinationDepot = details?.destinationDepotId
      ? depots.get(details.destinationDepotId)
      : undefined;
    const derived = new Set([
      value.originCityId ? cityDlcs.get(value.originCityId) : null,
      value.destinationCityId ? cityDlcs.get(value.destinationCityId) : null,
      originDepot?.dlcId,
      destinationDepot?.dlcId,
    ]);
    const manual = new Set(details?.requiredDlcIds);
    const requiredDlcs: S["EventStage2Dlc"][] = [];
    for (const id of [...new Set([...derived, ...manual])]
      .filter((id): id is string => id != null)
      .sort()) {
      const row = dlcs.get(id);
      if (!row) continue;
      const sources: S["EventStage2Dlc"]["sources"] = [];
      if (derived.has(id)) sources.push("from_city");
      if (manual.has(id)) sources.push("manual");
      requiredDlcs.push({ id, name: row.name, code: row.code, sources });
    }
    function depotOption(row: typeof originDepot) {
      return row ? { id: row.id, name: row.name, code: row.code } : null;
    }
    return {
      platform: details?.platform ?? null,
      originDepot: depotOption(originDepot),
      destinationDepot: depotOption(destinationDepot),
      distanceKm: details?.distanceKm == null ? null : decimal(details.distanceKm),
      requiredDlcs,
      hasCover: false,
    };
  }

  return {
    detailsInTransaction,
    async get(tx: TxContext, revisionId: string): Promise<RouteDetails | null> {
      return (await routesInTransaction(tx, [revisionId])).get(revisionId) ?? null;
    },
    async validate(
      tx: TxContext,
      value: Cities & Pick<S["EventInput"], "game">,
      details: RouteDetails,
      previous: RouteDetails | null,
    ) {
      const { depots, dlcs } = await catalogs.eventRouteCatalogInTransaction(tx, value.game, {
        cities: [],
        depots: [details.originDepotId, details.destinationDepotId],
        manualDlcs: details.requiredDlcIds,
      });
      for (const [id, cityId, priorId] of [
        [details.originDepotId, value.originCityId, previous?.originDepotId],
        [details.destinationDepotId, value.destinationCityId, previous?.destinationDepotId],
      ]) {
        if (!id) continue;
        const row = depots.get(id);
        if (!row || row.cityId !== cityId) throw identityError(422);
        if (row.hidden && priorId !== id) throw identityError(422, "CATALOG_SELECTION_HIDDEN");
      }
      const priorIds = new Set(previous?.requiredDlcIds);
      for (const id of details.requiredDlcIds) {
        const row = dlcs.get(id);
        if (!row) throw identityError(422);
        if (row.hidden && !priorIds.has(id)) throw identityError(422, "CATALOG_SELECTION_HIDDEN");
      }
    },
    async insert(
      tx: TxContext,
      revisionId: string,
      game: S["EventInput"]["game"],
      details: RouteDetails,
    ) {
      const { requiredDlcIds, ...row } = details;
      await c(tx)
        .insert(eventRevisionDetails)
        .values({ ...row, revisionId });
      // Split large request-body-bounded sets to stay below MySQL statement parameter limits.
      for (let start = 0; start < requiredDlcIds.length; start += 1000)
        await c(tx)
          .insert(eventRevisionDlcs)
          .values(
            requiredDlcIds.slice(start, start + 1000).map((dlcId) => ({ revisionId, game, dlcId })),
          );
    },
    async publicFieldsInTransaction(tx: TxContext, values: readonly PublishedRouteRef[]) {
      const routes = await routesInTransaction(
        tx,
        values.map((value) => value.id),
      );
      const fields = new Map<
        string,
        {
          public: ReturnType<typeof publicFields>;
          organizerMemberId: string | null;
        }
      >();
      for (const game of ["ats", "ets2"] as const) {
        const group = values.filter((value) => value.game === game);
        if (!group.length) continue;
        const details = group.map((value) => routes.get(value.id));
        const facts = await catalogs.eventRouteCatalogInTransaction(tx, game, {
          cities: group.flatMap((value) => [value.originCityId, value.destinationCityId]),
          depots: details.flatMap((route) => [route?.originDepotId, route?.destinationDepotId]),
          manualDlcs: details.flatMap((route) => route?.requiredDlcIds ?? []),
        });
        for (const value of group) {
          const route = routes.get(value.id);
          fields.set(value.id, {
            public: publicFields(value, route, facts),
            organizerMemberId: route?.organizerMemberId ?? null,
          });
        }
      }
      return fields;
    },
  };
}
