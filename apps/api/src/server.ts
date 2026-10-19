import { createDatabase, createUnitOfWork } from "@vtc/db";
import { createApp } from "./app.js";
import { createIdentity } from "./modules/identity/service.js";
import { readConfig } from "./platform/config/env.js";
import { identityAccessEvents } from "./platform/outbox/events.js";

try {
  const config = readConfig();
  const database = createDatabase(config.database);
  const unit = config.identity ? createUnitOfWork(config.database) : undefined;
  const app = await createApp({
    checkReadiness: database.check,
    closeDatabase: async () => {
      await database.close();
      await unit?.close();
    },
    ...(config.identity && unit
      ? {
          identity: createIdentity(unit, config.identity, {
            accessEvents: identityAccessEvents(unit),
          }),
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
