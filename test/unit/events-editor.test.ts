import { expect, test } from "vitest";
import {
  changeEditorCity,
  changeEditorGame,
  eventDefinitionSeed,
  eventEditorDlcs,
  eventScreenshotError,
  initialEventEditor,
  resolveDepotChoice,
  validateEventEditor,
} from "../../apps/web/src/features/events/editor/model.ts";
import type { DTO } from "../../apps/web/src/features/events/model.ts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";

const member = () =>
  (stage2Fixture("getEvent", "structured").response as DTO["EventStage2EnvelopeMember"]).data;
const completeForm = () => initialEventEditor(eventDefinitionSeed(member()));

test("a draft can omit fields while publication reports every missing required field", () => {
  const result = validateEventEditor(initialEventEditor({}));
  expect(result.draft).toBeDefined();
  expect(result.draftErrors).toEqual({});
  expect(result.complete).toBeUndefined();
  expect(result.publishErrors).toEqual({
    title: "required",
    server: "required",
    game: "required",
    platform: "required",
    visibility: "required",
    meetingAt: "required",
    startsAt: "required",
    originCityId: "required",
    destinationCityId: "required",
    organizerMemberId: "required",
  });
});

test("both save actions check supplied dates without requiring absent draft dates", () => {
  const form = {
    ...completeForm(),
    meetingAt: "2099-02-01T19:00",
    startsAt: "2099-02-01T18:00",
    endsAt: "2099-02-01T17:00",
  };
  const reversed = validateEventEditor(form);
  expect(reversed.draft).toBeUndefined();
  expect(reversed.complete).toBeUndefined();
  expect(reversed.draftErrors).toEqual({
    meetingAt: "meetingAfterStart",
    endsAt: "endBeforeStart",
  });
  expect(
    validateEventEditor({ ...form, meetingAt: "2099-02-29T18:00", endsAt: "" }).draftErrors,
  ).toEqual({ meetingAt: "invalidTime" });
  expect(
    validateEventEditor({ ...form, meetingAt: form.startsAt, endsAt: form.startsAt }).complete,
  ).toMatchObject({ meetingAt: "2099-02-01T18:00:00.000Z", endsAt: "2099-02-01T18:00:00.000Z" });
});

test("distance keeps exact decimal precision and distinguishes zero from absence", () => {
  const form = completeForm();
  for (const [value, expected] of [
    ["", null],
    ["0", "0"],
    ["0,000", "0"],
    ["501,250", "501.25"],
    ["99999999999999999999.123456789012345678", "99999999999999999999.123456789012345678"],
  ] as const) {
    const result = validateEventEditor({ ...form, distanceKm: value });
    expect(result.draft?.distanceKm).toBe(expected);
    expect(result.complete?.distanceKm).toBe(expected);
  }
  for (const invalid of ["-1", "1e3", "1,2.3", "100000000000000000000", "0.0000000000000000001"]) {
    const result = validateEventEditor({ ...form, distanceKm: invalid });
    expect(result.draftErrors.distanceKm).toBe("invalidNumber");
    expect(result.draft).toBeUndefined();
  }
});

test("changing a route city clears only that endpoint and changing game clears game-bound selections", () => {
  const form = completeForm();
  const resetOrigin = changeEditorCity(form, "origin", null);
  expect(resetOrigin.origin).toEqual({ cityId: null, depotId: null });
  expect(resetOrigin.destination).toEqual(form.destination);
  expect(resetOrigin.requiredDlcIds).toEqual(form.requiredDlcIds);
  expect(changeEditorCity(form, "origin", form.origin.cityId)).toBe(form);
  const resetGame = changeEditorGame(form, "ats");
  expect(resetGame).toMatchObject({
    game: "ats",
    server: "",
    distanceKm: "",
    origin: { cityId: null, depotId: null },
    destination: { cityId: null, depotId: null },
    requiredDlcIds: [],
    prescribedCargoId: null,
    prescribedTrailerTypeId: null,
    title: form.title,
    organizerMemberId: form.organizerMemberId,
    startsAt: form.startsAt,
  });
});

test("DLC overlap retains both sources and removing manual provenance keeps a route requirement", () => {
  const manual = "e1320000-0000-4000-8000-000000000007";
  const both = "e1320000-0000-4000-8000-000000000008";
  const derived = "e1320000-0000-4000-8000-000000000009";
  expect(eventEditorDlcs([manual, both, manual], [null, both, both, derived, undefined])).toEqual([
    { id: both, sources: ["from_city", "manual"] },
    { id: derived, sources: ["from_city"] },
    { id: manual, sources: ["manual"] },
  ]);
  expect(eventEditorDlcs([], [both])).toEqual([{ id: both, sources: ["from_city"] }]);
});

test("a duplicate seed carries only editable definitions and only manual DLC IDs", () => {
  const source = member();
  const seed = eventDefinitionSeed(source);
  expect(seed).toMatchObject({
    title: source.event.title,
    originDepotId: source.event.originDepot?.id,
    organizerMemberId: source.organizerMemberId,
    requiredDlcIds: source.event.requiredDlcs
      .filter(({ sources }) => sources.includes("manual"))
      .map(({ id }) => id),
  });
  expect(seed).not.toHaveProperty("id");
  expect(seed).not.toHaveProperty("hasCover");
  expect(seed).not.toHaveProperty("media");
  expect(seed).not.toHaveProperty("route");
  expect(seed).not.toHaveProperty("meetingLocation");
});

test("depot resolution uses the exact visible company and city pair", () => {
  const companyId = "e1320000-0000-4000-8000-000000000015";
  const cityId = "e1320000-0000-4000-8000-000000000002";
  const label = (entityId: string) =>
    ({
      entityId,
      label: "Fictional catalog row",
      requestedLocale: "en",
      renderedLocale: "en",
      englishFallback: false,
      hidden: false,
    }) as const;
  const depot: DTO["CatalogDepot"] = {
    id: "e1320000-0000-4000-8000-000000000004",
    game: "ets2",
    hidden: false,
    dlcId: null,
    dlc: null,
    city: { id: cityId, code: "synthetic_city", label: label(cityId) },
    company: { id: companyId, code: "synthetic_company", label: label(companyId), logo: null },
  };
  expect(resolveDepotChoice([depot], "ets2", cityId, companyId)?.id).toBe(depot.id);
  expect(resolveDepotChoice([depot], "ats", cityId, companyId)).toBeUndefined();
  expect(resolveDepotChoice([depot, depot], "ets2", cityId, companyId)).toBeUndefined();
  expect(
    resolveDepotChoice([{ ...depot, hidden: true }], "ets2", cityId, companyId),
  ).toBeUndefined();
  expect(
    resolveDepotChoice(
      [
        {
          ...depot,
          company: { ...depot.company, label: { ...depot.company.label, hidden: true } },
        },
      ],
      "ets2",
      cityId,
      companyId,
    ),
  ).toBeUndefined();
  const pending = validateEventEditor(completeForm(), ["origin"]);
  expect(pending.draftErrors.originDepotId).toBe("resolveDepot");
  expect(pending.complete).toBeUndefined();
});

test("screenshot validation uses 10 slots, two image types and only the known byte ceiling", () => {
  const png = { type: "image/png", size: 100 };
  expect(eventScreenshotError(png, 9, 100)).toBeUndefined();
  expect(eventScreenshotError(png, 10, 100)).toBe("galleryFull");
  expect(eventScreenshotError(png, 0, 99)).toBe("gallerySize");
  expect(eventScreenshotError(png, 0, null)).toBeUndefined();
  expect(eventScreenshotError({ type: "image/jpeg", size: 100 }, 0, 100)).toBeUndefined();
  expect(eventScreenshotError({ type: "image/webp", size: 1 }, 0, 100)).toBe("galleryType");
  expect(eventScreenshotError({ type: "image/jpeg", size: 0 }, 0, 100)).toBe("galleryType");
});
