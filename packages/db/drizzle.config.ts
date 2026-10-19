import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: ["./src/schema/audit.ts", "./src/schema/identity/index.ts", "./src/schema/platform.ts"],
  out: "./migrations",
  strict: true,
  verbose: true,
});
