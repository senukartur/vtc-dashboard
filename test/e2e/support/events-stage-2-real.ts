import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, createUnitOfWork } from "@vtc/db";
import { guardedSettings } from "../../persistence/support.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret } from "./account.ts";
import { browserTripConfig } from "./trip-config.ts";

const host = "127.0.0.1";

function built<T>(file: string): Promise<T> {
  return import(pathToFileURL(resolve(`apps/api/dist/${file}.js`)).href);
}

/** Start the compiled Stage 2 variant beside the legacy browser server, on the owned test DB. */
export async function startStage2EventsServer(draftsEnabled: boolean) {
  const settings = guardedSettings();
  const port = draftsEnabled ? 4174 : 4175;
  const origin = `http://${host}:${port}`;
  const [{ createApp }, { readConfig }, { composeIdentity }] = await Promise.all([
    built<typeof import("../../../apps/api/src/app.ts")>("app"),
    built<typeof import("../../../apps/api/src/platform/config/env.ts")>("platform/config/env"),
    built<typeof import("../../../apps/api/src/use-cases/identity-messaging.ts")>(
      "use-cases/identity-messaging",
    ),
  ]);
  const config = readConfig({
    NODE_ENV: "test",
    API_HOST: host,
    API_PORT: String(port),
    SERVE_WEB: "true",
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: accountSecret("identity"),
    IDENTITY_ORIGIN: origin,
    CATALOGS_ENABLED: "true",
    CATALOGS_CURSOR_KEY: createHmac("sha256", guardedAllocation().token)
      .update("browser-stage-2-events-catalog")
      .digest("hex"),
    EVENTS_ENABLED: "true",
    EVENTS_ROUTE_ENABLED: "true",
    EVENTS_DRAFTS_ENABLED: String(draftsEnabled),
    EVENTS_CURSOR_KEY: browserTripConfig().events.cursorKey,
    MYSQL_HOST: settings.host,
    MYSQL_PORT: String(settings.port),
    MYSQL_DATABASE: settings.database,
    MYSQL_USER: settings.user,
    MYSQL_PASSWORD: settings.password,
  });
  if (!config.identity || !config.catalogs || !config.events)
    throw new Error("STAGE_2_EVENT_BROWSER_CONFIG_MISSING");

  const database = createDatabase(config.database);
  const unit = createUnitOfWork(config.database);
  const closeDatabase = async () => {
    await Promise.all([unit.close(), database.close()]);
  };
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({
      ...composeIdentity(
        unit,
        config.identity,
        config.mail,
        config.admissions,
        config.externalIdentities,
        config.catalogs,
        config.trips,
        config.telemetry,
        config.manualReports,
        config.qualifications,
        config.events,
      ),
      checkReadiness: database.check,
      closeDatabase,
      webRoot: config.webRoot,
    });
    await app.listen({ host, port });
    const readiness = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(5000) });
    await readiness.body?.cancel();
    if (!readiness.ok) throw new Error("STAGE_2_EVENT_BROWSER_SERVER_UNAVAILABLE");
    const server = app;
    return { origin, close: () => server.close() };
  } catch (error) {
    if (app) await app.close();
    else await closeDatabase();
    throw error;
  }
}
