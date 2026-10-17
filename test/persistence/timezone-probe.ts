import { createUnitOfWork, settingsFromEnvironment, utcDateTime, utcIso } from "@vtc/db";
import { sql } from "drizzle-orm";
import { guardedSettings } from "./support.ts";

guardedSettings();
const unit = createUnitOfWork(settingsFromEnvironment());
try {
  await unit.run(async (tx) => {
    const result = await unit
      .client(tx)
      .execute(
        sql`SELECT occurred_at FROM synthetic_values WHERE opaque_key = ${Buffer.from("committed")}`,
      );
    const rows = result[0] as unknown as { occurred_at: string }[];
    if (rows[0]?.occurred_at !== "2026-02-01 02:45:01.123") process.exitCode = 2;
  });
  if (utcIso(utcDateTime("2026-02-01T05:45:01.123+03:00")) !== "2026-02-01T02:45:01.123Z")
    process.exitCode = 3;
} finally {
  await unit.close();
}
