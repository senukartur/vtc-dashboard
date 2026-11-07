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

test("a separate status job publishes the status the main ruleset requires", () => {
  const ruleset = JSON.parse(
    readFileSync(new URL("../../.github/rulesets/main.json", import.meta.url), "utf8"),
  );
  const checks = ruleset.rules.find(
    (rule: { type: string }) => rule.type === "required_status_checks",
  ).parameters.required_status_checks;
  expect(checks).toContainEqual({ context: "Advisory review", integration_id: 15368 });
  const [review = "", status = ""] = (workflow.split(/\r?\n {2}mention:/)[0] ?? "").split(
    /\r?\n {2}review-status:/,
  );
  // The Claude step reads untrusted PR content, so its job cannot publish the merge gate.
  expect(review).not.toContain("statuses: write");
  expect(review).not.toContain("createCommitStatus");
  expect(review).toMatch(/published: \$\{\{ steps\.publish\.outcome == 'success' \}\}/);
  expect(status).toMatch(/permissions:\r?\n {6}statuses: write\r?\n {4}steps:/);
  expect(status).toContain("needs: [review]");
  expect(status).toContain("context: 'Advisory review'");
  // A cancelled or timed-out review still gets a visible failure for its head.
  expect(status).toContain("always() &&");
  expect(status).toMatch(/REVIEW_RESULT: \$\{\{ needs\.review\.result \}\}/);
  expect(status).toMatch(/group: claude-review-status-.*\r?\n {6}cancel-in-progress: false/);
  // Reviews of different heads never cancel each other (VTC-075).
  expect(review).toMatch(
    /group: claude-review-\$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.number \|\| github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.event\.pull_request\.head\.sha \}\}/,
  );
  // The on-demand job must not publish the required status.
  expect(workflow.split(/\r?\n {2}mention:/)[1]).not.toContain("createCommitStatus");
});

test("a PR retargeted to the default branch reaches only the automatic review", () => {
  const [triggers = "", jobsSection = ""] = workflow.split(/\r?\njobs:\r?\n/);
  expect(triggers).toMatch(/pull_request_target:\r?\n {4}types: \[edited\]/);
  const [review = "", mention = ""] = jobsSection.split(/\r?\n {2}mention:/);
  // Only a base change onto the default branch of a same-repository PR starts a review.
  expect(review).toMatch(
    /github\.event_name == 'pull_request_target' &&\s+github\.event\.action == 'edited' &&\s+github\.event\.changes\.base &&\s+github\.event\.pull_request\.base\.ref == github\.event\.repository\.default_branch &&\s+github\.event\.pull_request\.head\.repo\.full_name == github\.repository\)/,
  );
  expect(mention).not.toContain("pull_request_target");
  // pull_request_target carries secrets: every checkout stays on the trusted base commit.
  const checkoutRefs = [
    ...workflow.matchAll(/uses: actions\/checkout@[^\n]*\n(?:.*\n)*?\s+ref: (.+)/g),
  ];
  expect(checkoutRefs).toHaveLength(2);
  for (const [, ref] of checkoutRefs)
    expect(ref?.trim()).toMatch(/^\$\{\{ steps\.target\.outputs\.base_sha \}\}$/);
});

test("a skipped or failed on-demand request is reported on the PR", () => {
  const mention = workflow.split(/\r?\n {2}mention:/)[1] ?? "";
  expect(mention).toMatch(/id: publish\r?\n\s+if: steps\.target\.outputs\.eligible == 'true'/);
  for (const reason of ["not-open", "fork", "dependabot", "base"])
    expect(mention).toContain(`skip_reason=${reason}`);
  const notice = mention.split("- name: Report a skipped or failed request")[1] ?? "";
  // A newer request cancels the older run, which must stay quiet.
  expect(notice).toMatch(/if: \$\{\{ !cancelled\(\) && steps\.publish\.outcome != 'success' \}\}/);
  expect(notice).toContain("github.rest.issues.createComment");
  // Fixed text only: no PR data and no mention that could trigger another request.
  const script = notice.split("script: |")[1] ?? "";
  expect(script).not.toContain("@");
  expect(script).not.toMatch(/github\.event|steps\.|\$\{\{/);
});
