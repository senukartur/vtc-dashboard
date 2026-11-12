import type { Page } from "@playwright/test";
import {
  stage2DraftId,
  stage2EventId,
  stage2Fixture,
  stage2LegacyEventId,
  stage2MediaId,
} from "../../fixtures/events-stage-2.ts";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { mockEvents } from "./events.ts";

const event = `/events/${stage2EventId}`;
const adminEvent = `/admin${event}`;
const draft = `/admin/events/drafts/${stage2DraftId}`;
const publicEvent = `/public${event}`;
const media = `${adminEvent}/media`;
const draftMedia = `/admin/events/${stage2DraftId}/media`;

type Fixture = [operation: string, state: string, version?: number];
const routes: Record<string, Fixture> = {
  "GET /public/events": ["listPublicEvents", "structured-and-legacy"],
  [`GET ${publicEvent}`]: ["getPublicEvent", "structured"],
  "GET /events": ["listEvents", "own-response"],
  [`GET ${event}`]: ["getEvent", "structured", 1],
  "GET /me/upcoming-event": ["getUpcomingEvent", "own-response"],
  [`GET ${draft}`]: ["getEventDraft", "read", 1],
  [`PATCH ${draft}`]: ["updateEventDraft", "partial", 1],
  [`DELETE /admin/events/${stage2DraftId}`]: ["deleteEventDraft", "discarded", 2],
  [`POST /admin/events/${stage2DraftId}/publication`]: ["publishEventDraft", "retains-identity", 1],
  [`PATCH ${adminEvent}`]: ["updateEvent", "published-definition", 1],
  [`GET ${adminEvent}/attendance`]: ["getEventAttendance", "leadership", 1],
  [`GET ${adminEvent}/nonresponders`]: ["listEventNonresponders", "leadership"],
  [`GET ${event}/media`]: ["listEventMedia", "ready"],
  [`GET ${media}`]: ["listAdminEventMedia", "gallery", 2],
  [`GET ${draftMedia}`]: ["listAdminEventMedia", "gallery", 2],
  [`POST ${media}`]: ["uploadEventMedia", "processing", 3],
  [`POST ${draftMedia}`]: ["uploadEventMedia", "processing", 3],
  [`PATCH ${media}/${stage2MediaId}`]: ["updateEventMedia", "caption-and-cover", 2],
  [`DELETE ${media}/${stage2MediaId}`]: ["deleteEventMedia", "empty", 3],
};

// Opt-in fixture responses for browser work in the feature lanes.
export async function mockEventsStage2(
  page: Page,
  access: "public" | "member" | "manager" = "manager",
  locale: "en" | "ru" = "en",
) {
  const shell = await mockEvents(page, access === "manager", locale);
  shell.session = access !== "public";
  const state = {
    publicCover: true,
    upcoming: true,
    statusByRequest: new Map<string, number>(),
    requests: [] as { route: string; key: string | undefined; precondition: string | undefined }[],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice("/api/v1".length);
    const key = `${request.method()} ${path}`;
    const headers = request.headers();
    const record = () =>
      state.requests.push({
        route: key,
        key: headers["idempotency-key"],
        precondition: headers["if-match"],
      });
    if (
      key === `GET ${publicEvent}/cover` ||
      key === `GET ${event}/media/${stage2MediaId}/content` ||
      key === `GET /events/${stage2DraftId}/media/${stage2MediaId}/content`
    ) {
      record();
      if (
        path.startsWith("/public/")
          ? !state.publicCover
          : access === "public" || (path.includes(stage2DraftId) && access !== "manager")
      )
        return route.fulfill({ status: 404 });
      if (
        !path.startsWith("/public/") &&
        !["thumb", "full"].includes(url.searchParams.get("size") ?? "")
      ) {
        return route.fulfill({ status: 422 });
      }
      return route.fulfill({
        status: 200,
        body: pngBytes(),
        contentType: "image/png",
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (key === `GET /public/events/${stage2LegacyEventId}`) {
      record();
      const legacy = stage2Fixture("listPublicEvents", "structured-and-legacy").response as {
        data: { items: unknown[] };
        meta: unknown;
      };
      return route.fulfill({
        status: 200,
        json: { data: legacy.data.items[1], meta: legacy.meta },
      });
    }
    let fixture = routes[key];
    if (key === "GET /admin/events")
      fixture = [
        "listAdminEvents",
        url.searchParams.get("period") === "drafts" ? "drafts" : "published",
      ];
    if (key === "POST /admin/events")
      fixture = [
        "createEvent",
        request.postDataJSON()?.draft === true ? "incomplete-draft" : "direct-publication",
        1,
      ];
    if (key === "GET /me/upcoming-event" && !state.upcoming)
      fixture = ["getUpcomingEvent", "empty"];
    if (!fixture) return route.fallback();
    record();
    const overridden = state.statusByRequest.get(key);
    if (overridden) return route.fulfill({ status: overridden });
    if (!path.startsWith("/public/") && access === "public") return route.fulfill({ status: 401 });
    if (path.startsWith("/admin/") && access !== "manager") return route.fulfill({ status: 403 });
    const example = stage2Fixture(fixture[0], fixture[1]);
    return route.fulfill({
      status: example.status,
      json: example.response,
      headers: { "Cache-Control": "no-store", ...(fixture[2] ? { ETag: `"v${fixture[2]}"` } : {}) },
    });
  });
  return state;
}
