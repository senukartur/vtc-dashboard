import { inertNotifications } from "./notifications.ts";
import { expect, type Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture, fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";

type S = components["schemas"];
export async function selectPastReportEvent(page: Page, eventId: string) {
  const select = page.locator("#report-event"),
    field = select.locator("..");
  async function load(cursor: string | null, action: () => Promise<unknown>) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => {
        const url = new URL(r.url());
        return (
          r.request().method() === "GET" &&
          url.pathname === "/api/v1/events" &&
          url.searchParams.get("period") === "past" &&
          url.searchParams.get("cursor") === cursor
        );
      }),
      action(),
    ]);
    expect(response.status()).toBe(200);
    const body = await response.json();
    // Headers/body receipt does not establish that the selector has rendered this page.
    await expect(field.getByRole("status")).toHaveCount(0);
    await expect(field.getByRole("alert")).toHaveCount(0);
    return body.data.nextCursor as string | null;
  }
  let nextCursor = await load(null, () =>
      page.getByRole("button", { name: "Past events", exact: true }).click(),
    ),
    pages = 0;
  while (!(await select.locator(`option[value="${eventId}"]`).count())) {
    expect(++pages).toBeLessThanOrEqual(10);
    expect(nextCursor).not.toBeNull();
    nextCursor = await load(nextCursor, () =>
      field.getByRole("button", { name: "Next page", exact: true }).click(),
    );
  }
  await select.selectOption(eventId);
}
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
    listPages: false,
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
    attendancePages: false,
    attendanceCursors: [] as string[],
    loseAttendanceReceipt: false,
    attendanceDecisions: 0,
    attendanceReceipts: new Map<string, { fingerprint: string; version: number }>(),
    participantPages: false,
    participantCursors: [] as string[],
    /** Extra first-page rows besides the current member (fictional names only). */
    extraParticipants: [] as S["Participant"][],
    extraDecliners: [] as S["Participant"][],
    declinerPages: false,
    declinerCursors: [] as string[],
    /** Non-200 statuses injected for the member list and count reads. */
    participantsStatus: 200,
    declinersStatus: 200,
    countsStatus: 200,
    countsGate: null as Promise<void> | null,
  };
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
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
      if (p.endsWith("/attendance")) {
        const receipt = state.attendanceReceipts.get(request.headers()["idempotency-key"] ?? "");
        if (receipt) {
          if (receipt.fingerprint !== JSON.stringify([request.headers()["if-match"], body]))
            return route.fulfill({ status: 409, json: {} });
          return reply({ id: eventId, version: receipt.version }, 200, receipt.version);
        }
      }
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
        state.attendanceDecisions++;
        state.attendanceReceipts.set(request.headers()["idempotency-key"] ?? "", {
          fingerprint: JSON.stringify([request.headers()["if-match"], body]),
          version: state.attendanceVersion,
        });
        if (state.loseAttendanceReceipt) {
          state.loseAttendanceReceipt = false;
          return route.abort("failed");
        }
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
        ? reply({
            items: state.empty
              ? []
              : [
                  {
                    ...state.event,
                    ...(url.searchParams.get("period") === "past"
                      ? {
                          startsAt: "2020-10-25T13:00:00.000Z",
                          meetingAt: "2020-10-25T12:00:00.000Z",
                          status: "completed",
                        }
                      : {}),
                    ...(url.searchParams.has("cursor")
                      ? {
                          id: "e0350000-0000-4000-8000-000000000005",
                          title: "Fictional second page convoy",
                        }
                      : {}),
                  },
                ],
            nextCursor:
              state.listPages && !url.searchParams.has("cursor") ? "synthetic-event-page-2" : null,
          })
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
    const unavailable = (status: number) =>
      route.fulfill({ status, json: { error: { code: "UNAVAILABLE", message: "Unavailable" } } });
    const self = (response: S["Rsvp"]["response"]) =>
      state.response.response === response ? [{ member: accountFixture().data.member }] : [];
    if (p.endsWith("/response-counts")) {
      if (state.countsGate) await state.countsGate;
      if (state.countsStatus !== 200) return unavailable(state.countsStatus);
      return reply({
        participating:
          self("participating").length +
          state.extraParticipants.length +
          (state.participantPages ? 25 : 0),
        declined:
          self("declined").length + state.extraDecliners.length + (state.declinerPages ? 25 : 0),
      });
    }
    if (p.endsWith("/decliners")) {
      if (state.declinersStatus !== 200) return unavailable(state.declinersStatus);
      const cursor = url.searchParams.get("cursor") ?? "";
      state.declinerCursors.push(cursor);
      if (state.declinerPages)
        return reply({
          items: cursor
            ? self("declined")
            : Array.from({ length: 25 }, (_, i) => ({
                member: {
                  id: `e0581000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
                  nickname: `Fictional decliner ${i + 1}`,
                  roles: ["driver" as const],
                  formerMember: i === 1,
                },
              })),
          nextCursor: cursor ? null : "synthetic-decliner-page-2",
        });
      return reply({ items: [...state.extraDecliners, ...self("declined")], nextCursor: null });
    }
    if (p.endsWith("/participants") && state.participantsStatus !== 200)
      return unavailable(state.participantsStatus);
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
        items: [...state.extraParticipants, ...self("participating")],
        nextCursor: null,
      });
    if (p.endsWith("/attendance")) {
      const cursor = url.searchParams.get("cursor") ?? "";
      state.attendanceCursors.push(cursor);
      if (cursor && cursor !== `synthetic-attendance-page-2-v${state.attendanceVersion}`)
        return route.fulfill({ status: 412, json: {} });
      const target = {
        member: { ...accountFixture().data.member, id: fixtureId },
        response: {
          response: "declined" as const,
          declineReason: "Fictional private RSVP reason",
          version: 2,
        },
        attendance: state.attendance,
        note: null,
      };
      const first = Array.from({ length: 25 }, (_, i) => ({
        ...target,
        member: {
          ...target.member,
          id: `e0352000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          nickname: `Fictional roster member ${i + 1}`,
        },
        response: { response: "unanswered" as const, declineReason: null, version: 1 },
      }));
      return reply(
        {
          items: state.attendancePages && !cursor ? first : [target],
          nextCursor:
            state.attendancePages && !cursor
              ? `synthetic-attendance-page-2-v${state.attendanceVersion}`
              : null,
        },
        200,
        state.attendanceVersion,
      );
    }
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
