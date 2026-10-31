import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDatabase, createUnitOfWork, settingsFromEnvironment } from "@vtc/db";
import { company, eq } from "@vtc/db/identity-schema";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { assertDemoTarget, demoEmail, demoId } from "./dataset.ts";
import { seedDashboard } from "./seed.ts";

try {
  assertDemoTarget(process.env);
  const settings = settingsFromEnvironment();
  const database = createDatabase(settings);
  try {
    if (!(await database.check())) throw new Error("DEMO_MYSQL_BASELINE_REQUIRED");
  } finally {
    await database.close();
  }
  const unit = createUnitOfWork(settings);
  try {
    const [existing] = await unit.run((tx) =>
      unit.client(tx).select().from(company).where(eq(company.singleton, 1)),
    );
    if (existing && existing.id !== demoId("company"))
      throw new Error("DEMO_REFUSES_EXISTING_COMPANY");
    const location = new URL("../../.local/demo/login.json", import.meta.url);
    await mkdir(new URL(".", location), { recursive: true });
    if (existing) {
      try {
        await readFile(location);
      } catch {
        throw new Error("DEMO_PRIVATE_LOGIN_MISSING");
      }
    }
    try {
      await writeFile(
        location,
        JSON.stringify(
          { email: demoEmail, password: randomBytes(24).toString("base64url") },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const login = JSON.parse(await readFile(location, "utf8")) as {
      email: string;
      password: string;
    };
    if (
      login.email !== demoEmail ||
      typeof login.password !== "string" ||
      login.password.length < 16
    )
      throw new Error("DEMO_PRIVATE_LOGIN_INVALID");
    const identity = createIdentity(unit, {
      secret: randomBytes(32).toString("hex"),
      origin: "http://127.0.0.1:5173",
      production: false,
    });
    const credential = await identity.prepareCredential(login.password);
    const result = await seedDashboard(unit, identity, credential.passwordHash);
    console.log(
      `Local demo ready: ${result.members} members, ${result.addedTrips} new trips, ${result.addedEvents} new events. Private login: .local/demo/login.json`,
    );
  } finally {
    await unit.close();
  }
} catch (error) {
  const category =
    error instanceof Error && /^DEMO_[A-Z_]+$/.test(error.message)
      ? error.message
      : "DEMO_SEED_FAILED";
  console.error(`${category}. Apply local migrations first; no private diagnostics were logged.`);
  process.exitCode = 1;
}
