import { canonicalDecimal } from "../../trips/transport.js";
import { utcInput } from "../model.js";
import {
  changeEditorGame,
  clearLegacyRoute,
  type EditorEndpoint,
  type EditorForm,
  type FieldName,
} from "./model.js";

const independentFields = [
  "title",
  "description",
  "platform",
  "visibility",
  "meetingAt",
  "startsAt",
  "endsAt",
  "organizerMemberId",
] as const;
const gameFields = [
  "server",
  "distanceKm",
  "prescribedCargoId",
  "prescribedMassKg",
  "prescribedTrailerTypeId",
] as const;
const ends = ["origin", "destination"] as const;
const endpointFields = ["cityId", "depotId"] as const;
type ScalarField = (typeof independentFields)[number] | (typeof gameFields)[number];
type Overlap = { field: FieldName; local: string | null; saved: string | null };

function canonical(field: ScalarField, value: string | null) {
  const clean = value?.trim() || null;
  if (!clean) return null;
  if (field === "distanceKm" || field === "prescribedMassKg")
    return canonicalDecimal(clean) ?? clean;
  if (field === "meetingAt" || field === "startsAt" || field === "endsAt")
    return utcInput(clean) ?? clean;
  return clean;
}

function sameEndpoint(a: EditorEndpoint, b: EditorEndpoint) {
  return a.cityId === b.cityId && a.depotId === b.depotId;
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function rebaseEventEditor(base: EditorForm, local: EditorForm, saved: EditorForm) {
  const form = { ...saved };
  const overlaps: Overlap[] = [];
  const skipped: FieldName[] = [];

  function apply<K extends ScalarField>(field: K, previous: EditorForm, force = false) {
    const before = canonical(field, previous[field]);
    const mine = canonical(field, local[field]);
    const theirs = canonical(field, saved[field]);
    if (mine === theirs || (!force && mine === before)) return;
    if (theirs !== before) overlaps.push({ field, local: mine, saved: theirs });
    form[field] = local[field];
  }

  for (const field of independentFields) apply(field, base);

  const localGameChanged = local.game !== base.game;
  const savedGameChanged = saved.game !== base.game;
  const switchGame = localGameChanged && !savedGameChanged;
  const comparison =
    localGameChanged && local.game === saved.game ? changeEditorGame(base, local.game) : base;

  if (local.game !== saved.game && !switchGame) {
    if (localGameChanged) skipped.push("game");
    for (const field of gameFields) {
      if (canonical(field, local[field]) !== canonical(field, base[field])) skipped.push(field);
    }
    for (const end of ends) {
      for (const key of endpointFields) {
        if (local[end][key] !== base[end][key])
          skipped.push(`${end}${key === "cityId" ? "CityId" : "DepotId"}`);
      }
    }
    if (!sameIds(local.requiredDlcIds, base.requiredDlcIds)) skipped.push("requiredDlcIds");
    return { form, overlaps, skipped };
  }

  if (switchGame) form.game = local.game;
  for (const field of gameFields) apply(field, comparison, switchGame);
  for (const end of ends) {
    const before = comparison[end];
    const mine = local[end];
    const theirs = saved[end];
    if (!switchGame && sameEndpoint(before, mine)) continue;
    if (!switchGame && mine.cityId === before.cityId && theirs.cityId !== mine.cityId) {
      skipped.push(`${end}DepotId`);
      continue;
    }
    const proposed =
      !switchGame && mine.cityId === theirs.cityId && mine.cityId !== before.cityId && !mine.depotId
        ? theirs
        : mine;
    for (const key of endpointFields) {
      if (theirs[key] !== before[key] && theirs[key] !== proposed[key]) {
        overlaps.push({
          field: `${end}${key === "cityId" ? "CityId" : "DepotId"}`,
          local: proposed[key],
          saved: theirs[key],
        });
      }
    }
    form[end] = proposed;
  }

  if (switchGame) {
    form.requiredDlcIds = local.requiredDlcIds;
    if (
      !sameIds(base.requiredDlcIds, saved.requiredDlcIds) &&
      !sameIds(local.requiredDlcIds, saved.requiredDlcIds)
    ) {
      overlaps.push({
        field: "requiredDlcIds",
        local: local.requiredDlcIds.join(", ") || null,
        saved: saved.requiredDlcIds.join(", ") || null,
      });
    }
  } else {
    const localIds = new Set(local.requiredDlcIds);
    const oldIds = new Set(comparison.requiredDlcIds);
    const retained = saved.requiredDlcIds.filter((id) => !oldIds.has(id) || localIds.has(id));
    const added = local.requiredDlcIds.filter((id) => !oldIds.has(id));
    form.requiredDlcIds = [...new Set([...retained, ...added])];
  }

  if (switchGame || ends.some((end) => !sameEndpoint(form[end], saved[end])))
    form.legacyRoute = clearLegacyRoute;
  return { form, overlaps, skipped };
}

export type EventEditorRebase = ReturnType<typeof rebaseEventEditor>;
