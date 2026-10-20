import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class RegistryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new RegistryError(code);
};
const within = (root, path) => {
  const rel = relative(root, path);
  return (
    rel !== ".." &&
    !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(rel)
  );
};
// This deliberately small grammar accepts reviewed definition fields only. Unknown
// syntax/fields fail closed; source compatibility requires separate real-data proof.
const fields = new Set([
  "name",
  "country",
  "unit_mass",
  "adr_class",
  "body_type",
  "chain_type",
  "city",
  "city_name",
  "city_name_localized",
  "key_city",
  "population",
  "sort_name",
  "time_zone",
  "time_zone_name",
  "trailer_look",
  "type",
]);
const arrays = new Set([
  "map_x_offsets",
  "map_y_offsets",
  "vehicle_brands",
  "license_plate",
  "templates",
  "def0",
  "def1",
  "def2",
  "def3",
  "def4",
  "def5",
]);
function tokens(source) {
  const out = [];
  let at = 0;
  while (at < source.length) {
    const remaining = source.slice(at);
    const whitespace = /^(?:\s+|\/\/[^\n]*|#[^\n]*(?:\n|$))/.exec(remaining);
    if (whitespace && !remaining.startsWith("@include")) {
      at += whitespace[0].length;
      continue;
    }
    const match =
      /^("(?:[^"\\\r\n]|\\["\\])*"|@include|[A-Za-z_.][A-Za-z0-9_.-]*|-?(?:0|[1-9]\d*)(?:\.\d+)?|[{}:[\]])/.exec(
        remaining,
      );
    if (!match) fail("unsupported_syntax");
    out.push(match[0]);
    at += match[0].length;
    if (out.length > 1000000) fail("token_limit");
  }
  return out;
}
export async function parseRegistries(layers, options = {}) {
  if (!Array.isArray(layers) || !layers.length || layers.length > 512) fail("invalid_layers");
  const maximumBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const maximumFiles = options.maxFiles ?? 10000;
  let total = 0,
    count = 0;
  const units = new Map(),
    origins = [];
  for (const layer of layers) {
    if (
      !layer ||
      !/^[a-z][a-z0-9_.-]{0,127}$/.test(layer.packId) ||
      !Array.isArray(layer.registries) ||
      !layer.registries.length
    )
      fail("invalid_layer");
    const root = resolve(layer.root);
    if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
      fail("symlink_root");
    const seenUnits = new Set(),
      visited = new Set();
    async function load(name, stack = []) {
      if (
        typeof name !== "string" ||
        isAbsolute(name) ||
        name.includes("\\") ||
        name.includes("\0")
      )
        fail("path_escape");
      const path = resolve(root, name);
      if (!within(root, path)) fail("path_escape");
      // Check each path component as well as realpath; no symlink traversal.
      const rel = relative(root, path);
      let current = root;
      try {
        for (const part of rel.split(/[\\/]/)) {
          current = resolve(current, part);
          if ((await lstat(current)).isSymbolicLink()) fail("symlink_path");
        }
        if (!within(root, await realpath(path))) fail("path_escape");
      } catch (error) {
        if (error instanceof RegistryError) throw error;
        fail("missing_include");
      }
      if (stack.includes(path)) fail("include_cycle");
      if (visited.has(path)) fail("duplicate_include");
      if (++count > maximumFiles || stack.length >= 64) fail("file_limit");
      visited.add(path);
      const bytes = await readFile(path);
      total += bytes.length;
      if (total > maximumBytes) fail("byte_limit");
      const source = bytes.toString("utf8");
      if (!Buffer.from(source).equals(bytes)) fail("invalid_utf8");
      const origin = {
        packId: layer.packId,
        file: rel.replaceAll("\\", "/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      origins.push(origin);
      const stream = tokens(source.replace(/^\uFEFF/, ""));
      let i = 0,
        wrapped = false;
      if (stream[i] === "SiiNunit") {
        i++;
        if (stream[i++] !== "{") fail("unsupported_syntax");
        wrapped = true;
      }
      const take = () => stream[i++];
      const expect = (token) => {
        if (take() !== token) fail("unsupported_syntax");
      };
      while (i < stream.length && !(wrapped && stream[i] === "}")) {
        if (stream[i] === "@include") {
          i++;
          const nameToken = take();
          if (!nameToken?.startsWith('"')) fail("unsupported_include");
          const include = JSON.parse(nameToken);
          if (include.startsWith("/")) await load(include.slice(1), [...stack, path]);
          else
            await load(relative(root, resolve(dirname(path), include)).replaceAll("\\", "/"), [
              ...stack,
              path,
            ]);
          continue;
        }
        const type = take();
        expect(":");
        const id = take();
        expect("{");
        if (!/^[a-z][a-z0-9_]*$/.test(type ?? "") || !/^[A-Za-z_.][A-Za-z0-9_.-]*$/.test(id ?? ""))
          fail("unsupported_unit");
        const values = {};
        while (stream[i] !== "}") {
          const field = take();
          let array = false;
          if (stream[i] === "[") {
            take();
            expect("]");
            array = true;
          }
          if (array ? !arrays.has(field) : !fields.has(field) || Object.hasOwn(values, field))
            fail("unsupported_or_duplicate_field");
          expect(":");
          const value = take();
          if (!value || ["{", "}", ":", "@include"].includes(value)) fail("unsupported_value");
          const parsed = value.startsWith('"') ? JSON.parse(value) : value;
          if (array) {
            const key = `${field}[]`;
            values[key] ??= [];
            values[key].push(parsed);
          } else values[field] = parsed;
        }
        expect("}");
        const key = `${type}:${id}`;
        if (seenUnits.has(key)) fail("duplicate_unit");
        seenUnits.add(key);
        const previous = units.get(key);
        if (previous && !layer.overlay) fail("unapproved_overlay");
        units.set(key, {
          type,
          id,
          values,
          origin,
          overlays: previous ? [...previous.overlays, previous.origin] : [],
        });
      }
      if (wrapped) expect("}");
      if (i !== stream.length) fail("unsupported_syntax");
    }
    for (const registry of layer.registries) await load(registry);
  }
  const manifest = [...origins].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), "en"),
  );
  return {
    units: [...units.values()],
    manifest,
    sourceManifestSha256: createHash("sha256")
      .update(
        JSON.stringify({
          layers: layers.map((layer) => ({
            packId: layer.packId,
            overlay: layer.overlay === true,
            registries: [...layer.registries],
          })),
          filesInExpansionOrder: origins,
        }),
      )
      .digest("hex"),
  };
}
