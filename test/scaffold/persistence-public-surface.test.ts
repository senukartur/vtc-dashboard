import assert from "node:assert/strict";
import { test } from "node:test";
import * as database from "@vtc/db";

test("public database surface exposes audit append without its writable table", async () => {
  assert.equal(Object.hasOwn(database, "auditEntries"), false);
  // The real pool is lazy: inspecting its facade never opens a database connection.
  const unit = database.createUnitOfWork({
    host: "127.0.0.1",
    port: 1,
    database: "synthetic_database",
    user: "synthetic_user",
    password: "NONFUNCTIONAL_EXAMPLE_ONLY",
  });
  try {
    const audit = database.createAudit(unit);
    assert.equal(typeof audit.append, "function");
    assert.deepEqual(Object.keys(audit), ["append"]);
  } finally {
    await unit.close();
  }
});
