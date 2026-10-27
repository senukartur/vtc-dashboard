import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture, fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";
type S = components["schemas"];
export const eventId = "e0350000-0000-4000-8000-000000000001";
export const eventFixture = (): S["EventPublic"] => ({
  id: eventId,
  version: 1,
  title: "Fictional Yukon evening convoy",
  game: "ets2",
  server: "Fictional Simulation",
  organizer: "Fictional Events Team",
  description: "A fictional company convoy for browser verification.",
  route: "Fictional North → Fictional South",
  meetingLocation: "Fictional harbour",
  meetingAt: "2099-10-25T12:00:00.000Z",
  startsAt: "2099-10-25T13:00:00.000Z",
  endsAt: null,
  origin: null,
  destination: null,
  status: "scheduled",
});
export async function mockEvents(page: Page, staff = false, locale: "en" | "ru" = "en") {
  const state = {
    event: eventFixture(),
    upcoming: undefined as S["EventPublic"] | undefined,
    response: { response: "unanswered", declineReason: null, version: 1 } as S["Rsvp"],
    visibility: "public" as "public" | "members",
    definitionVersion: 1,
    attendanceVersion: 1,
    ownAttendance: "unconfirmed" as "unconfirmed" | "attended" | "not_attended",
    status: 200,
    listStatus: 200,
    empty: false,
    session: true,
    keys: [] as string[],
    preconditions: [] as string[],
    commands: [] as { method: string; path: string; body: unknown }[],
    requests: [] as string[],
    failNext: 0,
    gate: null as Promise<void> | null,
    readGate: null as Promise<void> | null,
    prescribedCargoId: null as string | null,
    prescribedMassKg: null as string | null,
    prescribedTrailerTypeId: null as string | null,
    attendance: "unconfirmed" as S["Attendance"]["attendance"],
    participantPages: false,
    participantCursors: [] as string[],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname.replace("/api/v1", ""),
      method = request.method();
    state.requests.push(`${method} ${p}`);
    const reply = (data: unknown, status = 200, version = 1) =>
      route.fulfill({
        status,
        json: { data, meta: { requestId: "synthetic-event" } },
        headers: { ETag: `"v${version}"` },
      });
    if (p === "/auth/csrf") return reply({ token: "synthetic-nonfunctional-csrf" });
    if (p === "/me") {
      const self = accountFixture(locale).data;
      if (staff) self.capabilities.push("events.manage");
      self.preferences.displayTimezone = "Europe/Warsaw";
      return state.session
        ? reply(self)
        : route.fulfill({
            status: 401,
            json: { error: { code: "UNAUTHORIZED", message: "Unavailable" } },
          });
    }
    const member = () => ({
      event: state.event,
      visibility: state.visibility,
      myResponse: state.response,
      myAttendance: state.ownAttendance,
      prescribedCargoId: state.prescribedCargoId,
      prescribedMassKg: state.prescribedMassKg,
      prescribedTrailerTypeId: state.prescribedTrailerTypeId,
    });
    if (method !== "GET") {
      state.keys.push(request.headers()["idempotency-key"] ?? "");
      state.preconditions.push(request.headers()["if-match"] ?? "");
      const body = request.postDataJSON();
      state.commands.push({ method, path: p, body });
      if (state.gate) await state.gate;
      if (state.failNext) {
        const status = state.failNext;
        state.failNext = 0;
        if (status === 412) {
          state.definitionVersion++;
          state.response.version++;
          state.attendanceVersion++;
        }
        return route.fulfill({
          status,
          json: { error: { code: "CONFLICT", message: "Unavailable" } },
        });
      }
      if (p.endsWith("/my-response")) {
        state.response = {
          response: body.response,
          declineReason: body.reason ?? null,
          version: state.response.version + 1,
        };
        return reply(state.response, 200, state.response.version);
      }
      if (p.endsWith("/attendance")) {
        state.attendance = body.members[0].attendance;
        state.attendanceVersion++;
        return reply(
          { id: eventId, version: state.attendanceVersion },
          200,
          state.attendanceVersion,
        );
      }
      if (p.endsWith("/cancellation")) state.event.status = "cancelled";
      else {
        const input = body as S["EventInput"];
        state.event = {
          ...state.event,
          title: input.title,
          game: input.game,
          server: input.server,
          organizer: input.organizer,
          description: input.description,
          route: input.route,
          meetingLocation: input.meetingLocation,
          meetingAt: input.meetingAt,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          version: ++state.definitionVersion,
        };
        state.visibility = body.visibility;
      }
      return reply(member(), p === "/admin/events" ? 201 : 200, state.definitionVersion);
    }
    if (p === "/me/upcoming-event")
      return reply(
        state.event.status === "cancelled" || state.empty ? null : (state.upcoming ?? state.event),
      );
    if ((p === "/public/events" || p === "/events") && state.readGate) await state.readGate;
    if (p === "/public/events" || p === "/events")
      return state.listStatus === 200
        ? reply({ items: state.empty ? [] : [state.event], nextCursor: null })
        : route.fulfill({
            status: state.listStatus,
            json: { error: { code: "UNAVAILABLE", message: "Unavailable" } },
          });
    if (p === `/public/events/${eventId}` || p === `/events/${eventId}`)
      return state.status === 200
        ? reply(p.startsWith("/public") ? state.event : member(), 200, state.definitionVersion)
        : route.fulfill({
            status: state.status,
            json: { error: { code: "UNAVAILABLE", message: "Unavailable" } },
          });
    if (p.endsWith("/my-response")) return reply(state.response, 200, state.response.version);
    if (p.endsWith("/participants") && state.participantPages) {
      const cursor = url.searchParams.get("cursor") ?? "";
      state.participantCursors.push(cursor);
      const first: S["Participant"][] = Array.from({ length: 25 }, (_, i) => ({
        member: {
          id: `e0351000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          nickname: `Fictional participant ${i + 1}`,
          roles: ["driver"],
          formerMember: false,
        },
      }));
      return reply({
        items: cursor
          ? state.response.response === "participating"
            ? [{ member: accountFixture().data.member }]
            : []
          : first,
        nextCursor: cursor ? null : "synthetic-participant-page-2",
      });
    }
    if (p.endsWith("/participants"))
      return reply({
        items:
          state.response.response === "participating"
            ? [{ member: accountFixture().data.member }]
            : [],
        nextCursor: null,
      });
    if (p.endsWith("/attendance"))
      return reply(
        {
          items: [
            {
              member: { ...accountFixture().data.member, id: fixtureId },
              response: {
                response: "declined",
                declineReason: "Fictional private RSVP reason",
                version: 2,
              },
              attendance: state.attendance,
              note: null,
            },
          ],
          nextCursor: null,
        },
        200,
        state.attendanceVersion,
      );
    if (p === "/catalogs/revisions")
      return route.fulfill({
        status: 503,
        json: { error: { code: "UNAVAILABLE", message: "Unavailable" } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Unavailable" } },
    });
  });
  return state;
}
