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
] = await Promise.all([
  built("app"),
  built("use-cases/identity-messaging"),
  built("platform/config/env"),
  built("modules/external-identities/service"),
  built("modules/external-identities/providers"),
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
const app = await createApp({
  ...composition,
  externalIdentities,
  checkReadiness: database.check,
  closeDatabase: async () => {
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
