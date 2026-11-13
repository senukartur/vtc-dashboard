import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { createDatabase, createUnitOfWork } from "@vtc/db";
import { pngBytes } from "../../fixtures/manual-images.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret, csrf } from "./account.ts";
import { expect } from "./fixtures.ts";

type Schemas = components["schemas"];
const built = (path: string) => import(pathToFileURL(resolve(`apps/api/dist/${path}.js`)).href);

export async function createLandingCoverFixture() {
  const settings = guardedSettings();
  const origin = "http://127.0.0.1:4176";
  const [{ createApp }, { composeIdentity }, { runPass }] = await Promise.all([
    built("app"),
    built("use-cases/identity-messaging"),
    built("platform/jobs/runner"),
  ]);
  const storage = await mkdtempDisposable(join(tmpdir(), "vtc-landing-covers-"));
  const database = createDatabase(settings);
  const unit = createUnitOfWork(settings);
  const staff = await request.newContext({ baseURL: origin });
  const dispose = async () => {
    try {
      await Promise.all([staff.dispose(), unit.close(), database.close()]);
    } finally {
      await storage.remove();
    }
  };
  let stopServer: (() => Promise<void>) | undefined;
  try {
    // Run compiled routes and the normal media handlers with separate synthetic storage.
    const composed = composeIdentity(
      unit,
      { secret: accountSecret("identity"), origin, production: false },
      undefined,
      undefined,
      false,
      { cursorKey: randomBytes(32).toString("hex") },
      undefined,
      undefined,
      undefined,
      undefined,
      { cursorKey: randomBytes(32).toString("hex"), routeEnabled: true },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        root: storage.path,
        maxFileBytes: 1048576,
        maxPixels: 1000000,
        timeoutMs: 10000,
        separateFrom: [],
      },
    );
    const app = await createApp({
      ...composed,
      checkReadiness: database.check,
      webRoot: resolve("apps/web/dist"),
    });
    stopServer = () => app.close();
    await app.listen({ host: "127.0.0.1", port: 4176 });
    const password = createHmac("sha256", guardedAllocation().token)
      .update("browser-identity-password")
      .digest("base64url");
    const login = await staff.post("/api/v1/auth/login", {
      headers: { Origin: origin, "X-CSRF-Token": await csrf(staff) },
      data: { email: "browser@example.invalid", password },
    });
    expect(login.status()).toBe(200);

    async function headers(etag?: string) {
      return {
        Origin: origin,
        "X-CSRF-Token": await csrf(staff),
        "Idempotency-Key": randomUUID(),
        ...(etag ? { "If-Match": etag } : {}),
      };
    }
    const route = {
      en: "Fictional North → Fictional South",
      ru: "Вымышленный Север → Вымышленный Юг",
    };
    async function city(nameEn: string, nameRu: string) {
      const response = await staff.post("/api/v1/admin/catalogs/cities", {
        headers: await headers(),
        data: {
          game: "ets2",
          code: `landing_${randomUUID().slice(0, 8)}`,
          nameEn,
          nameRu,
        } satisfies Schemas["CatalogCityInput"],
      });
      expect(response.status()).toBe(201);
      const { data } = (await response.json()) as { data: Schemas["CatalogItem"] };
      return data.id;
    }
    const originCityId = await city("Fictional North", "Вымышленный Север");
    const destinationCityId = await city("Fictional South", "Вымышленный Юг");
    const event: Schemas["EventInput"] = {
      title: "Fictional landing cover lifecycle convoy",
      description: "Synthetic cover lifecycle fixture",
      game: "ets2",
      server: "Fictional Simulation",
      organizer: "Fictional Team",
      route: "Fictional legacy route text",
      meetingLocation: "Fictional harbour",
      meetingAt: new Date(Date.now() + 300000).toISOString(),
      startsAt: new Date(Date.now() + 600000).toISOString(),
      endsAt: null,
      visibility: "public",
      originCityId,
      destinationCityId,
      prescribedCargoId: null,
      prescribedMassKg: null,
      prescribedTrailerTypeId: null,
    };
    const created = await staff.post("/api/v1/admin/events", {
      headers: await headers(),
      data: event,
    });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as Schemas["EnvelopeEventMember"];
    const { id, version } = data.event;
    const definitionPath = `/api/v1/admin/events/${id}`;
    const galleryPath = `${definitionPath}/media`;

    async function gallery() {
      const response = await staff.get(galleryPath);
      expect(response.status()).toBe(200);
      const etag = response.headers().etag;
      if (!etag) throw new Error("EVENT_GALLERY_VERSION_MISSING");
      const { data } = (await response.json()) as Schemas["EventStage2EnvelopeAdminMediaList"];
      return { etag, items: data.items };
    }
    return {
      origin,
      id,
      route,
      title: event.title,
      coverPath: `/api/v1/public/events/${id}/cover`,
      async upload(width: number) {
        const response = await staff.post(galleryPath, {
          headers: await headers((await gallery()).etag),
          multipart: {
            file: {
              name: "fictional-cover.png",
              mimeType: "image/png",
              buffer: pngBytes(width, 70),
            },
          },
        });
        expect(response.status()).toBe(202);
        const { data } = (await response.json()) as Schemas["EventStage2EnvelopeMediaUpload"];
        // The other browser app can hold the shared runner lease between passes.
        await expect
          .poll(
            async () => {
              await runPass(composed.jobsQueue, AbortSignal.timeout(10000));
              const { items } = await gallery();
              return items.find((item) => item.id === data.item.id)?.state;
            },
            { timeout: 15000, intervals: [250, 500, 1000] },
          )
          .toBe("ready");
        return data.item.id;
      },
      async select(mediaId: string) {
        const response = await staff.patch(`${galleryPath}/${mediaId}`, {
          headers: await headers((await gallery()).etag),
          data: { isCover: true },
        });
        expect(response.status()).toBe(200);
      },
      async remove(mediaId: string) {
        const response = await staff.delete(`${galleryPath}/${mediaId}`, {
          headers: await headers((await gallery()).etag),
        });
        expect(response.status()).toBe(200);
      },
      async [Symbol.asyncDispose]() {
        try {
          // Keep the synthetic definition out of subsequent upcoming and public reads.
          const past = Date.now() - 60000;
          const retired = await staff.patch(definitionPath, {
            headers: await headers(`"v${version}"`),
            data: {
              ...event,
              visibility: "members",
              meetingAt: new Date(past - 60000).toISOString(),
              startsAt: new Date(past).toISOString(),
            },
          });
          expect(retired.status()).toBe(200);
        } finally {
          try {
            await app.close();
          } finally {
            await dispose();
          }
        }
      },
    };
  } catch (failure) {
    try {
      await stopServer?.();
    } finally {
      await dispose();
    }
    throw failure;
  }
}
