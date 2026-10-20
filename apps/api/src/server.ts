import { createDatabase, createUnitOfWork } from "@vtc/db";
import { createApp } from "./app.js";
import { readConfig } from "./platform/config/env.js";
import { composeIdentity } from "./use-cases/identity-messaging.js";

try {
  const config = readConfig();
  const database = createDatabase(config.database);
  const unit = config.identity ? createUnitOfWork(config.database) : undefined;
  const app = await createApp({
    ...(config.proxyAddress ? { proxyAddress: config.proxyAddress } : {}),
    checkReadiness: database.check,
    closeDatabase: async () => {
      await database.close();
      await unit?.close();
    },
    ...(config.identity && unit
      ? {
          ...composeIdentity(
            unit,
            config.identity,
            config.mail,
            config.admissions,
            config.externalIdentities,
            config.catalogs,
            config.trips,
          ),
        }
      : {}),
    ...(config.serveWeb ? { webRoot: config.webRoot } : {}),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  }
  await app.listen({ host: config.host, port: config.port });
  console.log("API started. Liveness and database readiness are checked separately.");
} catch {
  console.error(
    "API startup failed. Check environment field names and build output; no private diagnostics were logged.",
  );
  process.exitCode = 1;
}
