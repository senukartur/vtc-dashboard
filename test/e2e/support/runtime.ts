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
  { createCatalogs },
  { catalogEvents },
  { createQueue },
  { runPass },
  { createImportHandler },
] = await Promise.all([
  built("app"),
  built("use-cases/identity-messaging"),
  built("platform/config/env"),
  built("modules/external-identities/service"),
  built("modules/external-identities/providers"),
  built("modules/catalogs/service"),
  built("platform/outbox/events"),
  built("platform/jobs/queue"),
  built("platform/jobs/runner"),
  built("modules/catalogs/importer"),
]);
const config = readConfig(),
  database = createDatabase(config.database),
  unit = createUnitOfWork(config.database);
const composition = composeIdentity(unit, config.identity, config.mail, config.admissions, true);
const externalIdentities = createExternalIdentities(unit, composition.identity, {
  steam: steamProvider(
    async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"),
  ),
  truckers: truckersProvider(async () =>
    Response.json({ error: true, descriptor: "Unable to find player with that ID." }),
  ),
});
const catalogs = createCatalogs(unit, config.catalogs, {
  identity: composition.identity,
  published: catalogEvents(unit).append,
});
// API and worker each retain the normal five-slot pool, like the two production
// processes. Together with readiness (five), this harness bounds them to 15 slots.
const workerUnit = createUnitOfWork(config.database);
const queue = createQueue(workerUnit, [
    createImportHandler(workerUnit, config.catalogs, () => new Date()),
  ]),
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
  catalogs,
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
