import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext } from "@playwright/test";
import { createDatabase, createUnitOfWork } from "@vtc/db";
import { reconciliationCandidates } from "@vtc/db/reconciliation-schema";
import { inArray, trips } from "@vtc/db/trips-schema";
import { ruleIdentity } from "../../../apps/api/src/modules/reconciliation/matcher.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret, csrf } from "./account.ts";
import { expect } from "./fixtures.ts";
import { browserTripConfig } from "./trip-config.ts";

const host = "127.0.0.1";
const port = 4177;
const origin = `http://${host}:${port}`;
function built<T>(file: string): Promise<T> {
  return import(pathToFileURL(resolve(`apps/api/dist/${file}.js`)).href);
}

/** Compiled, flag-on API beside the default-off browser server. Both use the guarded test DB. */
export async function startReviewStage3Server(browser: Browser) {
  const settings = guardedSettings();
  const allocation = guardedAllocation();
  const [{ createApp }, { composeIdentity }] = await Promise.all([
    built<typeof import("../../../apps/api/src/app.ts")>("app"),
    built<typeof import("../../../apps/api/src/use-cases/identity-messaging.ts")>(
      "use-cases/identity-messaging",
    ),
  ]);
  const config = browserTripConfig();
  const database = createDatabase(settings);
  const unit = createUnitOfWork(settings);
  const closeDatabase = async () => {
    await Promise.all([unit.close(), database.close()]);
  };
  const contexts: BrowserContext[] = [];
  let blocked = 0;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let composed: ReturnType<typeof composeIdentity>;
  try {
    composed = composeIdentity(
      unit,
      { secret: accountSecret("identity"), origin, production: false },
      undefined,
      undefined,
      true,
      {
        cursorKey: createHmac("sha256", allocation.token)
          .update("browser-review-stage-3-catalog")
          .digest("hex"),
      },
      config.trips,
      undefined,
      config.manual,
      config.qualifications,
      config.events,
      config.reconciliation,
      config.decisions,
      undefined,
      config.notifications,
      undefined,
      true,
    );
    app = await createApp({
      ...composed,
      checkReadiness: database.check,
      closeDatabase,
      webRoot: resolve("apps/web/dist"),
    });
    await app.listen({ host, port });
    const readiness = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(5000) });
    await readiness.body?.cancel();
    if (!readiness.ok) throw new Error("STAGE_3_DISPATCH_BROWSER_SERVER_UNAVAILABLE");
  } catch (error) {
    if (app) await app.close();
    else await closeDatabase();
    throw error;
  }

  async function actor(email: string, password: string) {
    const context = await browser.newContext({
      baseURL: origin,
      locale: "en-GB",
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    contexts.push(context);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.username && !url.password) return route.continue();
      blocked++;
      return route.abort("blockedbyclient");
    });
    const login = await context.request.post("/api/v1/auth/login", {
      headers: { Origin: origin, "X-CSRF-Token": await csrf(context.request) },
      data: { email, password },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(200);
    return context.newPage();
  }

  const server = app;
  return {
    actor,
    composed,
    unit,
    async [Symbol.asyncDispose]() {
      try {
        await Promise.all(contexts.map((context) => context.close()));
        expect(blocked).toBe(0);
      } finally {
        await server.close();
      }
    },
  };
}

/** Seed one current candidate for distinct, already-assessed synthetic trip roots. */
export async function seedReviewStage3Duplicate(
  unit: ReturnType<typeof createUnitOfWork>,
  ownerId: string,
  left: string,
  right: string,
) {
  const id = randomUUID();
  await unit.run(async (tx) => {
    const db = unit.client(tx);
    const rows = await db
      .select()
      .from(trips)
      .where(inArray(trips.id, [left, right]))
      .orderBy(trips.id)
      .for("update");
    const [a, b] = rows;
    if (
      !a ||
      !b ||
      a.id === b.id ||
      !a.currentFactId ||
      !b.currentFactId ||
      [a, b].some(
        (row) =>
          row.ownerId !== ownerId || row.game !== "ets2" || row.aliasOf || row.assessmentPending,
      )
    )
      throw new Error("STAGE_3_SYNTHETIC_DUPLICATE_ROOTS_REQUIRED");
    await db.insert(reconciliationCandidates).values({
      id,
      ownerId,
      game: "ets2",
      searchHash: createHmac("sha256", guardedAllocation().token).update(id).digest(),
      primaryTripId: a.id,
      secondaryTripId: b.id,
      primaryVersion: a.version,
      secondaryVersion: b.version,
      ruleHash: ruleIdentity(browserTripConfig().reconciliation.rule),
      evidence: {
        factIds: [a.currentFactId, b.currentFactId].sort(),
        searchGeneration: randomUUID(),
        searchComplete: true,
        supported: false,
      },
      reasons: ["manual_actual_time_unknown"],
      active: true,
      createdAt: new Date().toISOString(),
    });
  });
  return id;
}
