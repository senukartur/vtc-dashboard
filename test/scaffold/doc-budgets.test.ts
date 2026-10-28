import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// These files are read at the start of most agent sessions; details belong in linked docs.
const budgets = [
  ["AGENTS.md", 1200],
  ["docs/CONCEPT.MD", 6000],
] as const;

for (const [file, limit] of budgets) {
  test(`${file} stays within its always-read size budget`, async () => {
    const text = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(text.length <= limit, `${file} has ${text.length} characters; limit is ${limit}`);
  });
}
