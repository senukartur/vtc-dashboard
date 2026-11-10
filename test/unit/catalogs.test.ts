import { expect, test } from "vitest";
import {
  CATALOG_IMPORT_MAX_ROWS,
  type CatalogConfig,
  catalogLists,
  importColumns,
  validateCatalogConfig,
  validCode,
} from "../../apps/api/src/modules/catalogs/config.ts";
import { cursorCodec } from "../../apps/api/src/modules/catalogs/cursor.ts";
import {
  CatalogFileError,
  parseCsv,
  readImportFile,
} from "../../apps/api/src/modules/catalogs/import-file.ts";

const header = importColumns.cities.filter((column) => column !== "name_native").join(",");
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"));
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CatalogFileError) return error.message;
    throw error;
  }
  return "no error";
};

test("the CSV reader keeps quotes, commas and CRLF inside a field and numbers physical lines", () => {
  expect(parseCsv('a,b\r\n"x,1","he said ""ok"""\r\n')).toEqual([
    { line: 1, cells: ["a", "b"] },
    { line: 2, cells: ["x,1", 'he said "ok"'] },
  ]);
  // A record that spans lines keeps its first line; the next record starts after the span.
  expect(parseCsv('h\n"one\ntwo\r\nthree"\nnext\n')).toEqual([
    { line: 1, cells: ["h"] },
    { line: 2, cells: ["one\ntwo\r\nthree"] },
    { line: 5, cells: ["next"] },
  ]);
  // Blank physical lines still advance the count and produce no record.
  expect(parseCsv("h\n\n\nrow\n")).toEqual([
    { line: 1, cells: ["h"] },
    { line: 4, cells: ["row"] },
  ]);
  expect(parseCsv("a\rb")).toEqual([
    { line: 1, cells: ["a"] },
    { line: 2, cells: ["b"] },
  ]);
  expect(parseCsv('""')).toEqual([{ line: 1, cells: [""] }]);
  expect(reason(() => parseCsv('a\n"open'))).toBe("unterminated_quote");
});

test("an import file reads BOM-prefixed UTF-8, keeps code bytes and reports the physical line", () => {
  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    csv(
      header,
      'ets2,_fixture__a,"North, fictional",Северный,,',
      'ets2,fixture_b,"Two',
      'lines",,,',
    ),
  ]);
  const rows = readImportFile("cities", bom);
  expect(rows.map((row) => row.line)).toEqual([2, 3]);
  expect(rows[0]).toEqual({
    line: 2,
    values: {
      game: "ets2",
      code: "_fixture__a",
      name_en: "North, fictional",
      name_ru: "Северный",
      region_code: "",
      dlc_code: "",
    },
    fileIssues: [],
  });
  expect(rows[1]?.values.name_en).toBe("Two\r\nlines");
  // Whitespace in a code reaches validation verbatim instead of being trimmed away.
  expect(readImportFile("cities", csv(header, "ets2, a ,n,,,"))[0]?.values.code).toBe(" a ");
});

test("an import file rejects invalid UTF-8, empty input and every wrong header shape", () => {
  expect(reason(() => readImportFile("cities", Buffer.alloc(0)))).toBe("empty");
  expect(
    reason(() =>
      readImportFile("cities", Buffer.concat([csv(header, "ets2,"), Buffer.from([0xc3, 0x28])])),
    ),
  ).toBe("invalid_utf8");
  expect(reason(() => readImportFile("cities", Buffer.from("\r\n\r\n")))).toBe("empty");
  expect(reason(() => readImportFile("cities", csv(`${header},extra`)))).toBe("unknown_column");
  expect(reason(() => readImportFile("cities", csv(`${header},code`)))).toBe("unknown_column");
  expect(reason(() => readImportFile("cities", csv("game,code,name_en")))).toBe("missing_column");
  // Header order is free; values follow their own column.
  expect(
    readImportFile("cities", csv("code,game,name_en,name_ru,region_code,dlc_code", "a,ats,n,,,"))[0]
      ?.values,
  ).toMatchObject({ code: "a", game: "ats" });
  const short = readImportFile("cities", csv(header, "ets2,a"))[0];
  expect(short?.fileIssues).toEqual([{ field: "file", reason: "column_count" }]);
});

test("name_native is an optional city column read from a seventh cell", () => {
  expect(reason(() => readImportFile("cities", csv(header, "ets2,a,n,,,")))).toBe("no error");
  const rows = readImportFile(
    "cities",
    csv(`${header},name_native`, "ets2,kronburg,Crownburg,Крёнбург,,,Krönburg"),
  );
  expect(rows[0]?.values).toMatchObject({ name_en: "Crownburg", name_native: "Krönburg" });
  expect(rows[0]?.fileIssues).toEqual([]);
  // Only the city list knows the column; everywhere else it stays an unknown one.
  expect(
    reason(() => readImportFile("trailers", csv("game,code,name_en,name_ru,dlc_code,name_native"))),
  ).toBe("unknown_column");
  expect(
    readImportFile(
      "cargoes",
      Buffer.from(JSON.stringify([{ game: "ets2", code: "a", name_en: "n", name_native: "x" }])),
    )[0]?.fileIssues,
  ).toEqual([{ field: "name_native", reason: "unknown_field" }]);
});

test("JSON rows read like CSV rows, with array positions as line numbers", () => {
  const fromJson = readImportFile(
    "cargoes",
    Buffer.from(
      JSON.stringify([
        {
          game: "ets2",
          code: "fixture_gas",
          name_en: "Fictional gas",
          name_ru: null,
          adr_class: 2,
          dlc_code: "",
        },
      ]),
    ),
  );
  const fromCsv = readImportFile(
    "cargoes",
    csv(importColumns.cargoes.join(","), "ets2,fixture_gas,Fictional gas,,2,"),
  );
  expect(fromJson[0]?.line).toBe(1);
  expect(fromCsv[0]?.line).toBe(2);
  expect(fromJson[0]?.values).toEqual(fromCsv[0]?.values);

  const issues = readImportFile(
    "trailers",
    Buffer.from(JSON.stringify([{ game: "ets2", code: "a", extra: "x", name_en: true }, 7])),
  );
  expect(issues[0]?.fileIssues).toEqual([
    { field: "extra", reason: "unknown_field" },
    { field: "name_en", reason: "invalid" },
  ]);
  expect(issues[1]).toMatchObject({
    line: 2,
    fileIssues: [{ field: "row", reason: "invalid_row" }],
  });
  expect(reason(() => readImportFile("trailers", Buffer.from("[1,")))).toBe("invalid_json");
});

test("an import file is bounded by row count at the shared limit", () => {
  const rows = (count: number) =>
    Buffer.from(
      `${importColumns.trailers.join(",")}\n${"ets2,code,name,,\n".repeat(count)}`,
      "utf8",
    );
  expect(readImportFile("trailers", rows(CATALOG_IMPORT_MAX_ROWS))).toHaveLength(
    CATALOG_IMPORT_MAX_ROWS,
  );
  expect(reason(() => readImportFile("trailers", rows(CATALOG_IMPORT_MAX_ROWS + 1)))).toBe(
    "too_many_rows",
  );
});

test("every list declares its import columns, and a template header round-trips through the reader", () => {
  for (const list of catalogLists) {
    expect(importColumns[list]).toEqual(expect.arrayContaining(["game", "code", "name_en"]));
    expect(readImportFile(list, Buffer.from(`${importColumns[list].join(",")}\r\n`))).toEqual([]);
  }
});

test("companies are a plain list and depots read their company and city by code", () => {
  expect(catalogLists).toContain("companies");
  expect(catalogLists).not.toContain("depots");
  expect(importColumns.companies).toEqual(["game", "code", "name_en", "name_ru", "dlc_code"]);
  expect(importColumns.depots).toEqual(["game", "company_code", "city_code", "dlc_code"]);
  const rows = readImportFile(
    "depots",
    csv(
      importColumns.depots.join(","),
      "ets2,fictional_co,fictional_city,",
      "ats,fictional_co,fictional_city,fictional_pack",
    ),
  );
  expect(rows.map((row) => row.values)).toEqual([
    { game: "ets2", company_code: "fictional_co", city_code: "fictional_city", dlc_code: "" },
    {
      game: "ats",
      company_code: "fictional_co",
      city_code: "fictional_city",
      dlc_code: "fictional_pack",
    },
  ]);
  // A depot file with the company columns of a plain list is not a depot file.
  expect(
    reason(() => readImportFile("depots", csv(importColumns.companies.join(","), "ets2,a,b,,"))),
  ).toBe("unknown_column");
  expect(reason(() => readImportFile("depots", csv("game,company_code,dlc_code", "ets2,a,")))).toBe(
    "missing_column",
  );
});

test("code validation keeps opaque bytes but refuses blanks, whitespace, controls and overflow", () => {
  for (const value of ["_x__x", ".a.b", "Ünï-çødé", "a".repeat(128), "é".repeat(64)])
    expect(validCode(value)).toBe(true);
  for (const value of [
    "",
    "a b",
    " a",
    "a\t",
    "a\u0000",
    "a\u001f",
    "a\u007f",
    "a".repeat(129),
    "é".repeat(65),
    "\ud800",
    1,
    null,
  ])
    expect(validCode(value)).toBe(false);
});

test("the cursor key must be 32 hex bytes", () => {
  const config: CatalogConfig = { cursorKey: "1".repeat(64) };
  expect(() => validateCatalogConfig(config)).not.toThrow();
  for (const cursorKey of ["1".repeat(63), "G".repeat(64), ""])
    expect(() => validateCatalogConfig({ cursorKey })).toThrow("INVALID_CATALOG_CONFIG");
});

test("signed cursors and import tokens bind their exact context and reject tampering", () => {
  const codec = cursorCodec("1".repeat(64));
  const binding = { list: "cities", game: "ets2", includeHidden: false };
  const token = codec.write(binding, "after-row");
  expect(codec.read({ game: "ets2", includeHidden: false, list: "cities" }, token)).toBe(
    "after-row",
  );
  expect(() => codec.read({ ...binding, game: "ats" }, token)).toThrow("INVALID_CURSOR");
  expect(() => cursorCodec("2".repeat(64)).read(binding, token)).toThrow("INVALID_CURSOR");
  const [data, mac] = token.split(".") as [string, string];
  const flipped = `${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`;
  for (const invalid of [`${data}.${flipped}`, data, `${data}.${mac}.extra`, "", "x".repeat(2049)])
    expect(() => codec.read(binding, invalid)).toThrow("INVALID_CURSOR");
  const forged = Buffer.from(JSON.stringify({ binding: "x", after: "y", extra: 1 })).toString(
    "base64url",
  );
  expect(() => codec.read(binding, `${forged}.${mac}`)).toThrow("INVALID_CURSOR");
});
