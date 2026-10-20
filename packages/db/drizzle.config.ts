import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: [
    "./src/schema/audit.ts",
    "./src/schema/identity/index.ts",
    "./src/schema/platform.ts",
    "./src/schema/messaging.ts",
    "./src/schema/admissions/index.ts",
    "./src/schema/qualifications/index.ts",
    "./src/schema/external-identities/index.ts",
    "./src/schema/catalogs/index.ts",
    "./src/schema/trips/index.ts",
  ],
  out: "./migrations",
  strict: true,
  verbose: true,
});
