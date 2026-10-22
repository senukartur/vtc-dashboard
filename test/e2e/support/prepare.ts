import { createHmac } from "node:crypto";
import { createUnitOfWork, databaseFailureContext, runMigrations } from "@vtc/db";
import { sql } from "@vtc/db/identity-schema";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import {
  type BrowserPreparationPhase,
  browserPreparationLine,
} from "../../../scripts/browser-diagnostics.mjs";
import { guardedSettings, testConnection } from "../../persistence/support.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret } from "./account.ts";

const started = performance.now();
async function phase<T>(
  name: BrowserPreparationPhase,
  work: () => Promise<T>,
  credential?: number,
): Promise<T> {
  const phaseStarted = performance.now();
  const emit = (state: "started" | "success" | "failed", extra = {}) =>
    console.log(
      browserPreparationLine({
        kind: "phase",
        phase: name,
        state,
        durationMs: Math.round(performance.now() - phaseStarted),
        totalDurationMs: Math.round(performance.now() - started),
        ...(credential === undefined ? {} : { credential }),
        ...extra,
      }),
    );
  emit("started");
  try {
    const result = await work();
    emit("success", name === "migrations" ? { applied: result } : {});
    return result;
  } catch (error) {
    try {
      const databaseOperation = databaseFailureContext(error);
      emit("failed", databaseOperation ? { databaseOperation } : {});
    } catch {
      // Diagnostics must not replace the original failure or expose its private object.
    }
    throw error;
  }
}

async function prepare() {
  const { settings, ownership } = await phase("ownership", async () => {
    const settings = guardedSettings();
    return { settings, ownership: await testConnection() };
  });
  try {
    await phase("synthetic_ddl", () =>
      ownership.query(
        "CREATE TABLE synthetic_browser_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
      ),
    );
  } finally {
    await phase("ownership_close", () => ownership.end());
  }
  await phase("migrations", () => runMigrations(settings));
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
    await phase("bootstrap", () =>
      identity.bootstrap({
        email: "browser@example.invalid",
        name: "Synthetic Browser Member",
        password,
      }),
    );
    for (const [index, project] of ["desktop", "tablet", "mobile"].entries()) {
      const credential = await phase(
        "credential_hash",
        () =>
          identity.prepareCredential(
            createHmac("sha256", guardedAllocation().token)
              .update(`browser-steam-${project}`)
              .digest("base64url"),
          ),
        index + 1,
      );
      await phase(
        "credential_insert",
        () =>
          unit.run((tx) =>
            identity.insertWithCredential(tx, {
              userId: crypto.randomUUID(),
              email: `browser-steam-${project}@example.invalid`,
              name: "Synthetic Browser Steam Member",
              roles: ["driver"],
              ...credential,
            }),
          ),
        index + 1,
      );
    }
  } finally {
    await phase("unit_close", () => unit.close());
  }
}

try {
  await prepare();
} catch {
  console.error("SYNTHETIC_BROWSER_FIXTURE_SETUP_FAILED");
  process.exitCode = 1;
}
