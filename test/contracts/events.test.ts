import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
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
