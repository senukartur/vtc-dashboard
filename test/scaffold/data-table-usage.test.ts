import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { posix, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// VTC-155: every cabinet table uses the shared DataTable and every paged list the shared Pager
// and cursor hook (docs/development/ui-foundation.md). A scaffold test rather than a Biome rule:
// noRestrictedImports cannot express the JSX <table> rule or per-file exceptions without
// changing the root biome.json.

type Rule = "table-markup" | "table-import" | "page-nav" | "pager";

const root = fileURLToPath(new URL("../../apps/web/src/", import.meta.url));

/**
 * Files not yet moved to the shared table or pager, by rule. The map only shrinks: a new
 * violation fails, and so does an entry whose file no longer violates its rule. The final
 * VTC-155 pull request empties it.
 */
const pending: Record<string, Rule[]> = {
  "features/admin/ApplicationsPage.tsx": ["pager", "table-import"],
  "features/admin/MembersPage.tsx": ["pager", "table-import"],
  "features/admin/SettingsPage.tsx": ["pager", "table-markup"],
  "features/admin/components.tsx": ["pager"],
  "features/catalogs/CatalogImport.tsx": ["table-markup"],
  "features/catalogs/CatalogTable.tsx": ["table-import"],
  "features/catalogs/DepotRows.tsx": ["table-import"],
  "features/connections/ConnectionsSection.tsx": ["pager"],
  "features/dashboard/components.tsx": ["table-import"],
  "features/drivers/DriversPage.tsx": ["table-import"],
  "features/drivers/components.tsx": ["table-import"],
  "features/qualifications/levels.tsx": ["table-import"],
  "features/review/decision-parts.tsx": ["table-markup"],
};

const sharedUi = /^shared\/ui\//;
const tableModule = /^shared\/ui\/(?:primitives|variants)(?:\.js)?$/;
const pagerModule = /^shared\/ui\/pager(?:\.js)?$/;
const namedImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

function importedNames(specifiers: string) {
  return specifiers
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim(),
    )
    .filter((name): name is string => !!name);
}

/** Rules a web source file breaks; `file` is relative to apps/web/src with forward slashes. */
function violations(file: string, source: string): Rule[] {
  const found = new Set<Rule>();
  const inSharedUi = sharedUi.test(file);
  if (!inSharedUi && /<table[\s>]/.test(source)) found.add("table-markup");
  for (const [, specifiers = "", specifier = ""] of source.matchAll(namedImport)) {
    const names = importedNames(specifiers);
    // Module path relative to apps/web/src, so "./pager.js" inside shared/ui is shared/ui/pager.
    const from = specifier.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(file), specifier))
      : specifier;
    if (
      !inSharedUi &&
      tableModule.test(from) &&
      names.some((name) => name === "Table" || name === "tableVariants")
    )
      found.add("table-import");
    if (names.includes("Pager") && !pagerModule.test(from)) found.add("pager");
  }
  if (/\bPageNav\b/.test(source)) found.add("page-nav");
  if (file !== "shared/ui/pager.tsx" && /\b(?:function|class|const|let|var)\s+Pager\b/.test(source))
    found.add("pager");
  return [...found].sort();
}

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}${sep}${entry.name}`;
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

test("the usage rules recognize tables, direct Table imports and old pagers", () => {
  assert.deepEqual(violations("features/x/A.tsx", "return <table className='a'>"), [
    "table-markup",
  ]);
  assert.deepEqual(violations("features/x/A.tsx", "<table>\n<tbody/>"), ["table-markup"]);
  assert.deepEqual(violations("features/x/A.tsx", "const tableau = <tablet />;"), []);
  assert.deepEqual(violations("shared/ui/DataTable.tsx", "<table>"), []);
  assert.deepEqual(
    violations(
      "features/x/A.tsx",
      'import { Badge, Table as T } from "../../shared/ui/primitives.js";',
    ),
    ["table-import"],
  );
  assert.deepEqual(
    violations("features/x/A.tsx", 'import { tableVariants } from "../../shared/ui/variants.js";'),
    ["table-import"],
  );
  assert.deepEqual(
    violations("features/x/A.tsx", 'import { DataTable } from "../../shared/ui/DataTable.js";'),
    [],
  );
  assert.deepEqual(violations("features/x/A.tsx", "export function PageNav() {}"), ["page-nav"]);
  assert.deepEqual(
    violations("features/x/A.tsx", 'import { Pager } from "../admin/components.js";'),
    ["pager"],
  );
  assert.deepEqual(violations("features/x/A.tsx", "export function Pager() {}"), ["pager"]);
  assert.deepEqual(
    violations("features/x/A.tsx", 'import { Pager } from "../../shared/ui/pager.js";'),
    [],
  );
  assert.deepEqual(violations("shared/ui/pager.tsx", "export function Pager() {}"), []);
});

test("tables and pagers outside shared/ui match the shrinking pending list exactly", async () => {
  const actual: Record<string, Rule[]> = {};
  for (const path of (await sources(root.replace(/[\\/]$/, ""))).sort()) {
    const file = relative(root, path).split(sep).join("/");
    const found = violations(file, await readFile(path, "utf8"));
    if (found.length) actual[file] = found;
  }
  assert.deepEqual(actual, pending);
});
