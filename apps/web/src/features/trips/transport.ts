import type { components } from "@vtc/contracts";
import { browserSchemaDocument } from "@vtc/contracts/runtime";
import { z } from "zod";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure } from "../account/transport.js";
import { retryDelay } from "../admissions/transport.js";
export type DTO = components["schemas"];
const schemas = new Map<string, z.ZodType>();
// Zod's installed JSON Schema importer cannot consume conditional keywords.
// Expand the two reviewed conditions into equivalent exclusive object branches;
// every field constraint still comes from the generated contract document.
const runtimeDocument = structuredClone(browserSchemaDocument) as {
  $defs: Record<string, Record<string, unknown>>;
};
const defs = runtimeDocument.$defs;
const proposal = defs.TripProposal;
if (!proposal) throw new Error("MISSING_TRIP_CONTRACT");
const proposalProperties = proposal.properties as Record<string, unknown>;
const proposalBase = { ...proposal };
delete proposalBase.allOf;
const condition = (proposal.allOf as { then: { properties: Record<string, unknown> } }[])[0];
defs.TripProposal = {
  oneOf: [
    {
      ...proposalBase,
      properties: {
        ...proposalProperties,
        kind: { const: "resolution" },
        ...condition?.then.properties,
      },
    },
    {
      ...proposalBase,
      properties: { ...proposalProperties, kind: { const: "correction_request" } },
    },
  ],
};
const resolution = defs.ResolutionInput;
if (!resolution) throw new Error("MISSING_TRIP_CONTRACT");
const resolutionBase = { ...resolution };
delete resolutionBase.if;
delete resolutionBase.then;
const resolutionProperties = resolution.properties as Record<string, unknown>;
defs.ResolutionInput = {
  oneOf: [
    { ...resolutionBase, properties: { ...resolutionProperties, correctionRequestId: false } },
    {
      ...resolutionBase,
      required: [...(resolution.required as string[]), "correctionRequestId"],
      ...(resolution.then as object),
    },
  ],
};
export function schema<K extends keyof DTO>(name: K): z.ZodType<DTO[K]> {
  let result = schemas.get(name);
  if (!result) {
    result = z.fromJSONSchema({ ...runtimeDocument, $ref: `#/$defs/${name}` });
    schemas.set(name, result);
  }
  return result as z.ZodType<DTO[K]>;
}
export class TripFailure extends AccountFailure {
  constructor(
    kind: AccountFailure["kind"],
    public readonly status = 0,
    delay: number | null = null,
  ) {
    super(kind, delay);
  }
}
/**
 * listTrips answers 409 `VERSION_CONFLICT` for every cursor it no longer accepts: tampered,
 * expired, signed with a rotated key, or issued for other filters or another member. Lists
 * restart at the first page of the same filters instead of showing an error.
 */
export function rejectedCursor(cursor: string | null, error: unknown) {
  return !!cursor && error instanceof TripFailure && error.status === 409;
}
export function fail(response: Response): never {
  const kinds: Record<number, AccountFailure["kind"]> = {
    400: "invalid",
    401: "unauthorized",
    403: "forbidden",
    404: "unavailable",
    409: "conflict",
    410: "unavailable",
    413: "invalid",
    415: "invalid",
    422: "invalid",
    428: "conflict",
    429: "limited",
    503: "unavailable",
  };
  throw new TripFailure(
    kinds[response.status] ?? "uncertain",
    response.status,
    retryDelay(response.headers.get("Retry-After")),
  );
}
export async function tripRead<K extends keyof DTO>(path: string, name: K, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    const response = await withReadSlot(bounded, () =>
      fetch(`/api/v1${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: bounded,
        headers: { Accept: "application/json" },
      }),
    );
    if (response.status !== 200) fail(response);
    const parsed = schema(name).safeParse(await response.json());
    if (!parsed.success) throw new TripFailure("unavailable");
    bounded.throwIfAborted();
    return { data: parsed.data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new TripFailure("unavailable");
  }
}
export type Attempt = { fingerprint: string; key: string };
export function attemptFor(fingerprint: string, previous: Attempt | null): Attempt {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID() };
}
export type TripSource = DTO["TripSummary"]["sourceKinds"][number];
/** The listTrips `source` vocabulary, typed against TripSummary.sourceKinds. */
export const tripSources = ["ets2telemetry", "manual"] as const satisfies readonly TripSource[];
/** Translation keys ("trips" namespace) of the source filter options. */
export const tripSourceLabels: Record<TripSource, "sourceTelemetry" | "sourceManual"> = {
  ets2telemetry: "sourceTelemetry",
  manual: "sourceManual",
};
export function tripFilters(params: URLSearchParams) {
  const scope = params.get("scope");
  const game = params.get("game");
  const decision = params.get("decision");
  const source = params.get("source");
  return {
    scope: scope === "company" ? "company" : "mine",
    game: game === "ats" || game === "ets2" ? game : undefined,
    decision: ["unassessed", "pending_review", "accepted", "rejected"].includes(decision ?? "")
      ? decision
      : undefined,
    // Unknown values mean "any source" and are never sent.
    source: tripSources.find((value) => value === source),
  };
}
/**
 * Next search after a filter change: set or clear one key and drop the cursor and selection.
 * Built from the current location string so rapid successive changes never read stale params.
 */
export function filterSearch(search: string, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(search);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete("cursor");
  next.delete("trip");
  return next;
}
export function canonicalDecimal(value: string): string | undefined {
  const clean = value.trim().replace(",", ".");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(clean) || clean.length > 64) return undefined;
  return clean.includes(".") ? clean.replace(/0+$/, "").replace(/\.$/, "") : clean;
}
export function revisionFields(revision: DTO["ManualRevisionRead"]): DTO["ManualReportReadFields"] {
  if ("representation" in revision) return revision.fields;
  const f = revision.fields,
    pin = (entityId: string): DTO["ManualResolvedSelection"] => ({
      status: "resolved",
      entityId,
    });
  return {
    game: f.game,
    origin: pin(f.originCityId),
    destination: pin(f.destinationCityId),
    cargo: pin(f.cargoId),
    trailerType: pin(f.trailerTypeId),
    cargoMassKg: f.cargoMassKg,
    actualDistanceM: f.actualDistanceM,
    evidenceIds: f.evidenceIds,
    eventId: f.eventId,
    comment: f.comment,
  };
}
export function proposalResult(value: DTO["Decision"] | DTO["TripProposal"]) {
  return "outcome" in value ? "decision" : "proposal";
}
export const validId = (value: string | undefined): value is string =>
  z.uuidv4().safeParse(value).success;
/** Side-panel selection from `?trip=`; anything but a canonical UUIDv4 selects nothing. */
export function selectedTrip(params: URLSearchParams): string | null {
  const value = params.get("trip") ?? undefined;
  return validId(value) ? value : null;
}
/** Search string selecting (or clearing) a trip while keeping filters; never carries a cursor. */
export function selectionSearch(params: URLSearchParams, id: string | null): string {
  const next = new URLSearchParams(params);
  if (id) next.set("trip", id);
  else next.delete("trip");
  next.delete("cursor");
  const query = next.toString();
  return query ? `?${query}` : "";
}
export function queryString(params: Record<string, string | number | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.toString();
}

/** Invalidate affected aggregates without rereading immutable uploads or unrelated event pages. */
export function commandAffects(path: string, resource: string) {
  if (path === "/evidence") return false;
  if (path.startsWith("/me/manual-drafts") && !path.endsWith("/submission"))
    return resource.startsWith("/me/manual-drafts");
  return (
    !resource.startsWith("/events") &&
    !resource.startsWith("/evidence") &&
    resource !== "/me/upload-policy"
  );
}
