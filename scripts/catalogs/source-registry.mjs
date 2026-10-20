import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { RegistryError } from "./registry.mjs";

const fail = (code) => {
  throw new RegistryError(code);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const order = (a, b) =>
  JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const token = /^[A-Za-z_.][A-Za-z0-9_.-]*$/;
const spec = (fields) =>
  Object.fromEntries(
    fields
      .split(/\s+/)
      .filter(Boolean)
      .map((field) => field.split("=")),
  );
// Closed, measured catalog attributes. Values remain exact strings/ordered arrays;
// positions are source tuples and are never interpreted as latitude/longitude.
const catalog = {
  cargo_data: spec(
    "name=string mass=decimal unit_mass=decimal adr_class=integer group[]=token volume=decimal unit_reward_per_km=decimal unit_load_time=decimal body_types[]=token fragility=decimal prob_coef=decimal valuable=boolean maximum_distance=decimal overweight=boolean minimum_distance=decimal oversize=boolean",
  ),
  trailer_def: spec(
    "trailer=reference gross_trailer_weight_limit=decimal chassis_mass=decimal body_mass=decimal axles=integer volume=decimal body_type=token mass_ratio[]=decimal length=decimal chain_type=token country_validity[]=token",
  ),
  city_data: spec(
    "city_name=string city_name_localized=string country=token population=integer map_x_offsets[]=decimal map_y_offsets[]=decimal vehicle_brands[]=string license_plate[]=token truck_lp_template[]=string truck_lp_def0[]=string truck_lp_def1[]=string truck_lp_def2[]=string truck_lp_def3[]=string truck_lp_def4[]=string ai_lp_template[]=string ai_lp_def0[]=string ai_lp_def1[]=string ai_lp_def2[]=string ai_lp_def3[]=string ai_lp_def4[]=string short_city_name=string short_city_name_localized=string key_city=boolean time_zone=decimal time_zone_name=string city_group=token",
  ),
  country_data: spec(
    "country_id=integer name=string name_localized=string country_code=string iso_country_code=reference pos=tuple3 fuel_price=decimal lights_mandatory=boolean driving_tired_offence=boolean time_zone=decimal time_zone_name=string mass_limit_per_axle_count[]=decimal regions[]=token region_areas[]=tuple4 imperial_units=boolean included_in_discovery_percentage=boolean secondary_time_zone_area[]=tuple4 secondary_time_zone[]=decimal secondary_time_zone_name[]=string trailer_standalone=boolean leftside_traffic=boolean petrol_price=decimal",
  ),
};
// These dependency units are retained for explicit review/non-contribution. No
// economic, traffic, plate or UI behavior is inferred from their attributes.
const support = Object.fromEntries(
  Object.entries({
    license_plate_data:
      "type templates[] def0[] def1[] def2[] def3[] def4[] def5[] background_front background_rear blacklist[] probability",
    company_permanent: "name sort_name trailer_look",
    country_speed_limit:
      "vehicle_speed_class lane_speed_class[] limit[] urban_limit[] max_limit[] uncommon[]",
    country_traffic_info: "object spawn_frequency spawn_ratio",
    country_traffic_density: "regions[] spawn_frequency_modifier",
    cargo_name_mapping: "old_names[] new_names[]",
    ui_cargo_filter_data: "button_all_img_name",
    car_cargo_data:
      "name fragility icon customer_cargo_notes_negative[] customer_cargo_notes_neutral[] customer_cargo_notes_positive[] accessory_data_path valuable",
    trailer_chain_type: "name icon price",
  }).map(([type, fields]) => [type, new Set(fields.split(" "))]),
);

function lex(source, origin) {
  const out = [];
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const comment = /^(?:\s+|\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (comment) {
      at += comment[0].length;
      continue;
    }
    const match =
      /^("(?:[^"\\\r\n]|\\["\\nrtbf/])*"|@include|&[a-fA-F0-9]{8}|-?(?:0|[1-9]\d*)(?:\.\d+)?|[A-Za-z_.][A-Za-z0-9_.-]*|[{}:[\](),])/.exec(
        rest,
      );
    if (!match) fail("unsupported_syntax");
    out.push({ raw: match[0], origin });
    at += match[0].length;
    if (out.length > 1000000) fail("token_limit");
  }
  return out;
}
function virtual(name, parent) {
  if (
    typeof name !== "string" ||
    !name.length ||
    name.includes("\\") ||
    name.includes(":") ||
    [...name].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    Buffer.from(name).toString("utf8") !== name
  )
    fail("path_escape");
  if (!parent && (name.startsWith("/") || name.split("/").includes(".."))) fail("path_escape");
  const parts =
    parent && !name.startsWith("/") ? posix.dirname(parent).split("/").filter(Boolean) : [];
  for (const part of name.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) fail("path_escape");
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length || parts.length > 128) fail("path_escape");
  return parts.join("/");
}
const within = (root, file) => {
  const r = relative(root, file);
  return r !== ".." && !r.startsWith("../") && !r.startsWith("..\\") && !isAbsolute(r);
};
function value(stream, cursor) {
  const next = () => stream[cursor.at++]?.raw;
  const scalar = () => {
    const raw = next();
    if (raw?.startsWith('"')) {
      try {
        return { text: JSON.parse(raw), kind: "string" };
      } catch {
        fail("unsupported_value");
      }
    }
    if (decimal.test(raw ?? "")) return { text: raw, kind: "decimal" };
    if (["true", "false"].includes(raw)) return { text: raw, kind: "boolean" };
    if (token.test(raw ?? "")) return { text: raw, kind: "token" };
    if (/^&[a-fA-F0-9]{8}$/.test(raw ?? "")) return { text: raw, kind: "encoded_float" };
    fail("unsupported_value");
  };
  if (stream[cursor.at]?.raw !== "(") return scalar();
  next();
  const components = [scalar()];
  while (stream[cursor.at]?.raw === ",") {
    next();
    components.push(scalar());
    if (components.length > 4) fail("unsupported_value");
  }
  if (
    next() !== ")" ||
    components.length < 2 ||
    components.some((c) => !["decimal", "encoded_float"].includes(c.kind))
  )
    fail("unsupported_value");
  return {
    text: `(${components.map((c) => c.text).join(",")})`,
    kind: `tuple${components.length}`,
  };
}
function checkValue(actual, expected) {
  if (expected === "integer")
    return actual.kind === "decimal" && /^-?(?:0|[1-9]\d*)$/.test(actual.text);
  if (expected === "reference") return actual.kind === "token" || actual.kind === "string";
  return actual.kind === expected;
}

export async function parseUniqueProviders(layers, options) {
  if (!Array.isArray(layers) || !layers.length || layers.length > 512) fail("invalid_layers");
  for (const layer of layers) {
    if (
      !layer ||
      typeof layer !== "object" ||
      Array.isArray(layer) ||
      Object.keys(layer).some(
        (k) => !["root", "packId", "registries", "sourceId", "overlay", "files"].includes(k),
      ) ||
      typeof layer.root !== "string" ||
      !layer.root.length ||
      typeof layer.packId !== "string" ||
      !/^[a-z][a-z0-9_.-]{0,127}$/.test(layer.packId) ||
      !Array.isArray(layer.registries) ||
      layer.registries.length > 10000 ||
      layer.registries.some((r) => typeof r !== "string" || !r.length) ||
      (Object.hasOwn(layer, "sourceId") &&
        (typeof layer.sourceId !== "string" || !/^[a-f0-9]{64}$/.test(layer.sourceId))) ||
      (Object.hasOwn(layer, "overlay") && layer.overlay !== false)
    )
      fail("invalid_layer");
    for (const registry of layer.registries) virtual(registry);
    if (layer.files !== undefined) {
      if (!Array.isArray(layer.files) || layer.files.length > 10000) fail("invalid_layer");
      const names = new Set();
      for (const file of layer.files) {
        if (
          !file ||
          typeof file !== "object" ||
          Array.isArray(file) ||
          Object.keys(file).some((k) => !["file", "sha256"].includes(k)) ||
          typeof file.file !== "string" ||
          typeof file.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(file.sha256)
        )
          fail("invalid_layer");
        const name = virtual(file.file);
        if (name !== file.file || names.has(name)) fail("invalid_layer");
        names.add(name);
      }
    }
  }
  if (!layers.some((layer) => layer.registries.length)) fail("invalid_layers");
  const roots = [];
  for (const layer of layers) {
    const root = resolve(layer.root);
    if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
      fail("symlink_root");
    roots.push({ ...layer, root });
  }
  const maximumBytes = options.maxBytes ?? 32 * 1024 * 1024,
    maximumFiles = options.maxFiles ?? 10000;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    !Number.isSafeInteger(maximumFiles) ||
    maximumFiles < 1
  )
    fail("invalid_limits");
  let bytesRead = 0,
    filesRead = 0;
  let expandedTokens = 0;
  const manifest = [],
    trace = [],
    units = new Map(),
    contexts = [],
    registered = new Set(),
    cache = new Map();
  async function providers(name) {
    if (cache.has(name)) return cache.get(name);
    const found = [];
    for (const layer of roots) {
      const declared = layer.files?.find((entry) => entry.file === name);
      if (layer.files && !declared) continue;
      const file = resolve(layer.root, name);
      if (!within(layer.root, file)) fail("path_escape");
      let stat;
      try {
        let current = layer.root;
        for (const part of name.split("/")) {
          current = resolve(current, part);
          if ((await lstat(current)).isSymbolicLink()) fail("symlink_path");
        }
        stat = await lstat(file);
      } catch (error) {
        if (error instanceof RegistryError) throw error;
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
        fail("missing_include");
      }
      if (!stat.isFile() || !within(layer.root, await realpath(file))) fail("path_escape");
      if (++filesRead > maximumFiles) fail("file_limit");
      if (stat.size > maximumBytes - bytesRead) fail("byte_limit");
      const bytes = await readFile(file);
      bytesRead += bytes.length;
      if (bytesRead > maximumBytes) fail("byte_limit");
      const after = await lstat(file);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail("source_changed");
      const source = bytes.toString("utf8");
      if (!Buffer.from(source).equals(bytes)) fail("invalid_utf8");
      const origin = {
        packId: layer.packId,
        ...(layer.sourceId ? { sourceId: layer.sourceId } : {}),
        file: name,
        sha256: digest(bytes),
      };
      if (declared && declared.sha256 !== origin.sha256) fail("source_changed");
      found.push({ source, origin });
    }
    if (!found.length) fail("missing_include");
    if (found.some((f) => f.origin.sha256 !== found[0].origin.sha256))
      fail("conflicting_providers");
    // Sorting identical carriers is deterministic provenance representation only;
    // differing source bytes never acquire an implied mount/overlay winner.
    found.sort((a, b) => order(a.origin, b.origin));
    cache.set(name, found);
    return found;
  }
  async function expand(name, context, visited, stack = []) {
    if (stack.includes(name)) fail("include_cycle");
    if (visited.has(name)) fail("duplicate_include");
    if (stack.length >= 64) fail("file_limit");
    visited.add(name);
    const found = await providers(name);
    const stream = lex(found[0].source.replace(/^\uFEFF/, ""), found[0].origin);
    for (const f of found) {
      manifest.push(f.origin);
      trace.push({ context, ...f.origin });
    }
    let input = stream;
    if (stream[0]?.raw === "SiiNunit") {
      if (stream[1]?.raw !== "{" || stream.at(-1)?.raw !== "}") fail("unsupported_syntax");
      input = stream.slice(2, -1);
    }
    const result = [];
    for (let i = 0; i < input.length; i++) {
      if (input[i].raw !== "@include") {
        if (++expandedTokens > 1000000) fail("token_limit");
        result.push({ ...input[i], coOrigins: found.map((f) => f.origin) });
        continue;
      }
      const quoted = input[++i]?.raw;
      if (!quoted?.startsWith('"')) fail("unsupported_include");
      let target;
      try {
        target = JSON.parse(quoted);
      } catch {
        fail("unsupported_include");
      }
      for (const child of await expand(virtual(target, name), context, visited, [...stack, name]))
        result.push(child);
    }
    return result;
  }
  for (const layer of roots)
    for (const registry of layer.registries) {
      const name = virtual(registry),
        rootSources = await providers(name),
        context = digest(JSON.stringify(rootSources.map((s) => s.origin)));
      if (registered.has(context)) continue;
      registered.add(context);
      contexts.push({ id: context, registries: rootSources.map((s) => s.origin) });
      const stream = await expand(name, context, new Set()),
        cursor = { at: 0 };
      const take = () => stream[cursor.at++]?.raw,
        expect = (raw) => {
          if (take() !== raw) fail("unsupported_syntax");
        };
      const seen = new Set();
      while (cursor.at < stream.length) {
        const start = cursor.at,
          header = stream[cursor.at],
          type = take();
        expect(":");
        const id = take();
        expect("{");
        const catalogFields = Object.hasOwn(catalog, type) ? catalog[type] : undefined,
          supportFields = Object.hasOwn(support, type) ? support[type] : undefined;
        if (!token.test(id ?? "") || (!catalogFields && !supportFields)) fail("unsupported_unit");
        const values = Object.create(null);
        while (stream[cursor.at]?.raw !== "}") {
          const field = take();
          let array = false;
          if (stream[cursor.at]?.raw === "[") {
            take();
            expect("]");
            array = true;
          }
          const key = `${field}${array ? "[]" : ""}`,
            expected =
              catalogFields && Object.hasOwn(catalogFields, key) ? catalogFields[key] : undefined;
          if ((!expected && !supportFields?.has(key)) || (!array && Object.hasOwn(values, key)))
            fail("unsupported_or_duplicate_field");
          expect(":");
          const actual = value(stream, cursor);
          if (expected && !checkValue(actual, expected)) fail("unsupported_value");
          if (array) {
            values[key] ??= [];
            values[key].push(actual.text);
          } else values[key] = actual.text;
        }
        expect("}");
        const scope = !catalogFields && id.startsWith(".") ? context : undefined,
          key = JSON.stringify([type, id, scope ?? null]);
        if (seen.has(key)) fail("duplicate_unit");
        seen.add(key);
        const previous = units.get(key);
        if (previous) {
          if (
            JSON.stringify(previous.origin) !== JSON.stringify(header.origin) ||
            JSON.stringify(previous.values) !== JSON.stringify(values)
          )
            fail("duplicate_unit");
          previous.contexts.push(context);
          continue;
        }
        const dependencies = [
          ...new Map(
            stream
              .slice(start, cursor.at)
              .flatMap((t) => t.coOrigins)
              .map((o) => [JSON.stringify(o), o]),
          ).values(),
        ].sort(order);
        units.set(key, {
          type,
          id,
          ...(scope ? { scope } : {}),
          values,
          origin: header.origin,
          coOrigins: header.coOrigins,
          dependencies,
          contexts: [context],
          overlays: [],
        });
        if (units.size > 100000) fail("unit_limit");
      }
    }
  return {
    sourceMode: "unique_providers",
    units: [...units.values()],
    contexts,
    manifest: manifest.sort(order),
    sourceManifestSha256: digest(
      JSON.stringify({
        version: 2,
        resolution: "unique_providers",
        layers: layers.map((l) => ({
          packId: l.packId,
          sourceId: l.sourceId ?? null,
          registries: l.registries,
          files: l.files ?? null,
        })),
        contexts,
        filesInExpansionOrder: trace,
      }),
    ),
  };
}
