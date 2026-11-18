import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const cli = resolve(".agents/skills/parse-dlc/scripts/parse-dlc.mjs");
const temporary: string[] = [];
const unit = (type: string, id: string, fields: Record<string, string>) =>
  `${type} : ${id} {\n${Object.entries(fields)
    .map(([key, value]) => ` ${key}: ${value}`)
    .join("\n")}\n}\n`;
type Pack = {
  id: string;
  root: string;
  registrations: string[];
  manifest?: string;
  dlcCode?: string;
};
type Source = {
  code: string;
  status: string;
  basePresent: boolean;
  contributors: string[];
  complete: boolean;
  dlcCode: string | null;
};
type Report = {
  complete: boolean;
  regionSources: Source[];
  corrections: number;
  excluded: { code: string; reason: string }[];
  gaps: string[];
  conflicts: string[];
};
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing fictional fixture value");
  return value;
}
const unrelatedBase = { survey_base_city: "survey_base_region" };
function fixture(game: "ets2" | "ats" = "ets2") {
  const dir = mkdtempSync(join(tmpdir(), "vtc-fictional-regions-"));
  temporary.push(dir);
  const put = (path: string, bytes: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  const packs: Pack[] = [];
  const primarySources: { code: string; dlcCode: string; reason: string }[] = [];
  const pack = (id: string, cities: Record<string, string>, app = "900001") => {
    const root = join(dir, id);
    const reg = id === "base" ? "def/city.sii" : `def/city.${id}.sii`;
    put(
      join(root, reg),
      Object.entries(cities)
        .map(([code]) => `@include "city/${code}.sii"\n`)
        .join(""),
    );
    for (const [code, region] of Object.entries(cities))
      put(
        join(root, `def/city/${code}.sii`),
        unit("city_data", `city.${code}`, { country: region, city_name: `"Fictional ${code}"` }),
      );
    const entry: Pack = { id, root, registrations: [reg] };
    if (id !== "base") {
      entry.manifest = `${id}.manifest.sii`;
      entry.dlcCode = `dlc.${app}`;
      put(
        join(root, entry.manifest),
        unit("dlc_package", `.${id}`, { id, steam_app_id: app, display_name: '"Fictional Pack"' }),
      );
    }
    packs.push(entry);
    return entry;
  };
  const hosted = {
    game,
    regions: ["base_region", "addon_region", "split_region", "unknown_region"].map((code) => ({
      code,
      name_en: `Hosted ${code}`,
      name_ru: "Сохранено",
      dlc_code: "",
    })),
    dlcs: [
      { code: "dlc.900001", hidden: false },
      { code: "dlc.900002", hidden: false },
    ],
  };
  let count = 0;
  const evidence = (complete = true, expectedPacks = packs.map((item) => item.id)) => {
    const file = join(dir, "evidence.json");
    put(
      file,
      JSON.stringify({
        schemaVersion: 1,
        game,
        coverage: { complete, expectedPacks },
        packs,
        primarySources,
      }),
    );
    return file;
  };
  const run = (extra: string[] = [], complete = true, expected?: string[]) => {
    const out = join(dir, `audit-${count++}`);
    const host = join(dir, "hosted.json");
    put(host, JSON.stringify(hosted));
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "audit-regions",
        "--game",
        game,
        "--region-evidence",
        evidence(complete, expected),
        "--hosted",
        host,
        "--out",
        out,
        ...extra,
      ],
      { encoding: "utf8" },
    );
    return {
      result,
      out,
      report:
        result.status === 0
          ? (JSON.parse(readFileSync(join(out, "report.json"), "utf8")) as Report)
          : null,
    };
  };
  return { dir, put, pack, packs, primarySources, hosted, evidence, run };
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("audit resolves explicit base/unique/split evidence deterministically, preserving exact hosted names", () => {
  const f = fixture();
  f.pack("base", { old_city: "base_region" });
  const first = f.pack("dlc_one", {
    new_city: "addon_region",
    extra_city: "base_region",
    split_one: "split_region",
  });
  f.pack("dlc_two", { split_two: "split_region" }, "900002");
  // An arbitrary city definition, never included by a registration, is not evidence.
  f.put(
    join(first.root, "def/city/dormant.sii"),
    unit("city_data", "city.dormant", { country: "unknown_region" }),
  );
  required(f.hosted.regions[1]).name_en = 'Hosted exact, "name"';
  const a = f.run();
  expect(a.result.status, a.result.stderr).toBe(0);
  expect(a.report?.regionSources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "base_region",
        status: "base-present",
        basePresent: true,
        contributors: ["dlc.900001"],
      }),
      expect.objectContaining({
        code: "addon_region",
        status: "unique-dlc",
        dlcCode: "dlc.900001",
      }),
      expect.objectContaining({ code: "split_region", status: "ambiguous", dlcCode: null }),
      expect.objectContaining({ code: "unknown_region", status: "unresolved", basePresent: false }),
    ]),
  );
  expect(readFileSync(join(a.out, "regions.csv"), "utf8")).toBe(
    'game,code,name_en,name_ru,dlc_code\nets2,addon_region,"Hosted exact, ""name""",Сохранено,dlc.900001\n',
  );
  f.packs.reverse();
  for (const p of f.packs) p.registrations.reverse();
  const b = f.run();
  expect(b.report).toEqual(a.report);
  expect(readFileSync(join(b.out, "regions.csv"), "utf8")).toBe(
    readFileSync(join(a.out, "regions.csv"), "utf8"),
  );
});

test.each([
  "incomplete",
  "missing-pack",
  "missing-identity",
  "missing-include",
  "unlisted-registration",
])("%s survey never proves unique ownership", (kind) => {
  const f = fixture();
  f.pack("base", { old_city: "base_region" });
  const pack = f.pack("dlc_one", { new_city: "addon_region" });
  if (kind === "missing-identity") delete pack.manifest;
  if (kind === "missing-include")
    f.put(join(pack.root, required(pack.registrations[0])), '@include "city/missing.sii"\n');
  if (kind === "unlisted-registration") f.put(join(pack.root, "def/city.extra.sii"), "");
  const output = f.run(
    [],
    kind !== "incomplete",
    kind === "missing-pack" ? ["base", "dlc_one", "dlc_absent"] : undefined,
  );
  expect(output.result.status, output.result.stderr).toBe(0);
  expect(output.report).toMatchObject({ complete: false, corrections: 0 });
  expect(output.report?.regionSources.find((row) => row.code === "addon_region")).toMatchObject({
    status: "unresolved",
    basePresent: false,
    dlcCode: null,
  });
  expect(output.report?.regionSources.find((row) => row.code === "base_region")?.status).toBe(
    "base-present",
  );
});

for (const game of ["ets2", "ats"] as const) {
  test.each(["missing-def", "empty-registration-array", "empty-active-registration"])(
    `${game} %s base evidence cannot establish unique ownership of a DLC extension`,
    (kind) => {
      const f = fixture(game);
      const base = f.pack("base", { old_city: "base_region" });
      f.pack("dlc_one", { extension: "base_region" });
      if (kind === "missing-def") {
        base.root = join(f.dir, "wrong-base-root");
        base.registrations = [];
        mkdirSync(base.root);
      } else if (kind === "empty-registration-array") {
        base.root = join(f.dir, "empty-base-root");
        base.registrations = [];
        mkdirSync(join(base.root, "def"), { recursive: true });
      } else {
        // The old city definition remains on disk, but is no longer registered.
        f.put(join(base.root, "def/city.sii"), "");
      }
      const output = f.run();
      expect(output.result.status, output.result.stderr).toBe(0);
      expect(output.report).toMatchObject({ complete: false, corrections: 0 });
      expect(output.report?.gaps).toContain("base: no validated active city registrations");
      if (kind !== "empty-active-registration")
        expect(output.report?.gaps).toContain("base: no active city registration inventory");
      expect(output.report?.regionSources.find((row) => row.code === "base_region")).toMatchObject({
        status: "unresolved",
        basePresent: false,
        contributors: ["dlc.900001"],
        dlcCode: null,
      });
      expect(readFileSync(join(output.out, "regions.csv"), "utf8")).toBe(
        "game,code,name_en,name_ru,dlc_code\n",
      );
    },
  );
}

test.each(["country", "identity", "shared-file", "country-field"])(
  "conflicting %s evidence is ambiguous regardless of pack order",
  (kind) => {
    const f = fixture();
    const basePack = f.pack(
      "base",
      kind === "country-field" ? { old_city: "base_region" } : unrelatedBase,
    );
    if (kind === "country-field")
      f.put(
        join(basePack.root, "def/city/old_city.sii"),
        "city_data : city.old_city {\n country: addon_region\n country: base_region\n}\n",
      );
    const one = f.pack("dlc_one", { shared: "addon_region" });
    const two = f.pack(
      "dlc_two",
      { shared: kind === "country" ? "split_region" : "addon_region" },
      "900002",
    );
    if (kind === "identity") two.dlcCode = required(one.dlcCode);
    if (kind === "shared-file") {
      f.put(join(one.root, required(one.registrations[0])), '@include "/def/city/elsewhere.sii"\n');
      f.put(
        join(two.root, "def/city/elsewhere.sii"),
        unit("city_data", "city.shared", { country: "split_region" }),
      );
      const base = required(f.packs.find((p) => p.id === "base"));
      f.put(
        join(base.root, "def/city/elsewhere.sii"),
        unit("city_data", "city.shared", { country: "base_region" }),
      );
    }
    const a = f.run();
    expect(a.result.status, a.result.stderr).toBe(0);
    expect(a.report?.regionSources.find((row) => row.code === "addon_region")?.status).toBe(
      "ambiguous",
    );
    expect(a.report?.corrections).toBe(0);
    if (kind === "country-field")
      expect(a.report?.regionSources.find((row) => row.code === "base_region")?.status).toBe(
        "ambiguous",
      );
    f.packs.reverse();
    expect(f.run().report).toEqual(a.report);
  },
);

test("a reviewed primary source retains all split contributors and is independent of input order", () => {
  const f = fixture();
  f.pack("base", unrelatedBase);
  f.pack("dlc_one", { first: "split_region" });
  f.pack("dlc_two", { second: "split_region" }, "900002");
  f.primarySources.push({
    code: "split_region",
    dlcCode: "dlc.900001",
    reason: "Owner-reviewed fictional primary",
  });
  const a = f.run();
  expect(a.result.status, a.result.stderr).toBe(0);
  expect(a.report?.regionSources).toContainEqual(
    expect.objectContaining({
      code: "split_region",
      status: "primary-dlc",
      dlcCode: "dlc.900001",
      primaryReason: "Owner-reviewed fictional primary",
      contributors: ["dlc.900001", "dlc.900002"],
    }),
  );
  expect(readFileSync(join(a.out, "regions.csv"), "utf8")).toContain(
    "ets2,split_region,Hosted split_region,Сохранено,dlc.900001",
  );
  f.packs.reverse();
  expect(f.run().report).toEqual(a.report);
});

test.each([
  "unknown-contributor",
  "incomplete",
  "base-present",
  "duplicate",
  "unresolved",
  "country-conflict",
])("invalid %s primary mapping is rejected", (kind) => {
  const f = fixture();
  f.pack("base", kind === "base-present" ? { original: "split_region" } : unrelatedBase);
  f.pack("dlc_one", { first: "split_region" });
  f.pack(
    "dlc_two",
    { second: "split_region", ...(kind === "country-conflict" ? { first: "addon_region" } : {}) },
    "900002",
  );
  const mapping = {
    code: kind === "unresolved" ? "unknown_region" : "split_region",
    dlcCode: kind === "unknown-contributor" ? "dlc.999999" : "dlc.900001",
    reason: "Owner-reviewed fictional primary",
  };
  f.primarySources.push(mapping);
  if (kind === "duplicate") f.primarySources.push({ ...mapping, dlcCode: "dlc.900002" });
  const output = f.run([], kind !== "incomplete");
  expect(output.result.status).toBe(2);
  expect(output.report).toBeNull();
});

test("correction excludes unavailable/hidden parents, byte-distinct rows and base source clearing", () => {
  const f = fixture();
  f.pack("base", { original: "base_region" });
  f.pack("dlc_one", { new_city: "addon_region" });
  required(f.hosted.regions[0]).dlc_code = "dlc.900001";
  f.hosted.regions.push({ code: "Addon_region", name_en: "Distinct", name_ru: "", dlc_code: "" });
  required(f.hosted.dlcs[0]).hidden = true;
  let result = f.run();
  expect(result.report?.corrections).toBe(0);
  expect(result.report?.excluded).toEqual(
    expect.arrayContaining([
      { code: "base_region", reason: "source clearing requires the form; CSV blank preserves it" },
      { code: "addon_region", reason: "verified source is hidden" },
      { code: "Addon_region", reason: "unresolved" },
    ]),
  );
  f.hosted.dlcs.splice(0, 1);
  result = f.run();
  expect(result.report?.excluded).toContainEqual({
    code: "addon_region",
    reason: "verified source is absent from inspected same-game DLCs",
  });
  const host = JSON.parse(JSON.stringify(f.hosted));
  host.game = "ats";
  f.put(join(f.dir, "wrong-game.json"), JSON.stringify(host));
  expect(f.run(["--hosted", join(f.dir, "wrong-game.json")]).result.status).toBe(2);
});

test("audit rejects root escapes and refuses to overwrite output", () => {
  const f = fixture();
  f.pack("base", unrelatedBase);
  const one = f.pack("dlc_one", { city: "addon_region" });
  const first = f.run();
  expect(first.result.status).toBe(0);
  const retry = spawnSync(
    process.execPath,
    [
      cli,
      "audit-regions",
      "--game",
      "ets2",
      "--region-evidence",
      f.evidence(),
      "--hosted",
      join(f.dir, "hosted.json"),
      "--out",
      first.out,
    ],
    { encoding: "utf8" },
  );
  expect(retry.status).toBe(2);
  one.manifest = "../outside.manifest.sii";
  expect(f.run().result.status).toBe(2);
});

// Node is the fake extractor: every synthetic .scs is an executable JS program.
// No platform-specific shell executable or installed game data is needed.
function fakeArchive(path: string, files: Record<string, string>) {
  writeFileSync(
    path,
    `const fs = require("node:fs"), p = require("node:path");\nconst files = ${JSON.stringify(files)};\nif (process.argv.includes("--list")) console.log(Object.keys(files).map(x => "/" + x).join("\\n"));\nelse { const dest = process.argv[process.argv.indexOf("-d") + 1]; for (const [name, text] of Object.entries(files)) { const file = p.join(dest, name); fs.mkdirSync(p.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } }\n`,
  );
}

test("build uses registration availability for country labels in def.scs and diagnoses known ambiguous regions", () => {
  const f = fixture();
  f.pack("base", { old_city: "base_region" });
  const one = f.pack("dlc_one", {
    new_city: "addon_region",
    extension: "base_region",
    split_one: "split_region",
  });
  const two = f.pack("dlc_two", { split_two: "split_region" }, "900002");
  const game = join(f.dir, "game");
  mkdirSync(game);
  fakeArchive(join(game, "dlc_one.scs"), {
    "dlc_one.manifest.sii": readFileSync(join(one.root, required(one.manifest)), "utf8"),
    [required(one.registrations[0])]: readFileSync(
      join(one.root, required(one.registrations[0])),
      "utf8",
    ),
    ...Object.fromEntries(
      ["new_city", "extension", "split_one"].map((code) => [
        `def/city/${code}.sii`,
        readFileSync(join(one.root, `def/city/${code}.sii`), "utf8"),
      ]),
    ),
  });
  fakeArchive(join(game, "dlc_two.scs"), {
    "dlc_two.manifest.sii": readFileSync(join(two.root, required(two.manifest)), "utf8"),
  });
  fakeArchive(join(game, "def.scs"), {
    "def/country.sii": ["base_region", "addon_region", "split_region"]
      .map((code) => unit("country_data", `country.data.${code}`, { name: `"Label ${code}"` }))
      .join("\n"),
  });
  fakeArchive(join(game, "locale.scs"), {
    "locale/en_us/localization.sui": 'key[]: "fictional"\nval[]: "Fictional"\n',
  });
  const build = (out: string, known?: string) =>
    spawnSync(
      process.execPath,
      [
        cli,
        "build",
        "--game",
        "ets2",
        "--dlc",
        "dlc_one",
        "--game-dir",
        game,
        "--extractor",
        process.execPath,
        "--region-evidence",
        f.evidence(),
        "--cache",
        join(f.dir, "cache"),
        "--out",
        out,
        ...(known ? ["--known", known] : []),
      ],
      { encoding: "utf8" },
    );
  const failedOut = join(f.dir, "build-failed");
  const failed = build(failedOut);
  expect(failed.status, failed.stderr).toBe(1);
  const report = JSON.parse(readFileSync(join(failedOut, "report.json"), "utf8"));
  expect(report.fromBaseGame.regions).toEqual(["base_region"]);
  expect(report.failures).toEqual(
    expect.arrayContaining([expect.stringContaining("split_region")]),
  );
  const regionCsv = readFileSync(join(failedOut, "import/regions.csv"), "utf8");
  expect(regionCsv).toContain("ets2,addon_region,Label addon_region,,dlc.900001");
  expect(regionCsv).not.toContain("split_region");
  const known = join(f.dir, "known");
  f.put(
    join(known, "regions.csv"),
    "game,code,name_en,name_ru,dlc_code\nets2,split_region,Known,,\n",
  );
  const successOut = join(f.dir, "build-known");
  const success = build(successOut, known);
  expect(success.status, success.stderr).toBe(0);
  const kept = JSON.parse(readFileSync(join(successOut, "report.json"), "utf8"));
  expect(kept.regionSources).toContainEqual(
    expect.objectContaining({ code: "split_region", status: "ambiguous" }),
  );
  expect(kept.warnings).toContainEqual(
    expect.stringContaining("known region split_region: ambiguous"),
  );
  f.primarySources.push({
    code: "split_region",
    dlcCode: "dlc.900001",
    reason: "Owner-reviewed fictional primary",
  });
  const primaryOut = join(f.dir, "build-primary");
  const primaryBuild = build(primaryOut);
  expect(primaryBuild.status, primaryBuild.stderr).toBe(0);
  const primaryReport = JSON.parse(readFileSync(join(primaryOut, "report.json"), "utf8"));
  expect(primaryReport.regionSources).toContainEqual(
    expect.objectContaining({ code: "split_region", status: "primary-dlc" }),
  );
  expect(readFileSync(join(primaryOut, "import/regions.csv"), "utf8")).toContain(
    "ets2,split_region,Label split_region,,dlc.900001",
  );
});
