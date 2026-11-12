import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";
const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const input = {
  title: "Fictional convoy",
  description: "Fictional event description",
  game: "ets2",
  server: "Fictional server",
  organizer: "Fictional company",
  route: "Fictional route",
  meetingLocation: "Fictional meeting location",
  meetingAt: "2026-10-25T00:30:00.000Z",
  startsAt: "2026-10-25T01:30:00.000Z",
  endsAt: null,
  visibility: "members",
  originCityId: null,
  destinationCityId: null,
  prescribedCargoId: null,
  prescribedMassKg: null,
  prescribedTrailerTypeId: null,
};
test("event contract requires explicit server/meeting/organizer/route facts and closes privacy DTOs", () => {
  expect(valid("EventInput")(input)).toBe(true);
  for (const field of ["server", "organizer", "meetingAt", "meetingLocation", "route"]) {
    const bad = { ...input } as Record<string, unknown>;
    delete bad[field];
    expect(valid("EventInput")(bad)).toBe(false);
  }
  const publicEvent = {
    id: "10000000-0000-4000-8000-000000000001",
    version: 1,
    title: input.title,
    description: input.description,
    game: input.game,
    server: input.server,
    organizer: input.organizer,
    route: input.route,
    meetingLocation: input.meetingLocation,
    meetingAt: input.meetingAt,
    startsAt: input.startsAt,
    endsAt: null,
    status: "scheduled",
    origin: null,
    destination: null,
  };
  expect(valid("EventPublic")(publicEvent)).toBe(true);
  for (const field of ["participants", "declineReason", "note", "privateReason", "actorId"])
    expect(valid("EventPublic")({ ...publicEvent, [field]: "Fictional private value" })).toBe(
      false,
    );
});
test("RSVP and attendance contract separate decline reason and actual confirmation", () => {
  expect(valid("RsvpInput")({ response: "declined", reason: "Fictional private reason" })).toBe(
    true,
  );
  for (const value of [
    { response: "declined" },
    { response: "declined", reason: "" },
    { response: "participating", reason: "Fictional reason" },
    { response: "attended" },
  ])
    expect(valid("RsvpInput")(value)).toBe(false);
  expect(valid("AttendanceInput")({ members: [] })).toBe(false);
  expect(
    valid("AttendanceInput")({
      members: [
        { memberId: "10000000-0000-4000-8000-000000000001", attendance: "attended", note: null },
      ],
    }),
  ).toBe(true);
});
test("event response counts expose only participating/declined totals", () => {
  expect(valid("EventResponseCounts")({ participating: 0, declined: 0 })).toBe(true);
  expect(valid("EventResponseCounts")({ participating: 3, declined: 2 })).toBe(true);
  for (const value of [
    { participating: 1 },
    { declined: 1 },
    { participating: 1, declined: 1, unanswered: 4 },
    { participating: 1, declined: 1, names: ["Fictional member"] },
    { participating: 1, declined: 1, declineReason: "Fictional private reason" },
    { participating: -1, declined: 0 },
    { participating: 0, declined: 1.5 },
    { participating: "1", declined: 0 },
  ])
    expect(valid("EventResponseCounts")(value)).toBe(false);
  const decliner = {
    member: {
      id: "10000000-0000-4000-8000-000000000002",
      nickname: "Fictional decliner",
      formerMember: false,
      roles: ["trainee"],
    },
  };
  expect(valid("Participant")(decliner)).toBe(true);
  expect(valid("Participant")({ ...decliner, declineReason: "Fictional private reason" })).toBe(
    false,
  );
});

test("Stage 2 draft and publication inputs accept distinct lifecycle commands", () => {
  const create = valid("EventStage2CreationInput");
  const complete = {
    title: input.title,
    game: input.game,
    platform: "haulmp",
    server: input.server,
    organizerMemberId: "10000000-0000-4000-8000-000000000001",
    meetingAt: input.meetingAt,
    startsAt: input.startsAt,
    endsAt: null,
    visibility: input.visibility,
    originCityId: null,
    destinationCityId: null,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
    requiredDlcIds: [],
    distanceKm: "0",
  };
  expect(create({ draft: true })).toBe(true);
  expect(create({ draft: true, title: input.title, game: null })).toBe(true);
  expect(create(complete)).toBe(true);
  expect(create({ ...complete, draft: false })).toBe(true);
  expect(create({ ...complete, platform: undefined })).toBe(false);
  expect(create({ draft: false, title: input.title })).toBe(false);
  for (const bad of [
    { ...complete, organizer: "Fictional arbitrary organizer" },
    { ...complete, distanceKm: -1 },
    { ...complete, distanceKm: "-1" },
    { ...complete, distanceKm: "0.00" },
    { ...complete, platform: "convoy" },
    { ...complete, originDepotId: "unknown-depot" },
    { ...complete, requiredDlcIds: [complete.organizerMemberId, complete.organizerMemberId] },
  ])
    expect(create(bad)).toBe(false);
  expect(create({ draft: true, distanceKm: "01" })).toBe(false);
});

test("Stage 2 canonical labels and gallery shapes close private and locale fields", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const canonical = { id, name: "Fictional Freight", code: "synthetic_freight" };
  const label = valid("EventStage2CanonicalCatalogOption");
  const dlc = valid("EventStage2Dlc");
  expect(label(canonical)).toBe(true);
  expect(dlc({ ...canonical, sources: ["from_city", "manual"] })).toBe(true);
  expect(dlc({ ...canonical, sources: ["manual", "manual"] })).toBe(false);
  expect(dlc({ ...canonical, sources: [] })).toBe(false);
  for (const field of ["logo", "logoUrl", "englishFallback", "requestedLocale"])
    expect(label({ ...canonical, [field]: "Fictional unsafe field" })).toBe(false);
  const media = {
    id,
    contentType: "image/png",
    byteLength: 512,
    width: 16,
    height: 32,
    caption: null,
    position: 0,
    isCover: true,
  };
  expect(valid("EventStage2Media")(media)).toBe(true);
  for (const field of ["uploaderId", "generation", "storageKey", "sha256"])
    expect(valid("EventStage2Media")({ ...media, [field]: id })).toBe(false);
  expect(valid("EventStage2Media")({ ...media, contentType: "image/gif" })).toBe(false);
  expect(valid("EventStage2MediaList")({ version: 1, items: Array(11).fill(media) })).toBe(false);
  expect(valid("EventStage2MediaEditInput")({})).toBe(false);
  expect(valid("EventStage2MediaEditInput")({ caption: null, position: 9, isCover: false })).toBe(
    true,
  );
  expect(valid("EventStage2MediaEditInput")({ position: 10 })).toBe(false);
});

test("Stage 2 cancellation returns the structured member response without private reasons", () => {
  const { response } = stage2Fixture("cancelEvent", "cancelled");
  expect(valid("EventStage2EnvelopeMember")(response)).toBe(true);
  expect(valid("EnvelopeEventMember")(response)).toBe(false);
  const staged = response as { data: { event: object } };
  expect(staged.data.event).toMatchObject({
    status: "cancelled",
    route: null,
    meetingLocation: null,
    description: null,
  });
  expect(
    valid("EventStage2EnvelopeMember")({
      ...staged,
      data: { ...staged.data, event: { ...staged.data.event, reason: "Fictional private reason" } },
    }),
  ).toBe(false);
});
