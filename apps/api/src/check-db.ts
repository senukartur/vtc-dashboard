import { createDatabase, expectedMysqlVersion } from "@vtc/db";
import { readConfig } from "./platform/config/env.js";

const database = createDatabase(readConfig().database);
try {
  if (!(await database.check())) throw new Error("DATABASE_BASELINE_MISMATCH");
  console.log(
    `MySQL ${expectedMysqlVersion}: authentication, UTC, strict modes, isolation and charset/collation verified.`,
  );
} catch {
  console.error("Database baseline check failed. No connection details were logged.");
  process.exitCode = 1;
} finally {
  await database.close();
}
