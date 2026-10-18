import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, test } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/claude-review.yml", import.meta.url),
  "utf8",
);
const jobs = ["review", "mention"] as const;

function reviewValidator(job: (typeof jobs)[number]) {
  const section = workflow
    .split(/\r?\n {2}(?=\S)/)
    .find((part) => part.startsWith(`${job}:\n`) || part.startsWith(`${job}:\r\n`));
  expect(section, "The configured review job must exist").toBeDefined();
  const arguments_ = [...(section ?? "").matchAll(/^\s+--json-schema '([^'\r\n]+)'\s*$/gm)];
  expect(arguments_, "Each review path must supply exactly one CLI schema").toHaveLength(1);
  const argument = arguments_[0]?.[1];
  if (argument === undefined) throw new Error("REVIEW_SCHEMA_ARGUMENT_MISSING");
  const schema = JSON.parse(argument);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  expect(ajv.validateSchema(schema), "The embedded schema must satisfy its meta-schema").toBe(true);
  return ajv.compile(schema);
}

const finding = { path: "apps/api/src/server.ts", line: 1, body: "Synthetic finding." };

test.each(jobs)("%s CLI schema accepts empty and bounded inline review results", (job) => {
  const validate = reviewValidator(job);
  expect(validate({ summary: "No findings.", findings: [] })).toBe(true);
  expect(validate({ summary: "Synthetic review.", findings: [finding] })).toBe(true);
  expect(validate({ summary: "Synthetic review.", findings: Array(20).fill(finding) })).toBe(true);
});

test.each(jobs)("%s CLI schema rejects malformed, missing and unexpected review data", (job) => {
  const validate = reviewValidator(job);
  expect(() => validate(JSON.parse('{"summary":'))).toThrow(SyntaxError);
  for (const result of [
    null,
    [],
    "review",
    {},
    { summary: "Missing findings." },
    { findings: [] },
    { summary: 1, findings: [] },
    { summary: "Wrong findings type.", findings: {} },
    { summary: "Unexpected root field.", findings: [], unexpected: "synthetic" },
    { summary: "Too many findings.", findings: Array(21).fill(finding) },
  ])
    expect(validate(result)).toBe(false);
  for (const invalid of [
    null,
    "finding",
    {},
    { line: 1, body: finding.body },
    { path: finding.path, body: finding.body },
    { path: finding.path, line: 1 },
    { ...finding, path: 1 },
    { ...finding, body: [] },
    { ...finding, unexpected: "synthetic" },
    ...[0, -1, 1.5, "1", null, true].map((line) => ({ ...finding, line })),
  ])
    expect(validate({ summary: "Invalid finding.", findings: [invalid] })).toBe(false);
});
