import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") quoted = !quoted;
    else if (!quoted && (ch === "#" || (ch === "/" && line[i + 1] === "/")))
      return line.slice(0, i);
  }
  return line;
}
export function siiValue(text) {
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
export function parseUnits(file) {
  const units = [];
  let unit = null;
  let pending = null;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (!unit) {
      const head = /^([A-Za-z_]\w*)\s*:\s*([^\s{]+)\s*(\{)?$/.exec(line);
      if (head) {
        pending = {
          type: head[1],
          id: head[2].toLowerCase(),
          file,
          fields: {},
          arrays: {},
          duplicateFields: [],
        };
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
    } else {
      if (Object.hasOwn(unit.fields, field[1])) unit.duplicateFields.push(field[1]);
      unit.fields[field[1]] = value;
    }
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
export function registered(defDir, name, type) {
  const units = new Map();
  if (!existsSync(defDir)) return units;
  const re = new RegExp(`^${name}(\\.[^.]+)?\\.sii$`);
  for (const reg of readdirSync(defDir).filter((f) => re.test(f)))
    for (const file of includes(join(defDir, reg), dirname(defDir)))
      for (const u of parseUnits(file)) if (u.type === type) units.set(u.id, u);
  return units;
}
