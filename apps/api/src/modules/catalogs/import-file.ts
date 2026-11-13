import {
  CATALOG_IMPORT_MAX_ROWS,
  type ImportList,
  ignoredImportColumns,
  importColumns,
  optionalImportColumns,
} from "./config.js";

export interface ImportRow {
  line: number;
  values: Record<string, string>;
  /** Per-line structural problems found while reading the file. */
  fileIssues: { field: string; reason: string }[];
}

export class CatalogFileError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CatalogFileError";
  }
}

function decode(bytes: Buffer): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new CatalogFileError("invalid_utf8");
  }
}

/** RFC 4180 reader: quoted fields, CRLF, embedded newlines. Keeps each record's first line number. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    cellQuoted = false,
    line = 1,
    start = 1,
    i = 0;
  const finishCell = () => {
    cells.push(cell);
    cell = "";
    cellQuoted = false;
  };
  const finishRecord = () => {
    const blank = cells.length === 0 && cell === "" && !cellQuoted;
    if (blank) return;
    finishCell();
    records.push({ line: start, cells });
    cells = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        cellQuoted = true;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      cellQuoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      finishCell();
      i++;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      finishRecord();
      i += 2;
      line++;
      start = line;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      finishRecord();
      i++;
      line++;
      start = line;
      continue;
    }
    cell += ch;
    i++;
  }
  if (quoted) throw new CatalogFileError("unterminated_quote");
  finishRecord();
  return records;
}

function fromCsv(
  text: string,
  columns: readonly string[],
  optional: readonly string[],
  ignored: readonly string[],
): ImportRow[] {
  const records = parseCsv(text);
  const header = records[0];
  if (!header) throw new CatalogFileError("empty");
  const names = header.cells.map((c) => c.trim());
  if (
    new Set(names).size !== names.length ||
    names.some((n) => !columns.includes(n) && !ignored.includes(n))
  )
    throw new CatalogFileError("unknown_column");
  for (const column of columns)
    if (!names.includes(column) && !optional.includes(column))
      throw new CatalogFileError("missing_column");
  return records.slice(1).map((record) => {
    const fileIssues: ImportRow["fileIssues"] = [];
    if (record.cells.length !== names.length)
      fileIssues.push({ field: "file", reason: "column_count" });
    const values: Record<string, string> = {};
    for (const [index, name] of names.entries())
      if (!ignored.includes(name)) values[name] = record.cells[index] ?? "";
    return { line: record.line, values, fileIssues };
  });
}

function fromJson(
  text: string,
  columns: readonly string[],
  ignored: readonly string[],
): ImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CatalogFileError("invalid_json");
  }
  if (!Array.isArray(parsed)) throw new CatalogFileError("invalid_json");
  return parsed.map((entry, index) => {
    const values: Record<string, string> = {};
    const fileIssues: ImportRow["fileIssues"] = [];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return { line: index + 1, values, fileIssues: [{ field: "row", reason: "invalid_row" }] };
    for (const [key, value] of Object.entries(entry)) {
      if (ignored.includes(key)) continue;
      if (!columns.includes(key)) {
        fileIssues.push({ field: key, reason: "unknown_field" });
        continue;
      }
      if (value === null) values[key] = "";
      else if (typeof value === "string") values[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) values[key] = String(value);
      else fileIssues.push({ field: key, reason: "invalid" });
    }
    for (const column of columns) values[column] ??= "";
    return { line: index + 1, values, fileIssues };
  });
}

/** Reads an upload. CSV unless the first non-whitespace byte opens a JSON array. */
export function readImportFile(list: ImportList, bytes: Buffer): ImportRow[] {
  if (bytes.length === 0) throw new CatalogFileError("empty");
  const text = decode(bytes);
  const columns = importColumns[list];
  const optional = optionalImportColumns[list] ?? [];
  const ignored = ignoredImportColumns[list] ?? [];
  const rows = /^\s*\[/.test(text)
    ? fromJson(text, columns, ignored)
    : fromCsv(text, columns, optional, ignored);
  if (rows.length > CATALOG_IMPORT_MAX_ROWS) throw new CatalogFileError("too_many_rows");
  return rows;
}
