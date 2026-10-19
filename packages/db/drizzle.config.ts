import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: ["./src/schema/audit.ts", "./src/schema/identity/index.ts"],
  out: "./migrations",
  strict: true,
  verbose: true,
});
