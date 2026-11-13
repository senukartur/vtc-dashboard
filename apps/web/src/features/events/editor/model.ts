import { canonicalDecimal } from "../../trips/transport.js";
import { type DTO, utcInput } from "../model.js";
import { schema } from "../transport.js";

type DraftFields = DTO["EventStage2DraftInput"];
type CompleteFields = DTO["EventStage2Input"];

export type EditorEndpoint = {
  cityId: string | null;
  depotId: string | null;
  depot?: DTO["CatalogDepot"] | undefined;
};
export type RouteEnd = "origin" | "destination";
export type EditorForm = {
  title: string;
  description: string;
  game: CompleteFields["game"] | "";
  platform: CompleteFields["platform"] | "";
  server: string;
  visibility: CompleteFields["visibility"] | "";
  meetingAt: string;
  startsAt: string;
  endsAt: string;
  origin: EditorEndpoint;
  destination: EditorEndpoint;
  distanceKm: string;
  requiredDlcIds: string[];
  prescribedCargoId: string | null;
  prescribedMassKg: string;
  prescribedTrailerTypeId: string | null;
  organizerMemberId: string | null;
  legacyRoute: Pick<DraftFields, "route" | "meetingLocation">;
};
export type FieldName =
  | "title"
  | "description"
  | "game"
  | "platform"
  | "server"
  | "visibility"
  | "meetingAt"
  | "startsAt"
  | "endsAt"
  | "originCityId"
  | "destinationCityId"
  | "originDepotId"
  | "destinationDepotId"
  | "distanceKm"
  | "requiredDlcIds"
  | "prescribedCargoId"
  | "prescribedMassKg"
  | "prescribedTrailerTypeId"
  | "organizerMemberId";
type Issue =
  | "required"
  | "invalidValue"
  | "invalidNumber"
  | "invalidTime"
  | "meetingAfterStart"
  | "meetingAfterEnd"
  | "endBeforeStart"
  | "resolveDepot"
  | "wrongGame";
export type EditorErrors = Partial<Record<FieldName, Issue>>;

export function eventDefinitionSeed(member: DTO["EventStage2Member"]): DraftFields {
  const { event } = member;
  return {
    title: event.title,
    description: event.description,
    game: event.game,
    platform: event.platform,
    server: event.server,
    visibility: member.visibility,
    meetingAt: event.meetingAt,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    originCityId: event.origin?.entityId ?? null,
    destinationCityId: event.destination?.entityId ?? null,
    originDepotId: event.originDepot?.id ?? null,
    destinationDepotId: event.destinationDepot?.id ?? null,
    distanceKm: event.distanceKm,
    requiredDlcIds: event.requiredDlcs
      .filter(({ sources }) => sources.includes("manual"))
      .map(({ id }) => id),
    prescribedCargoId: member.prescribedCargoId,
    prescribedMassKg: member.prescribedMassKg,
    prescribedTrailerTypeId: member.prescribedTrailerTypeId,
    organizerMemberId: member.organizerMemberId,
  };
}

function endpoint(cityId: string | null = null, depotId: string | null = null): EditorEndpoint {
  return { cityId, depotId };
}

export function initialEventEditor(fields?: DraftFields, keepLegacyRoute = false): EditorForm {
  return {
    title: fields?.title ?? "",
    description: fields?.description ?? "",
    game: fields?.game ?? (fields ? "" : "ets2"),
    platform: fields?.platform ?? "",
    server: fields?.server ?? "",
    visibility: fields?.visibility ?? (fields ? "" : "members"),
    meetingAt: fields?.meetingAt?.slice(0, -1) ?? "",
    startsAt: fields?.startsAt?.slice(0, -1) ?? "",
    endsAt: fields?.endsAt?.slice(0, -1) ?? "",
    origin: endpoint(fields?.originCityId, fields?.originDepotId),
    destination: endpoint(fields?.destinationCityId, fields?.destinationDepotId),
    distanceKm: fields?.distanceKm ?? "",
    requiredDlcIds: fields?.requiredDlcIds ?? [],
    prescribedCargoId: fields?.prescribedCargoId ?? null,
    prescribedMassKg: fields?.prescribedMassKg ?? "",
    prescribedTrailerTypeId: fields?.prescribedTrailerTypeId ?? null,
    organizerMemberId: fields?.organizerMemberId ?? null,
    legacyRoute: keepLegacyRoute
      ? {
          ...(fields?.route !== undefined && { route: fields.route }),
          ...(fields?.meetingLocation !== undefined && { meetingLocation: fields.meetingLocation }),
        }
      : {},
  };
}

export const clearLegacyRoute = { route: null, meetingLocation: null } as const;

export function changeEditorGame(form: EditorForm, game: EditorForm["game"]): EditorForm {
  if (form.game === game) return form;
  return {
    ...form,
    game,
    server: "",
    origin: endpoint(),
    destination: endpoint(),
    distanceKm: "",
    requiredDlcIds: [],
    prescribedCargoId: null,
    prescribedMassKg: "",
    prescribedTrailerTypeId: null,
    legacyRoute: clearLegacyRoute,
  };
}

export function changeEditorCity(
  form: EditorForm,
  end: RouteEnd,
  cityId: string | null,
): EditorForm {
  if (form[end].cityId === cityId) return form;
  return { ...form, [end]: endpoint(cityId), legacyRoute: clearLegacyRoute };
}

export function changeEditorDepot(
  form: EditorForm,
  end: RouteEnd,
  depot: DTO["CatalogDepot"] | null,
): EditorForm {
  const depotId = depot?.id ?? null;
  return {
    ...form,
    [end]: { ...form[end], depotId, depot: depot ?? undefined },
    legacyRoute: form[end].depotId === depotId ? form.legacyRoute : clearLegacyRoute,
  };
}

const timeFields = ["meetingAt", "startsAt", "endsAt"] as const;
const publishFields = [
  "title",
  "game",
  "platform",
  "server",
  "visibility",
  "meetingAt",
  "startsAt",
  "originCityId",
  "destinationCityId",
  "organizerMemberId",
] as const;

export function validateEventEditor(
  form: EditorForm,
  blockedDepots: readonly RouteEnd[] = [],
  catalogErrors: EditorErrors = {},
) {
  const errors = { ...catalogErrors };
  for (const end of ["origin", "destination"] as const) {
    const { cityId, depotId, depot } = form[end];
    if (
      depotId &&
      (!cityId ||
        (depot && (depot.id !== depotId || depot.city.id !== cityId || depot.game !== form.game)))
    ) {
      errors[`${end}DepotId`] = "resolveDepot";
    }
  }
  const times = { meetingAt: null, startsAt: null, endsAt: null } as Record<
    (typeof timeFields)[number],
    string | null
  >;
  for (const name of timeFields) {
    if (!form[name]) continue;
    const instant = utcInput(form[name]);
    if (instant) times[name] = instant;
    else errors[name] = "invalidTime";
  }
  const { meetingAt, startsAt, endsAt } = times;
  if (meetingAt && startsAt && meetingAt > startsAt) errors.meetingAt = "meetingAfterStart";
  if (endsAt && startsAt && endsAt < startsAt) errors.endsAt = "endBeforeStart";
  if (meetingAt && endsAt && meetingAt > endsAt) errors.meetingAt ??= "meetingAfterEnd";

  const numbers = { distanceKm: null, prescribedMassKg: null } as Record<
    "distanceKm" | "prescribedMassKg",
    string | null
  >;
  for (const key of ["distanceKm", "prescribedMassKg"] as const) {
    if (!form[key].trim()) continue;
    const decimal = canonicalDecimal(form[key]);
    if (decimal !== undefined) numbers[key] = decimal;
    else errors[key] = "invalidNumber";
  }

  const fields: DraftFields = {
    title: form.title.trim() || null,
    description: form.description.trim() || null,
    game: form.game || null,
    platform: form.platform || null,
    server: form.server.trim() || null,
    visibility: form.visibility || null,
    ...times,
    originCityId: form.origin.cityId,
    originDepotId: form.origin.depotId,
    destinationCityId: form.destination.cityId,
    destinationDepotId: form.destination.depotId,
    requiredDlcIds: form.requiredDlcIds,
    ...numbers,
    prescribedCargoId: form.prescribedCargoId,
    prescribedTrailerTypeId: form.prescribedTrailerTypeId,
    organizerMemberId: form.organizerMemberId,
    ...form.legacyRoute,
  };
  for (const end of blockedDepots) errors[`${end}DepotId`] = "resolveDepot";

  const draft = schema("EventStage2DraftInput").safeParse(fields);
  if (!draft.success) {
    for (const issue of draft.error.issues) {
      const key = issue.path[0];
      if (
        typeof key !== "string" ||
        !(key in fields) ||
        key === "route" ||
        key === "meetingLocation"
      )
        continue;
      const field = key as FieldName;
      errors[field] ??=
        field === "distanceKm" || field === "prescribedMassKg" ? "invalidNumber" : "invalidValue";
    }
  }
  const publishErrors = { ...errors };
  for (const key of publishFields) if (!fields[key]) publishErrors[key] ??= "required";
  const complete = schema("EventStage2Input").safeParse(fields);
  return {
    draftErrors: errors,
    publishErrors,
    draft: draft.success && !Object.keys(errors).length ? draft.data : undefined,
    complete: complete.success && !Object.keys(publishErrors).length ? complete.data : undefined,
  };
}

export function resolveDepotChoice(
  rows: readonly DTO["CatalogDepot"][],
  game: NonNullable<DraftFields["game"]>,
  cityId: string,
  companyId: string,
) {
  const exact = rows.filter(
    (depot) =>
      depot.game === game &&
      depot.city.id === cityId &&
      depot.company.id === companyId &&
      !depot.hidden &&
      !depot.city.label.hidden &&
      !depot.company.label.hidden,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

export function eventEditorDlcs(
  manualIds: readonly string[],
  derivedIds: readonly (string | null | undefined)[],
) {
  const sources = new Map<string, Set<DTO["EventStage2Dlc"]["sources"][number]>>();
  for (const id of derivedIds) if (id) sources.set(id, new Set(["from_city"]));
  for (const id of manualIds) {
    const source = sources.get(id) ?? new Set();
    source.add("manual");
    sources.set(id, source);
  }
  return [...sources].map(([id, source]) => ({ id, sources: [...source] }));
}

export const eventScreenshotLimit = 10;
export const eventScreenshotAccept = "image/png,image/jpeg";

export function eventScreenshotError(
  file: Pick<File, "type" | "size">,
  slots: number,
  maxBytes: number | null | undefined,
): "galleryFull" | "galleryType" | "gallerySize" | undefined {
  if (slots >= eventScreenshotLimit) return "galleryFull";
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size <= 0) return "galleryType";
  if (maxBytes && file.size > maxBytes) return "gallerySize";
  return undefined;
}
