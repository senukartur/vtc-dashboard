// Explicit registration evidence, shared by build and the private correction audit.
// Country definition placement and known host rows never establish map availability.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseUnits, stripComment } from "./sii.mjs";

const gameApp = { ets2: "227300", ats: "270880" };
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (items) => [...new Set(items)].sort(compare);
const validCode = (code) =>
  typeof code === "string" &&
  /^\S+$/u.test(code) &&
  Buffer.byteLength(code) <= 128 &&
  ![...code].some((char) => char <= "\u001f" || char === "\u007f");
const registrationName = /^city(\.[^.]+)?\.sii$/;

function containedFile(root, path) {
  const file = resolve(root, path);
  const rel = relative(root, file);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("Evidence path escapes its extracted root");
  if (!existsSync(file)) return null;
  const actual = realpathSync(file);
  const actualRel = relative(root, actual);
  if (
    isAbsolute(actualRel) ||
    actualRel === ".." ||
    actualRel.startsWith("..\\") ||
    actualRel.startsWith("../")
  )
    throw new Error("Evidence symlink escapes its extracted root");
  if (!statSync(actual).isFile()) throw new Error("Evidence path is not a file");
  return actual;
}

function uniqueFile(roots, path, gaps, conflicts, context) {
  const matches = roots.map((root) => containedFile(root, path)).filter(Boolean);
  if (!matches.length) {
    gaps.push(`${context}: missing file ${path}`);
    return null;
  }
  const texts = new Set(matches.map((file) => readFileSync(file, "utf8")));
  if (texts.size > 1) {
    conflicts.push(`${context}: conflicting file ${path}`);
    return null;
  }
  return matches.sort(compare)[0];
}

export function readRegionEvidence(file, game) {
  const input = JSON.parse(readFileSync(file, "utf8"));
  if (
    !gameApp[game] ||
    input.schemaVersion !== 1 ||
    input.game !== game ||
    !Array.isArray(input.packs) ||
    !input.coverage ||
    typeof input.coverage.complete !== "boolean" ||
    !Array.isArray(input.coverage.expectedPacks)
  )
    throw new Error("Invalid region evidence schema/game");
  const gaps = [];
  const conflicts = [];
  const cities = [];
  const packs = [];
  const expected = input.coverage.expectedPacks;
  if (expected.some((id) => !validCode(id)) || new Set(expected).size !== expected.length)
    throw new Error("Invalid or duplicate expected pack identity");
  if (!input.coverage.complete) gaps.push("survey declared incomplete");
  if (!expected.includes("base")) gaps.push("base pack is not in the survey");
  const ids = new Set();
  for (const pack of input.packs) {
    if (
      !validCode(pack.id) ||
      ids.has(pack.id) ||
      !Array.isArray(pack.registrations) ||
      pack.registrations.some(
        (path) => typeof path !== "string" || !/^def\/city(?:\.[^/.]+)?\.sii$/.test(path),
      ) ||
      new Set(pack.registrations).size !== pack.registrations.length
    )
      throw new Error("Invalid/duplicate pack identity or explicit registration paths");
    ids.add(pack.id);
    const roots = pack.roots ?? [pack.root];
    if (!Array.isArray(roots) || !roots.length || roots.some((root) => typeof root !== "string"))
      throw new Error("Each pack needs extracted root or roots");
    const resolvedRoots = roots.map((root) => {
      const path = resolve(dirname(file), root);
      if (!existsSync(path) || !statSync(path).isDirectory())
        throw new Error("Extracted evidence root is unavailable");
      return realpathSync(path);
    });
    const item = {
      id: pack.id,
      roots: sorted(resolvedRoots),
      registrations: sorted(pack.registrations),
      dlcCode: null,
      verified: false,
    };
    if (!expected.includes(pack.id)) gaps.push(`${pack.id}: not in expected pack inventory`);
    if (pack.id === "base") {
      if (pack.dlcCode || pack.manifest) throw new Error("Base pack cannot carry a DLC identity");
      item.dlcCode = "";
      item.verified = true;
    } else if (typeof pack.manifest !== "string" || !validCode(pack.dlcCode)) {
      gaps.push(`${pack.id}: missing verified manifest identity`);
    } else {
      const manifest = uniqueFile(item.roots, pack.manifest, gaps, conflicts, pack.id);
      const units = manifest
        ? parseUnits(manifest).filter((unit) => unit.type === "dlc_package")
        : [];
      const fields = units[0]?.fields;
      if (
        units.some((unit) =>
          unit.duplicateFields.some((field) => ["id", "steam_app_id"].includes(field)),
        )
      )
        conflicts.push(`${pack.id}: conflicting manifest identity fields`);
      if (
        units.length !== 1 ||
        !validCode(fields?.id) ||
        (fields.steam_app_id && !/^\d+$/.test(fields.steam_app_id))
      ) {
        gaps.push(`${pack.id}: invalid manifest identity`);
      } else {
        const steam = ["", "0", gameApp[game]].includes(fields.steam_app_id ?? "")
          ? ""
          : fields.steam_app_id;
        const codes = [`supplemental.${fields.id}`, ...(steam ? [`dlc.${steam}`] : [])];
        if (!codes.includes(pack.dlcCode))
          conflicts.push(`${pack.id}: supplied code conflicts with manifest identity`);
        else {
          item.dlcCode = pack.dlcCode;
          item.manifestId = fields.id;
          item.verified = true;
        }
      }
    }
    // A surveyed root must include its entire active top-level registration inventory.
    const discovered = sorted(
      item.roots.flatMap((root) =>
        existsSync(join(root, "def"))
          ? readdirSync(join(root, "def"))
              .filter((name) => registrationName.test(name))
              .map((name) => `def/${name}`)
          : [],
      ),
    );
    if (JSON.stringify(discovered) !== JSON.stringify(item.registrations))
      gaps.push(`${pack.id}: explicit registrations do not match extracted inventory`);
    if (pack.id === "base" && !discovered.length)
      gaps.push("base: no active city registration inventory");
    packs.push(item);
  }
  for (const id of expected)
    if (!ids.has(id)) gaps.push(`${id}: expected pack has not been surveyed`);
  for (const pack of packs) {
    if (!pack.verified || pack.id === "base") continue;
    if (
      packs.some(
        (other) =>
          other !== pack &&
          other.verified &&
          (other.dlcCode === pack.dlcCode || other.manifestId === pack.manifestId),
      )
    )
      conflicts.push(`${pack.id}: duplicate pack manifest/code identity`);
  }
  const allRoots = sorted(packs.flatMap((pack) => pack.roots));
  for (const pack of packs.sort((a, b) => compare(a.id, b.id))) {
    const seen = new Set();
    const visit = (path, from) => {
      // Shared definitions may be included from another archive, but differing copies
      // have no implicit load order here and cannot establish ownership.
      const local = uniqueFile(pack.roots, path, [], conflicts, pack.id);
      const found = local ?? uniqueFile(allRoots, path, gaps, conflicts, pack.id);
      if (!found) return;
      if (from?.has(found)) {
        gaps.push(`${pack.id}: cyclic include ${path}`);
        return;
      }
      if (seen.has(found)) return;
      const chain = new Set(from ?? []);
      chain.add(found);
      seen.add(found);
      for (const raw of readFileSync(found, "utf8").split(/\r?\n/)) {
        const line = stripComment(raw).trim();
        if (!line.startsWith("@include")) continue;
        const include = /^@include\s+"([^"]+)"\s*$/.exec(line);
        if (!include) {
          gaps.push(`${pack.id}: unsupported include syntax`);
          continue;
        }
        const next = include[1].startsWith("/")
          ? include[1].slice(1)
          : join(dirname(path), include[1]);
        visit(next, chain);
      }
      const units = parseUnits(found).filter((unit) => unit.type === "city_data");
      const declared = readFileSync(found, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^\s*city_data\s*:/.test(stripComment(line))).length;
      if (declared !== units.length) gaps.push(`${pack.id}: unsupported city definition`);
      if (units.some((unit) => unit.duplicateFields.includes("country")))
        conflicts.push(`${pack.id}: conflicting city country fields`);
      for (const unit of units) {
        const code = unit.id.startsWith("city.") ? unit.id.slice(5) : null;
        const country = unit.fields.country;
        if (!validCode(code) || !validCode(country)) {
          gaps.push(`${pack.id}: invalid city registration/country`);
          continue;
        }
        cities.push({
          code,
          country,
          pack: pack.id,
          dlcCode: pack.dlcCode,
          verified: pack.verified,
        });
      }
    };
    for (const path of pack.registrations) visit(path);
  }
  if (!cities.some((city) => city.pack === "base" && city.verified))
    gaps.push("base: no validated active city registrations");
  const countryConflicts = new Set();
  for (const code of sorted(cities.map((city) => city.code))) {
    const regions = sorted(cities.filter((city) => city.code === code).map((city) => city.country));
    if (regions.length > 1) for (const region of regions) countryConflicts.add(region);
  }
  const evidence = {
    game,
    complete: input.coverage.complete && !gaps.length && !conflicts.length,
    gaps: sorted(gaps),
    conflicts: sorted(conflicts),
    countryConflicts,
    cities,
    primarySources: new Map(),
  };
  if (input.primarySources != null && !Array.isArray(input.primarySources))
    throw new Error("primarySources must be an explicit reviewed mapping array");
  for (const mapping of input.primarySources ?? []) {
    if (
      !validCode(mapping.code) ||
      !validCode(mapping.dlcCode) ||
      typeof mapping.reason !== "string" ||
      !mapping.reason.trim() ||
      evidence.primarySources.has(mapping.code)
    )
      throw new Error("Invalid/duplicate reviewed primary region mapping");
    const source = resolveRegionSource(evidence, mapping.code);
    if (
      !evidence.complete ||
      source.basePresent ||
      countryConflicts.has(mapping.code) ||
      source.contributors.length < 2 ||
      !source.contributors.includes(mapping.dlcCode)
    )
      throw new Error(
        "Primary region mapping needs complete conflict-free multi-DLC evidence, no base presence and an observed contributor",
      );
    evidence.primarySources.set(mapping.code, { dlcCode: mapping.dlcCode, reason: mapping.reason });
  }
  return evidence;
}

export function resolveRegionSource(evidence, code) {
  const registrations = evidence.cities.filter((city) => city.country === code);
  const verified = registrations.filter((city) => city.verified);
  const basePresent = verified.some((city) => city.dlcCode === "");
  const contributors = sorted(verified.map((city) => city.dlcCode).filter(Boolean));
  const reasons = [];
  const primary = evidence.primarySources.get(code);
  let status;
  if (evidence.countryConflicts.has(code) || evidence.conflicts.length) {
    status = "ambiguous";
    reasons.push(
      evidence.countryConflicts.has(code)
        ? "conflicting city country assignments"
        : "conflicting evidence/pack identities",
    );
  } else if (basePresent) status = "base-present";
  else if (primary && evidence.complete) {
    status = "primary-dlc";
    reasons.push("explicit reviewed primary mapping");
  } else if (contributors.length > 1) {
    status = "ambiguous";
    reasons.push("multiple DLC contributors without verified base presence");
  } else if (
    !evidence.complete ||
    !registrations.length ||
    registrations.some((city) => !city.verified)
  ) {
    status = "unresolved";
    if (!evidence.complete) reasons.push("incomplete verified survey");
    if (!registrations.length) reasons.push("no active city registrations");
    if (registrations.some((city) => !city.verified)) reasons.push("unverified pack identity");
  } else if (contributors.length === 1) status = "unique-dlc";
  else {
    status = "unresolved";
    reasons.push("no verified contributor");
  }
  return {
    code,
    status,
    basePresent,
    contributors,
    complete: evidence.complete,
    reasons,
    primaryReason: primary?.reason ?? null,
    dlcCode:
      status === "primary-dlc"
        ? primary.dlcCode
        : status === "unique-dlc"
          ? contributors[0]
          : status === "base-present"
            ? ""
            : null,
  };
}

export function prepareRegionCorrections(evidence, hosted) {
  if (
    hosted.game !== evidence.game ||
    !Array.isArray(hosted.regions) ||
    !Array.isArray(hosted.dlcs)
  )
    throw new Error("Invalid inspected hosted inventory/game");
  const uniqueCodes = (rows) =>
    rows.every((row) => validCode(row.code)) &&
    new Set(rows.map((row) => row.code)).size === rows.length;
  if (!uniqueCodes(hosted.regions) || !uniqueCodes(hosted.dlcs))
    throw new Error("Invalid/duplicate hosted codes");
  if (
    hosted.regions.some(
      (row) =>
        typeof row.name_en !== "string" ||
        !row.name_en.trim() ||
        (row.name_ru != null && typeof row.name_ru !== "string") ||
        (row.dlc_code != null && row.dlc_code !== "" && !validCode(row.dlc_code)) ||
        (row.game != null && row.game !== hosted.game),
    ) ||
    hosted.dlcs.some(
      (row) => typeof row.hidden !== "boolean" || (row.game != null && row.game !== hosted.game),
    )
  )
    throw new Error(
      "Hosted inventory requires exact names, same-game rows and explicit DLC visibility",
    );
  const rows = [],
    excluded = [],
    regionSources = [];
  for (const row of [...hosted.regions].sort((a, b) => compare(a.code, b.code))) {
    const source = resolveRegionSource(evidence, row.code);
    regionSources.push(source);
    let reason;
    if (source.status === "base-present")
      reason = row.dlc_code
        ? "source clearing requires the form; CSV blank preserves it"
        : "already base game";
    else if (!["unique-dlc", "primary-dlc"].includes(source.status)) reason = source.status;
    else {
      const parent = hosted.dlcs.find((pack) => pack.code === source.dlcCode);
      if (!parent) reason = "verified source is absent from inspected same-game DLCs";
      else if (parent.hidden) reason = "verified source is hidden";
      else if (row.dlc_code === source.dlcCode) reason = "already correct";
    }
    if (reason) excluded.push({ code: row.code, reason });
    else
      rows.push({
        game: evidence.game,
        code: row.code,
        name_en: row.name_en,
        name_ru: row.name_ru ?? "",
        dlc_code: source.dlcCode,
      });
  }
  return { rows, excluded, regionSources };
}
