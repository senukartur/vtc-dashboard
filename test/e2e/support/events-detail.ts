import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { stage2EventId, stage2Fixture } from "../../fixtures/events-stage-2.ts";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { eventFixture } from "./events.ts";
import { mockEventsStage2 } from "./events-stage-2.ts";

type S = components["schemas"];
type Locale = "en" | "ru";
type Role = "driver" | "dispatcher" | "director" | "deputy_director";
export const eventPath = `/events/${stage2EventId}`;
export const detailsPath = `/account${eventPath}`;
const secondaryId = "e1320000-0000-4000-8000-000000000091";
const earlierId = "e1320000-0000-4000-8000-000000000092";
const companyId = "e1320000-0000-4000-8000-000000000093";
export const decoyCompanyId = "e1320000-0000-4000-8000-000000000094";
const finishDepotId = "e1320000-0000-4000-8000-000000000095";
const declinerId = "e1320000-0000-4000-8000-000000000096";
export const galleryLabel = { en: "Gallery", ru: "Галерея" };
export const organizerLabel = { en: "Organizer", ru: "Организатор" };
const logoVersion = "0123456789abcdef";
export const coverCaption = "Fictional harbour cover";
export const middleCaption = "Fictional foothills";
export const lastCaption = "Fictional plateau";
export const unreported = "Fictional member with no response";
export const nextUnreported = "Fictional member on the next response page";

function localize(item: S["CatalogLabel"] | null, locale: Locale, english: string) {
  return (
    item &&
    (locale === "en"
      ? { ...item, label: english, requestedLocale: locale, renderedLocale: locale }
      : item)
  );
}

async function fictionalGalleryImages(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 320;
    const paint = canvas.getContext("2d");
    if (!paint) throw new Error("Missing fixture canvas");
    return ["#35576a", "#556b78", "#63515f"].map((sky) => {
      paint.fillStyle = sky;
      paint.fillRect(0, 0, 640, 320);
      paint.fillStyle = "#85999e";
      paint.beginPath();
      paint.moveTo(0, 160);
      paint.lineTo(95, 73);
      paint.lineTo(220, 174);
      paint.lineTo(360, 104);
      paint.lineTo(470, 151);
      paint.lineTo(568, 93);
      paint.lineTo(640, 145);
      paint.lineTo(640, 210);
      paint.lineTo(0, 210);
      paint.fill();
      paint.fillStyle = "#35493f";
      paint.fillRect(0, 188, 640, 132);
      paint.fillStyle = "#263436";
      paint.fillRect(0, 230, 640, 90);
      paint.fillStyle = "#b0a578";
      paint.fillRect(0, 290, 640, 3);
      paint.fillStyle = "#c9d0cf";
      paint.fillRect(210, 173, 181, 57);
      paint.fillStyle = "#ad4c3e";
      paint.fillRect(391, 195, 49, 35);
      paint.fillStyle = "#1b2326";
      for (const x of [242, 263, 372, 428]) {
        paint.beginPath();
        paint.arc(x, 231, 11, 0, Math.PI * 2);
        paint.fill();
      }
      return canvas.toDataURL("image/png").split(",")[1] ?? "";
    });
  });
  return encoded.map((value) => Buffer.from(value, "base64"));
}

export async function mockStructuredDetail(page: Page, locale: Locale, role?: Role) {
  const manager = role === "director" || role === "deputy_director";
  await mockEventsStage2(page, manager ? "manager" : role ? "member" : "public", locale);
  const member = (
    stage2Fixture("getEvent", "structured").response as S["EventStage2EnvelopeMember"]
  ).data;
  const event = member.event;
  event.description = "Fictional schedule and meeting details for a synthetic event.";
  event.origin = localize(event.origin, locale, "Fictional Harbour");
  event.destination = localize(event.destination, locale, "Fictional Plateau");
  event.destinationDepot = {
    id: finishDepotId,
    name: "Fictional Plateau Depot",
    code: "synthetic_plateau",
  };
  member.prescribedCargo = localize(member.prescribedCargo, locale, "Fictional Cargo");
  member.prescribedTrailerType = localize(
    member.prescribedTrailerType,
    locale,
    "Fictional Trailer",
  );
  member.responseCounts = { participating: 2, declined: 1 };
  const baseImage = (
    stage2Fixture("listEventMedia", "ready").response as S["EventStage2EnvelopeMediaList"]
  ).data.items[0];
  if (!baseImage || !event.origin || !event.originDepot)
    throw new Error("Missing Stage 2 test data");
  const origin = event.origin;
  const originDepot = event.originDepot;
  const images = await fictionalGalleryImages(page);
  const logo = pngBytes(128, 32);
  const media = [
    { ...baseImage, id: secondaryId, caption: lastCaption, isCover: false, position: 2 },
    { ...baseImage, caption: coverCaption, position: 1 },
    { ...baseImage, id: earlierId, caption: middleCaption, isCover: false, position: 0 },
  ].map((item, index) => ({
    ...item,
    width: 640,
    height: 320,
    byteLength: images[index]?.length ?? 0,
  }));
  const state = {
    missingMedia: false,
    mediaFailure: false,
    staleCancellation: false,
    cancellations: [] as {
      body: unknown;
      etag: string | undefined;
      key: string | undefined;
      locale: string | null;
    }[],
    requests: [] as URL[],
    member,
  };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) state.requests.push(url);
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice("/api/v1".length);
    const envelope = (data: unknown, version = 1) =>
      route.fulfill({
        json: { data, meta: { requestId: "synthetic-event-detail" } },
        headers: { ETag: `"v${version}"` },
      });
    if (role && path === "/me") {
      const self = accountFixture(locale);
      self.data.member.roles = [role];
      self.data.preferences.displayTimezone = "Europe/Warsaw";
      if (manager) self.data.capabilities.push("events.manage");
      return route.fulfill({ json: self, headers: { "X-VTC-Events-Stage2": "1" } });
    }
    if (manager && request.method() === "POST" && path === `/admin${eventPath}/cancellation`) {
      const headers = request.headers();
      state.cancellations.push({
        body: request.postDataJSON(),
        etag: headers["if-match"],
        key: headers["idempotency-key"],
        locale: url.searchParams.get("locale"),
      });
      event.version++;
      if (state.staleCancellation) {
        state.staleCancellation = false;
        return route.fulfill({ status: 412 });
      }
      event.status = "cancelled";
      return envelope(member, event.version);
    }
    if (request.method() !== "GET") return route.fallback();
    if (role && path === "/me/upcoming-event") {
      return envelope({
        ...eventFixture(),
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        meetingAt: event.meetingAt,
        origin: event.origin,
        destination: event.destination,
      });
    }
    if (role && path === `${eventPath}/my-response`) return envelope(member.myResponse);
    if (role && path === `${eventPath}/participants`)
      return envelope({
        items: [
          { member: accountFixture(locale).data.member },
          {
            member: {
              id: member.organizerMemberId,
              nickname: event.organizer,
              formerMember: false,
              roles: ["director"],
            },
          },
        ],
        nextCursor: null,
      });
    if (role && path === `${eventPath}/decliners`)
      return envelope({
        items: [
          {
            member: {
              id: declinerId,
              nickname: "Fictional day-shift driver",
              formerMember: false,
              roles: ["driver"],
            },
          },
        ],
        nextCursor: null,
      });
    if (path === `/public${eventPath}`) return envelope(event);
    if (role && path === eventPath) return envelope(member, event.version);
    if (role && path === `${eventPath}/media`)
      return state.missingMedia || state.mediaFailure
        ? route.fulfill({ status: state.missingMedia ? 404 : 503 })
        : envelope({ version: 2, items: media });
    if (role && path.startsWith(`${eventPath}/media/`)) {
      const index = media.findIndex((item) => path === `${eventPath}/media/${item.id}/content`);
      const image = images[index];
      if (image) return route.fulfill({ body: image, contentType: "image/png" });
    }
    if (manager && path === `/admin${eventPath}/attendance`) {
      const { data } = stage2Fixture("getEventAttendance", "leadership")
        .response as S["EventStage2EnvelopeAttendance"];
      return envelope({
        ...data,
        items: [
          ...data.items,
          {
            member: { id: earlierId, nickname: unreported, formerMember: false, roles: ["driver"] },
            response: { version: 1, response: "unanswered", declineReason: null },
            attendance: "unconfirmed",
            note: null,
            tripId: null,
          },
        ],
      });
    }
    if (manager && path === `/admin${eventPath}/nonresponders`) {
      const secondPage = url.searchParams.get("cursor") === "fictional-nonresponder-cursor";
      return envelope({
        items: [
          {
            id: secondPage ? secondaryId : earlierId,
            nickname: secondPage ? nextUnreported : unreported,
            formerMember: false,
            roles: ["driver"],
          },
        ],
        nextCursor: secondPage ? null : "fictional-nonresponder-cursor",
      });
    }
    if (role && path === "/catalogs/depots") {
      const company = (id: string) => ({
        id,
        code: originDepot.code,
        label: { ...origin, entityId: id, label: originDepot.name },
        logo: { version: logoVersion, byteLength: logo.length },
      });
      const depot = {
        id: originDepot.id,
        hidden: true,
        dlcId: null,
        dlc: null,
        city: { id: origin.entityId, code: "fictional_harbour", label: origin },
        game: event.game,
      };
      if (url.searchParams.get("search") !== originDepot.code)
        return envelope({ items: [], nextCursor: null, total: 0 });
      return url.searchParams.has("cursor")
        ? envelope({
            items: [{ ...depot, company: company(companyId) }],
            nextCursor: null,
            total: 2,
          })
        : envelope({
            items: [{ ...depot, id: earlierId, company: company(decoyCompanyId) }],
            nextCursor: "fictional-depot-cursor",
            total: 2,
          });
    }
    if (role && path === `/catalogs/companies/${companyId}/logo`)
      return route.fulfill({ body: logo, contentType: "image/png" });
    return route.fallback();
  });
  return state;
}
