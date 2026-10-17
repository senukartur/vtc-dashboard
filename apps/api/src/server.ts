import { createDatabase } from "@vtc/db";
import { createApp } from "./app.js";
import { readConfig } from "./platform/config/env.js";

try {
  const config = readConfig();
  const database = createDatabase(config.database);
  const app = await createApp({
    checkReadiness: database.check,
    closeDatabase: database.close,
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
