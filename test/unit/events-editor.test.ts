import { expect, test } from "vitest";
import {
  draftEditorReads,
  editorGalleryReads,
  publishedEditorReads,
} from "../../apps/web/src/features/events/editor/command-reads.ts";
import {
  changeEditorCity,
  changeEditorDepot,
  changeEditorGame,
  eventDefinitionSeed,
  eventEditorDlcs,
  eventScreenshotError,
  initialEventEditor,
  resolveDepotChoice,
  validateEventEditor,
} from "../../apps/web/src/features/events/editor/model.ts";
import {
  incompleteOverlapTime,
  rebaseEventEditor,
} from "../../apps/web/src/features/events/editor/rebase.ts";
import {
  fromMoscow,
  moveSchedule,
  toMoscow,
} from "../../apps/web/src/features/events/editor/schedule.ts";
import type { DTO } from "../../apps/web/src/features/events/model.ts";
import {
  eventStage2QueryPrefix,
  eventUpcomingQueryPrefix,
  landingConvoysQueryName,
} from "../../apps/web/src/features/events/stage-2-model.ts";
import {
  type EventStage2Envelope,
  type EventStage2Read,
  eventStage2Content,
  eventStage2Reads,
} from "../../apps/web/src/features/events/stage-2-transport.ts";
import { emptyTime, incompleteValue } from "../../apps/web/src/shared/ui/date-time.ts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";

const member = () =>
  (stage2Fixture("getEvent", "structured").response as DTO["EventStage2EnvelopeMember"]).data;
const completeForm = () => initialEventEditor(eventDefinitionSeed(member()));

const eventId = "e1320000-0000-4000-8000-000000000001";
const mediaId = "e1320000-0000-4000-8000-000000000002";
const readKey = ({ access, path, schema }: EventStage2Read<EventStage2Envelope>) => [
  eventStage2QueryPrefix,
  access === "public" ? "public" : "session",
  access,
  path,
  schema,
];
const draftKey = readKey(eventStage2Reads.draft(eventId));
const draftsKey = readKey(eventStage2Reads.adminList({ period: "drafts", locale: "ru" }));
const adminGalleryKey = readKey(eventStage2Reads.adminMedia(eventId));
const memberGalleryKey = readKey(eventStage2Reads.memberMedia(eventId));
const upcoming = eventStage2Reads.upcoming();
const upcomingKey = [
  eventUpcomingQueryPrefix,
  "session",
  eventStage2QueryPrefix,
  upcoming.access,
  upcoming.path,
  upcoming.schema,
];
const thumbKey = [
  eventStage2QueryPrefix,
  "session",
  "company.read",
  eventStage2Content.member(eventId, mediaId, "thumb").path,
  "image",
];

test("draft writes refresh their own definition and draft list without touching upcoming or media", () => {
  const save = draftEditorReads(eventId, false);
  const beforePublish = draftEditorReads(eventId, true);
  expect(save(draftKey, "success")).toBe(true);
  expect(save(draftsKey, "success")).toBe(true);
  expect(save(readKey(eventStage2Reads.draft(mediaId)), "success")).toBe(false);
  expect(save(readKey(eventStage2Reads.adminList({ period: "published" })), "success")).toBe(false);
  expect(beforePublish(draftKey, "success")).toBe(false);
  expect(beforePublish(draftsKey, "success")).toBe(true);
  expect(beforePublish(draftKey, "conflict")).toBe(true);
  for (const key of [adminGalleryKey, memberGalleryKey, thumbKey, upcomingKey]) {
    expect(save(key, "success")).toBe(false);
    expect(save(key, "conflict")).toBe(false);
  }
});

test("publication refreshes event projections without reloading already confirmed gallery content", () => {
  const publish = publishedEditorReads(eventId, "draft");
  const memberDetail = readKey(eventStage2Reads.memberDetail(eventId, "ru"));
  const landing = ["public-events", "/public/events?period=upcoming", landingConvoysQueryName];
  for (const key of [draftKey, draftsKey, upcomingKey, memberDetail, landing]) {
    expect(publish(key, "success")).toBe(true);
  }
  for (const key of [adminGalleryKey, memberGalleryKey, thumbKey]) {
    expect(publish(key, "success")).toBe(false);
  }
  expect(publish(draftKey, "conflict")).toBe(true);
  expect(publishedEditorReads(eventId, "published")(memberDetail, "conflict")).toBe(true);
});

test("gallery writes refresh only affected projections and keep immutable thumbnails", () => {
  const upload = editorGalleryReads(eventId, true);
  const edit = editorGalleryReads(eventId, true, { coverChanged: false });
  const cover = editorGalleryReads(eventId, true, { coverChanged: true });
  const memberList = readKey(eventStage2Reads.memberList());
  const publicCover = [
    eventStage2QueryPrefix,
    "public",
    "public",
    eventStage2Content.publicCover(eventId).path,
    "image",
  ];
  expect(upload(adminGalleryKey, "conflict")).toBe(true);
  expect(upload(readKey(eventStage2Reads.adminMedia(mediaId)), "conflict")).toBe(false);
  expect(upload(adminGalleryKey, "success")).toBe(false);
  expect(upload(memberGalleryKey, "success")).toBe(false);
  expect(edit(memberGalleryKey, "success")).toBe(true);
  expect(edit(memberList, "success")).toBe(false);
  expect(edit(publicCover, "success")).toBe(false);
  expect(cover(memberList, "success")).toBe(true);
  expect(cover(publicCover, "success")).toBe(true);
  expect(editorGalleryReads(eventId, false, { coverChanged: true })(publicCover, "success")).toBe(
    false,
  );
  for (const key of [draftKey, draftsKey, thumbKey, upcomingKey]) {
    expect(cover(key, "success")).toBe(false);
    expect(cover(key, "conflict")).toBe(false);
  }
});

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
  const incompatible = validateEventEditor({
    ...completeForm(),
    origin: { cityId, depotId: depot.id, depot: { ...depot, game: "ats" } },
  });
  expect(incompatible.draftErrors.originDepotId).toBe("resolveDepot");
  expect(incompatible.complete).toBeUndefined();
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

test("rebasing a local title preserves the refreshed canonical depot, distance and description", () => {
  const base = completeForm();
  const local = { ...base, title: "Fictional local title", distanceKm: "0,000" };
  const saved = {
    ...base,
    title: "Fictional concurrent title",
    description: "Fictional concurrent description",
    distanceKm: "55",
    origin: { ...base.origin, depotId: "e1320000-0000-4000-8000-000000000019" },
  };
  const result = rebaseEventEditor(base, local, saved);
  expect(result.overlaps).toEqual([{ field: "title", local: local.title, saved: saved.title }]);
  expect(result.skipped).toEqual([]);
  expect(validateEventEditor(result.form).complete).toMatchObject({
    title: local.title,
    description: saved.description,
    originDepotId: saved.origin.depotId,
    distanceKm: "55",
  });
});

test("an incomplete local time overlaps as translated text and is kept for Keep my edits", () => {
  const base = completeForm();
  const marker = incompleteValue("25.10.20", { ...emptyTime, hours: "14", minutes: "00" });
  const local = { ...base, startsAt: marker };
  const saved = { ...base, startsAt: "2099-10-25T16:00:00.000" };
  const result = rebaseEventEditor(base, local, saved);
  expect(result.overlaps).toEqual([
    { field: "startsAt", local: marker, saved: "2099-10-25T16:00:00.000Z" },
  ]);
  // Keeping my edits restores the incomplete entry into the field.
  expect(result.form.startsAt).toBe(marker);
  expect(incompleteOverlapTime("startsAt", marker)).toBe(true);
  expect(incompleteOverlapTime("startsAt", "2099-10-25T16:00:00.000Z")).toBe(false);
  expect(incompleteOverlapTime("startsAt", null)).toBe(false);
  expect(incompleteOverlapTime("title", marker)).toBe(false);
});

test("rebasing a depot change against a different saved city preserves the new city and depot", () => {
  const base = completeForm();
  const local = {
    ...base,
    origin: { ...base.origin, depotId: "e1320000-0000-4000-8000-000000000019" },
  };
  const saved = {
    ...base,
    origin: {
      cityId: "e1320000-0000-4000-8000-000000000020",
      depotId: "e1320000-0000-4000-8000-000000000021",
    },
  };
  const result = rebaseEventEditor(base, local, saved);
  expect(result.form.origin).toEqual(saved.origin);
  expect(result.skipped).toEqual(["originDepotId"]);
});

test("a concurrent game change retains its catalog selections and still reapplies independent edits", () => {
  const base = completeForm();
  const local = {
    ...base,
    title: "Fictional local title",
    distanceKm: "120",
    prescribedCargoId: "e1320000-0000-4000-8000-000000000019",
  };
  const saved = {
    ...changeEditorGame(base, "ats"),
    server: "Fictional ATS server",
    prescribedCargoId: "e1320000-0000-4000-8000-000000000021",
  };
  const result = rebaseEventEditor(base, local, saved);
  expect(result.form).toEqual({ ...saved, title: local.title });
  expect(result.skipped).toEqual(["distanceKm", "prescribedCargoId"]);
});

test("independent manual DLC changes survive rebase", () => {
  const removed = "e1320000-0000-4000-8000-000000000019";
  const localId = "e1320000-0000-4000-8000-000000000020";
  const savedId = "e1320000-0000-4000-8000-000000000021";
  const base = { ...completeForm(), requiredDlcIds: [removed] };
  const local = { ...base, requiredDlcIds: [localId] };
  const saved = { ...base, requiredDlcIds: [removed, savedId] };
  expect(rebaseEventEditor(base, local, saved).form.requiredDlcIds).toEqual([savedId, localId]);
});

test("changing to the same game in both versions does not apply old-game resets over new selections", () => {
  const base = completeForm();
  const local = changeEditorGame(base, "ats");
  const saved = {
    ...local,
    server: "Fictional ATS server",
    origin: {
      cityId: "e1320000-0000-4000-8000-000000000020",
      depotId: "e1320000-0000-4000-8000-000000000021",
    },
    distanceKm: "70",
  };
  expect(rebaseEventEditor(base, local, saved)).toMatchObject({
    form: saved,
    overlaps: [],
    skipped: [],
  });
});

test("route changes explicitly clear legacy text while unrelated edits retain it", () => {
  const text = { route: "Fictional previous route", meetingLocation: "Fictional previous depot" };
  const cleared = { route: null, meetingLocation: null };
  const base = initialEventEditor({ ...eventDefinitionSeed(member()), ...text }, true);
  expect(validateEventEditor({ ...base, title: "Fictional new title" }).complete).toMatchObject(
    text,
  );
  expect(validateEventEditor(changeEditorGame(base, "ats")).draft).toMatchObject(cleared);
  expect(validateEventEditor(changeEditorDepot(base, "origin", null)).complete).toMatchObject(
    cleared,
  );
  const local = changeEditorCity(base, "origin", "e1320000-0000-4000-8000-000000000019");
  expect(validateEventEditor(local).complete).toMatchObject(cleared);
  const saved = { ...base, legacyRoute: { ...text, route: "Fictional concurrent route" } };
  expect(validateEventEditor(rebaseEventEditor(base, local, saved).form).complete).toMatchObject(
    cleared,
  );
  expect(
    validateEventEditor(
      rebaseEventEditor(base, { ...base, title: "Fictional new title" }, saved).form,
    ).complete,
  ).toMatchObject(saved.legacyRoute);
});

test("a sparse draft still checks meeting against end when start is absent", () => {
  const form = {
    ...initialEventEditor({}),
    meetingAt: "2099-01-01T12:00",
    endsAt: "2099-01-01T11:00",
  };
  const result = validateEventEditor(form);
  expect(result.draftErrors).toEqual({ meetingAt: "meetingAfterEnd" });
  expect(result.draft).toBeUndefined();
  expect(validateEventEditor({ ...form, endsAt: form.meetingAt }).draft).toBeDefined();
});

test("Stage 2 schedule values convert between Moscow field values and UTC wall clocks", () => {
  expect(toMoscow("2099-10-25T12:00:00.000")).toEqual({ date: "2099-10-25", time: "15:00" });
  expect(toMoscow("2099-10-25T14:00:30.500")).toEqual({ date: "2099-10-25", time: "17:00:30.500" });
  expect(fromMoscow("2099-10-25", "01:00")).toBe("2099-10-24T22:00");
  expect(fromMoscow("2099-10-25", "")).toBe("");
  expect(fromMoscow("", "")).toBe("");
  expect(toMoscow("")).toEqual({ date: "", time: "" });
});

test("incomplete Stage 2 dates and times stay in the form as invalid times and read back", () => {
  const time = incompleteValue("", { ...emptyTime, hours: "1" });
  const date = incompleteValue("25.10.20", emptyTime);
  const timeOnly = fromMoscow("2099-10-25", time);
  // The time field gets exactly its own value back, so a re-render keeps the typed digits.
  expect(toMoscow(timeOnly)).toEqual({ date: "2099-10-25", time });
  const dateOnly = fromMoscow(date, "15:00");
  expect(toMoscow(dateOnly)).toEqual({ date, time: "15:00" });
  // A time without a date and a typed date without a time are not silently empty.
  expect(toMoscow(fromMoscow("", "15:00"))).toEqual({ date: "", time: "15:00" });
  expect(toMoscow(fromMoscow(date, ""))).toEqual({ date, time: "" });
  const form = completeForm();
  for (const startsAt of [timeOnly, dateOnly, fromMoscow("", "15:00")])
    expect(validateEventEditor({ ...form, startsAt }).draftErrors.startsAt).toBe("invalidTime");
});

test("moving the Stage 2 shared date shifts complete times and keeps incomplete entries", () => {
  const schedule = {
    meetingAt: "2099-10-24T20:30",
    startsAt: "2099-10-24T22:00",
    endsAt: "2099-10-25T21:15",
  };
  expect(moveSchedule(schedule, "2099-10-25", "2099-10-27")).toEqual({
    meetingAt: "2099-10-26T20:30",
    startsAt: "2099-10-26T22:00",
    endsAt: "2099-10-27T21:15",
  });
  // An incomplete shared date keeps the times of the fields on that date as invalid entries.
  const typed = incompleteValue("27.10", emptyTime);
  const pending = moveSchedule(schedule, "2099-10-25", typed);
  expect(pending.meetingAt).toBe(schedule.meetingAt);
  expect(pending.endsAt).toBe(schedule.endsAt);
  expect(toMoscow(pending.startsAt)).toEqual({ date: typed, time: "01:00" });
  expect(moveSchedule(pending, typed, "2099-10-27")).toEqual({
    meetingAt: schedule.meetingAt,
    startsAt: "2099-10-26T22:00",
    endsAt: schedule.endsAt,
  });
  // Values on another date do not follow an incomplete shared date and stay byte-identical.
  const exact = { meetingAt: "2099-10-25T12:00:00.000", startsAt: "", endsAt: "" };
  expect(moveSchedule(exact, "2099-10-26", typed)).toEqual(exact);
  expect(moveSchedule(exact, typed, "2099-10-27")).toEqual(exact);
});
