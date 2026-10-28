import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// AGENTS.md is loaded into every agent session; details belong in docs/development/agent-rules.md.
test("AGENTS.md stays within its always-loaded size budget", async () => {
  const text = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.ok(text.length <= 1200, `AGENTS.md has ${text.length} characters; limit is 1200`);
});
