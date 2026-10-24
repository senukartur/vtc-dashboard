import { mkdir } from "node:fs/promises";
import { browserTripConfig } from "./trip-config.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, createUnitOfWork } from "@vtc/db";
import { guardedAllocation } from "../../support/environment.ts";

// Load the compiled candidate; only the provider transport is synthetic, inside the
// network-isolated test image. No mock endpoint or bypass is shipped in the API.
guardedAllocation();
const built = (path: string) => import(pathToFileURL(resolve(`apps/api/dist/${path}.js`)).href);
const [
  { createApp },
  { composeIdentity },
  { readConfig },
  { createExternalIdentities },
  { steamProvider, truckersProvider },
  { runPass },
] = await Promise.all([
  built("app"),
  built("use-cases/identity-messaging"),
  built("platform/config/env"),
  built("modules/external-identities/service"),
  built("modules/external-identities/providers"),
  built("platform/jobs/runner"),
]);
const config = readConfig(),
  database = createDatabase(config.database),
  unit = createUnitOfWork(config.database);
const trips = browserTripConfig();
await mkdir(trips.manual.storage.root, { recursive: true, mode: 0o700 });
const compose = (target: typeof unit, worker = false) =>
  composeIdentity(
    target,
    config.identity,
    worker ? undefined : config.mail,
    config.admissions,
    true,
    config.catalogs,
    trips.trips,
    undefined,
    trips.manual,
    trips.qualifications,
    trips.events,
    trips.reconciliation,
    trips.decisions,
  );
const composition = compose(unit);
const externalIdentities = createExternalIdentities(unit, composition.identity, {
  steam: steamProvider(
    async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"),
  ),
  truckers: truckersProvider(async () =>
    Response.json({ error: true, descriptor: "Unable to find player with that ID." }),
  ),
});
// API and worker each retain the normal five-slot pool, like the two production
// processes. Together with readiness (five), this harness bounds them to 15 slots.
const workerUnit = createUnitOfWork(config.database);
const queue = compose(workerUnit, true).jobsQueue,
  stop = new AbortController();
let pass: Promise<unknown> | undefined;
// This bounded synthetic worker is allocation-guarded and never shipped in the API.
const timer = setInterval(() => {
  if (!pass && !stop.signal.aborted) {
    pass = runPass(queue, stop.signal)
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => {
        pass = undefined;
      });
  }
}, 250);
const app = await createApp({
  ...composition,
  externalIdentities,
  checkReadiness: database.check,
  closeDatabase: async () => {
    clearInterval(timer);
    stop.abort();
    await pass;
    await workerUnit.close();
    await database.close();
    await unit.close();
  },
  webRoot: config.webRoot,
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    app.close().catch(() => {
      process.exitCode = 1;
    });
  });
await app.listen({ host: config.host, port: config.port });
