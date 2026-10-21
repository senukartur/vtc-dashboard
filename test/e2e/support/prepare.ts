import { createHmac } from "node:crypto";
import { createUnitOfWork, runMigrations } from "@vtc/db";
import { sql } from "@vtc/db/identity-schema";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { guardedSettings, testConnection } from "../../persistence/support.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret } from "./account.ts";

async function prepare() {
  const settings = guardedSettings();
  const ownership = await testConnection();
  try {
    await ownership.query(
      "CREATE TABLE synthetic_browser_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
    );
  } finally {
    await ownership.end();
  }
  await runMigrations(settings);
  const secret = accountSecret("identity");
  const password = createHmac("sha256", guardedAllocation().token)
    .update("browser-identity-password")
    .digest("base64url");
  const unit = createUnitOfWork(settings);
  try {
    const identity = createIdentity(
      unit,
      { secret, origin: "http://127.0.0.1:4173", production: false },
      {
        accessEvents: {
          append: async (tx, event) => {
            await unit
              .client(tx)
              .execute(sql`INSERT INTO synthetic_browser_events VALUES (${event.eventId})`);
          },
        },
      },
    );
    await identity.bootstrap({
      email: "browser@example.invalid",
      name: "Synthetic Browser Member",
      password,
    });
    for (const project of ["desktop", "tablet", "mobile"]) {
      const credential = await identity.prepareCredential(
        createHmac("sha256", guardedAllocation().token)
          .update(`browser-steam-${project}`)
          .digest("base64url"),
      );
      await unit.run((tx) =>
        identity.insertWithCredential(tx, {
          userId: crypto.randomUUID(),
          email: `browser-steam-${project}@example.invalid`,
          name: "Synthetic Browser Steam Member",
          roles: ["driver"],
          ...credential,
        }),
      );
    }
  } finally {
    await unit.close();
  }
}

try {
  await prepare();
} catch {
  console.error("SYNTHETIC_BROWSER_FIXTURE_SETUP_FAILED");
  process.exitCode = 1;
}
