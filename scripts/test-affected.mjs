import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  affectedTests,
  groupSelection,
  listTestFiles,
  selectableLanes,
  validProject,
} from "./test-selection.mjs";

// pnpm test:affected [--base <ref>] [--run] [--skip-check] [--project <name>]
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2).filter((value) => value !== "--");
let base = "";
let execute = false;
const forwarded = [];
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--run") execute = true;
  else if (value === "--skip-check") forwarded.push(value);
  else if (value === "--base" && /^[A-Za-z0-9._/-]+$/.test(args[index + 1] ?? "")) {
    base = args[index + 1];
    index += 1;
  } else if (value === "--project" && validProject(args[index + 1])) {
    forwarded.push(value, args[index + 1]);
    index += 1;
  } else throw new Error("INVALID_AFFECTED_ARGUMENTS");
}

const git = (...command) =>
  execFileSync("git", command, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
function resolveBase() {
  for (const candidate of base ? [base] : ["origin/main", "main"])
    try {
      return git("merge-base", candidate, "HEAD");
    } catch {
      /* Try the next candidate. */
    }
  throw new Error("AFFECTED_BASE_NOT_FOUND");
}
const lines = (output) => output.split("\n").filter(Boolean);
// Committed, staged, unstaged and untracked changes since the merge base.
const changed = [
  ...new Set([
    ...lines(git("diff", "--name-only", resolveBase())),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ]),
].sort();
const exists = (path) => existsSync(resolve(root, path));
const { tokens, reasons } = affectedTests(changed, listTestFiles(root), exists);

console.log(`Changed paths: ${changed.length}`);
for (const reason of reasons) console.log(`  ${reason}`);
if (!tokens.length) {
  console.log("No tests selected. Run pnpm check and pnpm build; CI runs the full suite.");
  process.exit(0);
}
console.log("Selected:");
const groups = groupSelection(tokens, exists);
for (const { lane, files } of groups)
  console.log(`  ${lane}: ${files.length ? files.join(" ") : "whole lane"}`);
// A browser project only applies when a browser lane is selected.
if (!groups.some(({ lane }) => lane === "e2e") && forwarded.includes("--project"))
  forwarded.splice(forwarded.indexOf("--project"), 2);
if (selectableLanes.every((lane) => tokens.includes(lane)))
  console.log("Every lane is selected; this equals a full local run of roughly 40-50 minutes.");
if (!execute) {
  console.log("Dry run. Add --run to execute through the isolated launcher.");
  process.exit(0);
}
const child = spawn(
  process.execPath,
  ["scripts/test-local.mjs", "selected", ...forwarded, "--", ...tokens],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
