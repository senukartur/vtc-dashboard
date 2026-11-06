import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createUnitOfWork, settingsFromEnvironment } from "@vtc/db";
import { seedDashboard } from "./demo-seed.js";
import { createIdentity } from "./modules/identity/service.js";

// Root-only `operations.py stage-seed` entry. Adds the synthetic fixture to the development host's
// existing company. The password arrives on stdin, so it never enters argv, env or output.
let unit: ReturnType<typeof createUnitOfWork> | undefined;
const watchdog = setTimeout(() => process.exit(1), 150000);
try {
  const password = readFileSync(0, "utf8").trim();
  const settings = settingsFromEnvironment();
  if (
    process.env.VTC_STAGE_SEED !== "synthetic-only" ||
    process.argv.length !== 2 ||
    settings.database !== "vtc" ||
    password.length < 16
  )
    throw new Error("DEMO_STAGE_TARGET_REQUIRED");
  unit = createUnitOfWork(settings);
  const identity = createIdentity(unit, {
    secret: randomBytes(32).toString("hex"),
    origin: "https://stage-seed.invalid",
    production: false,
  });
  const { passwordHash } = await identity.prepareCredential(password);
  const result = await seedDashboard(unit, identity, passwordHash, new Date(), {
    adoptCompany: true,
  });
  console.log(JSON.stringify({ event: "stage_seed_result", ...result }));
} catch (error) {
  const category =
    error instanceof Error && /^DEMO_[A-Z_]+$/.test(error.message)
      ? error.message
      : "DEMO_SEED_FAILED";
  console.error(JSON.stringify({ event: "stage_seed_failed", category }));
  process.exitCode = 1;
} finally {
  await unit?.close();
  clearTimeout(watchdog);
}
