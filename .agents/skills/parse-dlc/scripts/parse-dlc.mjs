#!/usr/bin/env node
// Builds catalog import files for one ETS2/ATS DLC from the locally installed game.
// Everything it writes is game-derived and private: keep it under .local/ and never commit it.
// Usage: see ../SKILL.md. No dependencies; needs the sk-zk Extractor for .scs archives.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";

const GAMES = {
  ets2: { title: "Euro Truck Simulator 2", folder: "Euro Truck Simulator 2", steam: "227300" },
  ats: { title: "American Truck Simulator", folder: "American Truck Simulator", steam: "270880" },
};
const LOCALES = { en: "en_us", ru: "ru_ru" };
// Read in this order, later files win; ATS city names live in local.override.sii.
const LOCALE_FILES = ["localization.sui", "local.sii", "local.override.sii"];
// Import limits from apps/api/src/modules/catalogs/config.ts.
const LIMITS = { rows: 5000, bytes: 8 * 1024 * 1024, name: 256, code: 128 };
const LOGO = { bytes: 32 * 1024, width: 128, height: 32, files: 500, total: 16 * 1024 * 1024 };
const ADR = new Set(["1", "2", "3", "4", "6", "8"]);
const COLUMNS = {
  dlcs: ["game", "code", "name_en", "name_ru", "steam_app_id"],
  regions: ["game", "code", "name_en", "name_ru", "dlc_code"],
  cities: ["game", "code", "name_en", "name_ru", "region_code", "dlc_code", "name_native"],
  companies: ["game", "code", "name_en", "name_ru", "dlc_code"],
  depots: ["game", "company_code", "city_code", "dlc_code"],
  cargoes: ["game", "code", "name_en", "name_ru", "adr_class", "dlc_code"],
  trailers: ["game", "code", "name_en", "name_ru", "dlc_code"],
};

class UsageError extends Error {}
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    game: { type: "string" },
    dlc: { type: "string" },
    out: { type: "string" },
    known: { type: "string", multiple: true, default: [] },
    "game-dir": { type: "string" },
    extractor: { type: "string" },
    "name-en": { type: "string" },
    fresh: { type: "boolean", default: false },
    cache: { type: "string" },
  },
});

// ---------- environment ----------

function steamLibraries() {
  const roots = [
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Steam"),
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Steam"),
    join(homedir(), ".steam", "steam"),
    join(homedir(), ".local", "share", "Steam"),
    join(homedir(), "Library", "Application Support", "Steam"),
  ].filter(Boolean);
  const libraries = new Set();
  for (const root of roots) {
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    libraries.add(root);
    for (const m of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g))
      libraries.add(m[1].replaceAll("\\\\", "\\"));
  }
  return [...libraries];
}

function gameDir(game) {
  const given = opts["game-dir"] ?? process.env[`${game.toUpperCase()}_DIR`];
  const candidates = given
    ? [given]
    : steamLibraries().map((l) => join(l, "steamapps", "common", GAMES[game].folder));
  const found = candidates.find((d) => existsSync(join(d, "def.scs")));
  if (!found) throw new UsageError(`${game} install not found; pass --game-dir`);
  return found;
}

function extractorPath() {
  const path = opts.extractor ?? process.env.SCS_EXTRACTOR;
  if (!path || !existsSync(path))
    throw new UsageError("sk-zk Extractor not found; pass --extractor or set SCS_EXTRACTOR");
  return path;
}

function run(args) {
  const r = spawnSync(extractorPath(), args, { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.error || r.status !== 0)
    throw new Error(`extractor ${args[0]}: ${(r.stderr || r.stdout || String(r.error)).trim()}`);
  return r.stdout;
}
const archiveList = (archive) =>
  run([archive, "--list"])
    .split(/\r?\n/)
    .filter((l) => l.startsWith("/"));
// A marker per requested path set keeps the cache from serving a different extraction.
function extract(archive, dest, partial) {
  const paths = partial.join(",");
  const id = createHash("sha256").update(paths).digest("hex").slice(0, 12);
  const marker = join(dest, `.parse-dlc-${id}`);
  if (existsSync(marker) && !opts.fresh) return;
  mkdirSync(dest, { recursive: true });
  run([archive, "-d", dest, "-q", `-p=${paths}`]);
  writeFileSync(marker, `${basename(archive)} ${paths}\n`);
}

// ---------- SII ----------

function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") quoted = !quoted;
    else if (!quoted && (ch === "#" || (ch === "/" && line[i + 1] === "/")))
      return line.slice(0, i);
  }
  return line;
}
function siiValue(text) {
  // Unquoted values are tokens, which the game compares case-insensitively.
  if (!text.startsWith('"')) return text.split(/\s/)[0].toLowerCase();
  let out = "";
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) out += text[++i];
    else if (text[i] === '"') return out;
    else out += text[i];
  }
  return out;
}
// Simple `type : id { field: value }` units; arrays (`key[]:`) collect in order.
function parseUnits(file) {
  const units = [];
  let unit = null;
  let pending = null;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (!unit) {
      const head = /^([A-Za-z_]\w*)\s*:\s*([^\s{]+)\s*(\{)?$/.exec(line);
      if (head) {
        pending = { type: head[1], id: head[2].toLowerCase(), file, fields: {}, arrays: {} };
        if (head[3]) [unit, pending] = [pending, null];
      } else if (line === "{" && pending) [unit, pending] = [pending, null];
      continue;
    }
    if (line === "}") {
      units.push(unit);
      unit = null;
      continue;
    }
    const field = /^([A-Za-z_]\w*)(\[\d*\])?\s*:\s*(.*)$/.exec(line);
    if (!field) continue;
    const value = siiValue(field[3]);
    if (field[2]) {
      unit.arrays[field[1]] ??= [];
      unit.arrays[field[1]].push(value);
    } else unit.fields[field[1]] = value;
  }
  return units;
}
// An include path starting with "/" is relative to the archive root, otherwise to the file.
function includes(file, root, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  const out = [file];
  for (const m of readFileSync(file, "utf8").matchAll(/^\s*@include\s+"([^"]+)"/gm))
    out.push(...includes(join(m[1].startsWith("/") ? root : dirname(file), m[1]), root, seen));
  return out;
}
// Units registered by def/<name>.sii or def/<name>.<suffix>.sii, keyed by id.
function registered(defDir, name, type) {
  const units = new Map();
  if (!existsSync(defDir)) return units;
  const re = new RegExp(`^${name}(\\.[^.]+)?\\.sii$`);
  for (const reg of readdirSync(defDir).filter((f) => re.test(f)))
    for (const file of includes(join(defDir, reg), dirname(defDir)))
      for (const u of parseUnits(file)) if (u.type === type) units.set(u.id, u);
  return units;
}
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      )
    : [];
const SII = /\.s[iu]i$/;
const localeRank = (file) => LOCALE_FILES.indexOf(basename(file));
// key[]/val[] pairs; locale .sui files are bare fragments without a unit around them.
function localization(dirs) {
  const map = new Map();
  for (const dir of dirs)
    for (const file of walk(dir)
      .filter((f) => SII.test(f))
      .sort((a, b) => localeRank(a) - localeRank(b) || a.localeCompare(b))) {
      let key = null;
      for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*(key|val)\[\d*\]\s*:\s*(.*)$/.exec(stripComment(raw));
        if (!m) continue;
        if (m[1] === "key") key = siiValue(m[2].trim());
        else if (key !== null) {
          map.set(key, siiValue(m[2].trim()));
          key = null;
        }
      }
    }
  return map;
}
const token = (v) => /^@@(.+)@@$/.exec(v ?? "")?.[1] ?? null;

// ---------- DLC resolution ----------

function manifests(game, dir, raw) {
  const out = [];
  for (const f of readdirSync(dir)
    .filter((x) => /^dlc_.+\.scs$/.test(x))
    .sort()) {
    const archive = f.replace(/\.scs$/, "");
    const dest = join(raw, "manifests", archive);
    extract(join(dir, f), dest, [`/${archive}.manifest.sii`]);
    const file = join(dest, `${archive}.manifest.sii`);
    const unit = existsSync(file) ? parseUnits(file).find((u) => u.type === "dlc_package") : null;
    const m = unit?.fields ?? {};
    // Without a manifest id there is no reliable code; never guess one.
    if (!m.id || !validCode(m.id)) {
      console.error(`skipped ${archive}: no dlc_package unit with a valid id in its manifest`);
      continue;
    }
    // Packages bundled with the game carry no app id or the game's own; they are supplemental.<id>.
    const steam = ["", "0", GAMES[game].steam].includes(m.steam_app_id ?? "") ? "" : m.steam_app_id;
    out.push({
      archive,
      id: m.id,
      display: (m.display_name ?? "").replace(/^DLC\s*-\s*/, ""),
      steam,
      code: steam ? `dlc.${steam}` : `supplemental.${m.id}`,
      features: unit?.arrays.features ?? [],
      game,
    });
  }
  return out;
}
function resolveDlc(list, query) {
  const q = query.toLowerCase().trim();
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const exact = list.filter((d) =>
    [d.archive, d.archive.replace(/^dlc_/, ""), d.id, d.steam, d.code, d.display.toLowerCase()]
      .filter(Boolean)
      .includes(q),
  );
  if (exact.length === 1) return exact[0];
  const fuzzy = list.filter((d) => norm(d.display).includes(norm(q)));
  if (exact.length === 0 && fuzzy.length === 1) return fuzzy[0];
  const shown = (exact.length ? exact : fuzzy).map((d) => `${d.archive} (${d.display})`);
  throw new UsageError(
    shown.length
      ? `"${query}" is ambiguous: ${shown.join(", ")}`
      : `no installed DLC matches "${query}"`,
  );
}

// ---------- known rows ----------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) rows.push([...row, cell]);
  const [head = [], ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  const keys = head.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}
// Rows the host is known to have, read from earlier import files named <list>.csv or <list>.json.
const LIST_FILES = {
  dlc: "dlcs",
  cargo: "cargoes",
  ...Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, k])),
};
function knownRows(dirs, game) {
  const known = Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, new Set()]));
  for (const dir of dirs)
    for (const file of walk(resolve(dir))) {
      const m = /^([a-z]+)\.(csv|json)$/i.exec(basename(file));
      const list = m && LIST_FILES[m[1].toLowerCase()];
      if (!list) continue;
      const text = readFileSync(file, "utf8");
      const rows = m[2].toLowerCase() === "json" ? JSON.parse(text) : parseCsv(text);
      for (const r of rows.filter((x) => x.game === game))
        known[list].add(list === "depots" ? `${r.company_code}|${r.city_code}` : r.code);
    }
  return known;
}

// ---------- logos ----------

function readDds(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "DDS ") throw new Error("not a DDS file");
  const height = b.readUInt32LE(12);
  const width = b.readUInt32LE(16);
  const fourcc = b.toString("ascii", 84, 88);
  const dxgi = fourcc === "DX10" ? b.readUInt32LE(128) : null;
  const off = fourcc === "DX10" ? 148 : 128;
  const rgba = Buffer.alloc(width * height * 4);
  if (dxgi === 87 || dxgi === 91) {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = b[off + i * 4 + 2];
      rgba[i * 4 + 1] = b[off + i * 4 + 1];
      rgba[i * 4 + 2] = b[off + i * 4];
      rgba[i * 4 + 3] = b[off + i * 4 + 3];
    }
  } else if (dxgi === 77 || dxgi === 78 || fourcc === "DXT5") {
    let p = off;
    const rgb = (c) => [
      Math.trunc((((c >> 11) & 31) * 255) / 31),
      Math.trunc((((c >> 5) & 63) * 255) / 63),
      Math.trunc(((c & 31) * 255) / 31),
    ];
    for (let by = 0; by < height / 4; by++)
      for (let bx = 0; bx < width / 4; bx++) {
        const [a0, a1] = [b[p], b[p + 1]];
        const alphas = [a0, a1];
        if (a0 > a1)
          for (let i = 1; i <= 6; i++) alphas.push(Math.trunc(((7 - i) * a0 + i * a1) / 7));
        else {
          for (let i = 1; i <= 4; i++) alphas.push(Math.trunc(((5 - i) * a0 + i * a1) / 5));
          alphas.push(0, 255);
        }
        let abits = 0n;
        for (let i = 0; i < 6; i++) abits |= BigInt(b[p + 2 + i]) << BigInt(8 * i);
        const k0 = rgb(b.readUInt16LE(p + 8));
        const k1 = rgb(b.readUInt16LE(p + 10));
        const cbits = b.readUInt32LE(p + 12);
        const colors = [
          k0,
          k1,
          k0.map((v, i) => Math.trunc((2 * v + k1[i]) / 3)),
          k0.map((v, i) => Math.trunc((v + 2 * k1[i]) / 3)),
        ];
        for (let i = 0; i < 16; i++) {
          const o = ((by * 4 + (i >> 2)) * width + bx * 4 + (i & 3)) * 4;
          const c = colors[(cbits >>> (2 * i)) & 3];
          [rgba[o], rgba[o + 1], rgba[o + 2]] = c;
          rgba[o + 3] = alphas[Number((abits >> BigInt(3 * i)) & 7n)];
        }
        p += 16;
      }
  } else throw new Error(`unsupported DDS format ${fourcc}/${dxgi}`);
  return { width, height, rgba };
}
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let c = 0xffffffff;
  for (const x of body) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, body, crc]);
}
function png({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const lines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    rgba.copy(lines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(lines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- checks and output ----------

const printable = (s) => ![...s].some((ch) => ch <= "\u001f" || ch === "\u007f");
const validCode = (c) =>
  typeof c === "string" && /^\S+$/u.test(c) && Buffer.byteLength(c) <= LIMITS.code && printable(c);
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const csv = (list, rows) =>
  `${[COLUMNS[list].join(","), ...rows.map((r) => COLUMNS[list].map((c) => csvCell(String(r[c] ?? ""))).join(","))].join("\n")}\n`;

function checkRows(list, rows, fail) {
  const keys = new Set();
  for (const [i, r] of rows.entries()) {
    const at = `${list}.csv:${i + 2}`;
    const codes = list === "depots" ? [r.company_code, r.city_code] : [r.code];
    for (const c of codes) if (!validCode(c)) fail(`${at} invalid code "${c}"`);
    for (const ref of ["dlc_code", "region_code"])
      if (r[ref] && !validCode(r[ref])) fail(`${at} invalid ${ref}`);
    if (list !== "depots") {
      if (!r.name_en?.trim()) fail(`${at} ${r.code}: no English name`);
      for (const n of ["name_en", "name_ru", "name_native"])
        if (r[n] && ([...r[n]].length > LIMITS.name || !printable(r[n]))) fail(`${at} bad ${n}`);
    }
    if (list === "cargoes" && r.adr_class && !ADR.has(r.adr_class))
      fail(`${at} ADR ${r.adr_class}`);
    const key = codes.join("|");
    if (keys.has(key)) fail(`${at} duplicate ${key}`);
    keys.add(key);
  }
  if (rows.length > LIMITS.rows) fail(`${list}: ${rows.length} rows exceed ${LIMITS.rows}`);
}

// ---------- commands ----------

function listCommand() {
  const game = requireGame();
  const raw = cacheDir(game);
  for (const d of manifests(game, gameDir(game), raw))
    console.log([d.archive, d.code, d.display, d.features.join("+")].join("\t"));
}

// Extracted archives, reused across runs and DLCs; --fresh re-extracts after a game update.
const cacheDir = (game) =>
  resolve(opts.cache ?? join(".local", "catalogs", "parse-dlc-cache", game));

function requireGame() {
  if (!GAMES[opts.game]) throw new UsageError("--game must be ets2 or ats");
  return opts.game;
}

function buildCommand() {
  const game = requireGame();
  if (!opts.dlc || !opts.out) throw new UsageError("build needs --dlc and --out");
  const out = resolve(opts.out);
  const raw = cacheDir(game);
  const importDir = join(out, "import");
  const dir = gameDir(game);
  const failures = [];
  const warnings = [];
  const fail = (m) => failures.push(m);
  const warn = (m) => warnings.push(m);

  const dlc = resolveDlc(manifests(game, dir, raw), opts.dlc);
  const known = knownRows(opts.known, game);
  const haveKnown = opts.known.length > 0;
  const isKnown = (list, code) => haveKnown && known[list].has(code);
  // Some store DLCs ship with the game now and are listed as supplemental packages; keep a known code.
  const supplemental = `supplemental.${dlc.id}`;
  if (dlc.steam && !isKnown("dlcs", dlc.code) && isKnown("dlcs", supplemental)) {
    warn(`${dlc.code} is not known but ${supplemental} is; used ${supplemental}`);
    Object.assign(dlc, { code: supplemental, steam: "" });
  }
  const dlcArchive = join(dir, `${dlc.archive}.scs`);
  const dlcPaths = new Set(archiveList(dlcArchive).map((p) => p.split("/").slice(0, 2).join("/")));
  const dlcRoot = join(raw, dlc.archive);
  extract(
    dlcArchive,
    dlcRoot,
    ["/def", "/locale", "/material"]
      .filter((p) => dlcPaths.has(p))
      .map((p) => (p === "/material" ? "/material/ui/company/small" : p)),
  );
  const baseDef = join(raw, "def");
  extract(join(dir, "def.scs"), baseDef, ["/def"]);
  const localeRoot = join(raw, "locale");
  extract(
    join(dir, "locale.scs"),
    localeRoot,
    Object.values(LOCALES).flatMap((l) => LOCALE_FILES.map((n) => `/locale/${l}/${n}`)),
  );
  const loc = Object.fromEntries(
    Object.entries(LOCALES).map(([k, l]) => [
      k,
      localization([join(localeRoot, "locale", l), join(dlcRoot, "locale", l)]),
    ]),
  );
  if (!loc.en.size) fail("no English localization extracted");
  const name = (key, fallback = "") => ({
    en: (key && loc.en.get(key)) || fallback,
    ru: (key && loc.ru.get(key)) || "",
  });

  const layer = (root) => ({
    cities: registered(join(root, "def"), "city", "city_data"),
    companies: registered(join(root, "def"), "company", "company_permanent"),
    cargoes: registered(join(root, "def"), "cargo", "cargo_data"),
    countries: registered(join(root, "def"), "country", "country_data"),
  });
  const own = layer(dlcRoot);
  const base = layer(baseDef);
  const strip = (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : null);
  const byCode = (map, prefix) => new Map([...map].map(([id, u]) => [strip(id, prefix), u]));
  const units = {
    cities: [byCode(own.cities, "city."), byCode(base.cities, "city.")],
    companies: [
      byCode(own.companies, "company.permanent."),
      byCode(base.companies, "company.permanent."),
    ],
    cargoes: [byCode(own.cargoes, "cargo."), byCode(base.cargoes, "cargo.")],
    countries: [byCode(own.countries, "country.data."), byCode(base.countries, "country.data.")],
  };
  // A referenced row comes from the DLC itself, else from the base game; otherwise it must already be on the host.
  const lookup = (list, code) => {
    const [mine, theirs] = units[list];
    if (mine.has(code)) return { unit: mine.get(code), dlc_code: dlc.code };
    if (theirs.has(code)) return { unit: theirs.get(code), dlc_code: "" };
    return null;
  };

  const rows = Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, new Map()]));
  const bodyTypes = new Set();
  const nameEn =
    opts["name-en"] ??
    (dlc.steam
      ? `${GAMES[game].title} - ${dlc.display}`
      : `Official installed supplemental package ${dlc.id}`);
  rows.dlcs.set(dlc.code, {
    game,
    code: dlc.code,
    name_en: nameEn,
    name_ru: "",
    steam_app_id: dlc.steam,
  });

  const addRegion = (code, why) => {
    if (rows.regions.has(code) || isKnown("regions", code)) return;
    const hit = lookup("countries", code);
    if (!hit)
      return fail(`region ${code} (${why}) is neither in the DLC, the base game nor --known`);
    const f = hit.unit.fields;
    const n = name(token(f.name_localized) ?? code, f.name);
    rows.regions.set(code, { game, code, name_en: n.en, name_ru: n.ru, dlc_code: hit.dlc_code });
  };
  const unnamed = { en: [], ru: [] };
  const addCity = (code, hit) => {
    const f = hit.unit.fields;
    const n = name(token(f.city_name_localized), f.city_name);
    if (!loc.en.get(token(f.city_name_localized))) unnamed.en.push(code);
    if (!n.ru) unnamed.ru.push(code);
    if (f.country) addRegion(f.country, `city ${code}`);
    rows.cities.set(code, {
      game,
      code,
      name_en: n.en,
      name_ru: n.ru,
      region_code: f.country ?? "",
      dlc_code: hit.dlc_code,
      name_native: f.city_name ?? "",
    });
  };
  const addCompany = (code, hit) => {
    const label = hit.unit.fields.name;
    rows.companies.set(code, { game, code, name_en: label, name_ru: "", dlc_code: hit.dlc_code });
  };
  const addCargo = (code, hit) => {
    const f = hit.unit.fields;
    const n = name(token(f.name), f.name?.startsWith("@@") ? "" : f.name);
    const adr = f.adr_class && f.adr_class !== "0" ? f.adr_class : "";
    rows.cargoes.set(code, {
      game,
      code,
      name_en: n.en,
      name_ru: n.ru,
      adr_class: adr,
      dlc_code: hit.dlc_code,
    });
    for (const bt of hit.unit.arrays.body_types ?? []) bodyTypes.add(bt);
  };
  const ensure = (list, code, why, add) => {
    if (rows[list].has(code) || isKnown(list, code)) return;
    const hit = lookup(list, code);
    if (hit) add(code, hit);
    else
      fail(
        `${list} ${code} (${why}) is not in this DLC or the base game; import its DLC first or pass --known`,
      );
  };

  for (const code of units.cities[0].keys()) addCity(code, lookup("cities", code));
  for (const code of units.companies[0].keys()) addCompany(code, lookup("companies", code));
  for (const code of units.cargoes[0].keys()) addCargo(code, lookup("cargoes", code));

  // Depots: def/company/<company>/editor/<city>[.<suffix>].sii, one company_def each.
  const companyDir = join(dlcRoot, "def", "company");
  const cargoRefs = new Set();
  for (const company of existsSync(companyDir) ? readdirSync(companyDir).sort() : []) {
    for (const file of walk(join(companyDir, company, "editor")).sort()) {
      const defs = parseUnits(file).filter((u) => u.type === "company_def");
      if (defs.length !== 1) {
        fail(`${company}/${basename(file)}: ${defs.length} company_def units`);
        continue;
      }
      const city = defs[0].fields.city;
      ensure("companies", company, `depot in ${city}`, addCompany);
      ensure("cities", city, `depot of ${company}`, addCity);
      rows.depots.set(`${company}|${city}`, {
        game,
        company_code: company,
        city_code: city,
        dlc_code: dlc.code,
      });
    }
    for (const side of ["in", "out"])
      for (const file of walk(join(companyDir, company, side))) {
        const ref = parseUnits(file)
          .map((u) => u.fields.cargo)
          .find(Boolean);
        const code = ref && strip(ref.toLowerCase(), "cargo.");
        if (code) cargoRefs.add(code);
      }
  }
  // Depot cargo is not a parent of any row, so an undefined one is only reported.
  for (const code of [...cargoRefs].sort()) {
    if (rows.cargoes.has(code) || isKnown("cargoes", code)) continue;
    const hit = lookup("cargoes", code);
    if (hit) addCargo(code, hit);
    else warn(`depot cargo ${code} is not defined in this DLC or the base game; skipped`);
  }

  // Trailers are keyed by body type; the game localizes body types under the same key.
  for (const file of walk(join(dlcRoot, "def", "vehicle")).filter((f) => SII.test(f)))
    for (const u of parseUnits(file)) if (u.fields.body_type) bodyTypes.add(u.fields.body_type);
  for (const bt of [...bodyTypes].sort()) {
    if (isKnown("trailers", bt)) continue;
    const n = name(bt);
    if (!loc.en.get(bt)) {
      warn(`trailer body type ${bt}: no localized name; add its row by hand`);
      continue;
    }
    rows.trailers.set(bt, { game, code: bt, name_en: n.en, name_ru: n.ru, dlc_code: "" });
  }

  // Logos for emitted companies: the DLC first, then base.scs, then other archives.
  const wanted = new Set(rows.companies.keys());
  const logos = { written: [], missing: [] };
  const small = new Map();
  const collect = (root) => {
    for (const f of walk(join(root, "material", "ui", "company", "small")))
      if (!small.has(basename(f))) small.set(basename(f), f);
  };
  collect(dlcRoot);
  const need = () => [...wanted].filter((c) => !small.has(`${c}.mat`));
  const logoArchives = [
    "base.scs",
    ...readdirSync(dir)
      .filter((f) => /^dlc_.+\.scs$/.test(f) && f !== `${dlc.archive}.scs`)
      .sort(),
  ];
  for (const a of logoArchives) {
    if (!need().length) break;
    const listing = archiveList(join(dir, a));
    if (!need().some((c) => listing.includes(`/material/ui/company/small/${c}.mat`))) continue;
    const dest = join(raw, "logos", a.replace(/\.scs$/, ""));
    extract(join(dir, a), dest, ["/material/ui/company/small"]);
    collect(dest);
  }
  const logoDir = join(importDir, "logos");
  mkdirSync(logoDir, { recursive: true });
  let logoBytes = 0;
  for (const code of [...wanted].sort()) {
    const mat = small.get(`${code}.mat`);
    if (!mat) {
      logos.missing.push(code);
      continue;
    }
    const text = readFileSync(mat, "utf8");
    const src = (/source\s*:\s*"([^"]+)"/.exec(text) ??
      /texture\s*:\s*"([^"]+\.tobj)"/.exec(text))?.[1];
    const dds = src && small.get(`${basename(src).replace(/\.tobj$/, "")}.dds`);
    if (!dds) {
      logos.missing.push(code);
      continue;
    }
    try {
      const image = readDds(dds);
      const bytes = png(image);
      if (image.width > LOGO.width || image.height > LOGO.height || bytes.length > LOGO.bytes)
        fail(
          `logo ${code}: ${image.width}x${image.height}, ${bytes.length} bytes is over the limit`,
        );
      writeFileSync(join(logoDir, `${code}.png`), bytes);
      logoBytes += bytes.length;
      logos.written.push(code);
    } catch (e) {
      fail(`logo ${code}: ${e.message}`);
    }
  }
  if (logos.missing.length) warn(`no logo found for ${logos.missing.join(", ")}`);
  if (unnamed.en.length) warn(`cities named by the map name only: ${unnamed.en.join(", ")}`);
  if (unnamed.ru.length) warn(`cities without a Russian name: ${unnamed.ru.join(", ")}`);
  if (logos.written.length > LOGO.files || logoBytes > LOGO.total)
    fail("logos exceed one bulk upload");

  // Write and check.
  mkdirSync(importDir, { recursive: true });
  const files = [];
  for (const [list, map] of Object.entries(rows)) {
    const values = [...map.values()];
    checkRows(list, values, fail);
    if (!values.length) continue;
    const text = csv(list, values);
    if (Buffer.byteLength(text) > LIMITS.bytes) fail(`${list}.csv exceeds ${LIMITS.bytes} bytes`);
    writeFileSync(join(importDir, `${list}.csv`), text, "utf8");
    files.push(`${list}.csv`);
  }
  const report = {
    game,
    dlc: { ...dlc, name_en: nameEn, nameFromManifest: !opts["name-en"] },
    gameDir: dir,
    knownChecked: haveKnown,
    rows: Object.fromEntries(Object.entries(rows).map(([k, m]) => [k, m.size])),
    // Emitted rows that --known already lists: the import refreshes them instead of adding them.
    alreadyKnown: Object.fromEntries(
      Object.entries(rows).map(([k, m]) => [k, [...m.keys()].filter((c) => isKnown(k, c)).length]),
    ),
    fromBaseGame: Object.fromEntries(
      ["regions", "cities", "companies", "cargoes"].map((k) => [
        k,
        [...rows[k].values()].filter((r) => !r.dlc_code).map((r) => r.code),
      ]),
    ),
    logos: { written: logos.written.length, missing: logos.missing },
    files,
    warnings,
    failures,
  };
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify(report, null, 1));
  if (failures.length) process.exitCode = 1;
}

// One run per cache: parallel runs extracting into the same folder lose files.
function withCacheLock(fn) {
  const dir = cacheDir(requireGame());
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".lock");
  try {
    writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
  } catch {
    throw new UsageError(`${lock} exists: another run uses this cache; delete it if none does`);
  }
  try {
    fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

try {
  if (positionals[0] === "list") withCacheLock(listCommand);
  else if (positionals[0] === "build") withCacheLock(buildCommand);
  else throw new UsageError("usage: parse-dlc.mjs list|build --game ets2|ats [options]");
} catch (e) {
  console.error(e instanceof UsageError ? e.message : (e.stack ?? String(e)));
  process.exitCode = 2;
}
