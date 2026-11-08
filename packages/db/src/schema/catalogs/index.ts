import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn } from "../../core/values.js";

export { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";

export const adrClasses = ["1", "2", "3", "4", "6", "8"] as const;
export type AdrClass = (typeof adrClasses)[number];
const game = (name: string) => mysqlEnum(name, ["ets2", "ats"]);
const code = (name: string) => opaqueColumn(name, { length: 128 });
const name = (column: string) => varchar(column, { length: 256 });

export const catalogDlcs = mysqlTable(
  "catalog_dlcs",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: code("code").notNull(),
    nameEn: name("name_en").notNull(),
    nameRu: name("name_ru"),
    steamAppId: int("steam_app_id", { unsigned: true }),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("catalog_dlc_game_code").on(t.game, t.code),
    uniqueIndex("catalog_dlc_id_game").on(t.id, t.game),
    check("catalog_dlc_code_nonempty", sql`octet_length(${t.code}) > 0`),
    check("catalog_dlc_name_ru_nonempty", sql`${t.nameRu} IS NULL OR char_length(${t.nameRu}) > 0`),
    check("catalog_dlc_steam_positive", sql`${t.steamAppId} IS NULL OR ${t.steamAppId} > 0`),
  ],
);

export const catalogRegions = mysqlTable(
  "catalog_regions",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: code("code").notNull(),
    nameEn: name("name_en").notNull(),
    nameRu: name("name_ru"),
    dlcId: idColumn("dlc_id"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("catalog_region_game_code").on(t.game, t.code),
    uniqueIndex("catalog_region_id_game").on(t.id, t.game),
    check("catalog_region_code_nonempty", sql`octet_length(${t.code}) > 0`),
    check(
      "catalog_region_name_ru_nonempty",
      sql`${t.nameRu} IS NULL OR char_length(${t.nameRu}) > 0`,
    ),
    foreignKey({
      name: "catalog_region_dlc_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);

export const catalogCities = mysqlTable(
  "catalog_cities",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: code("code").notNull(),
    nameEn: name("name_en").notNull(),
    nameRu: name("name_ru"),
    regionId: idColumn("region_id"),
    dlcId: idColumn("dlc_id"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("catalog_city_game_code").on(t.game, t.code),
    uniqueIndex("catalog_city_id_game").on(t.id, t.game),
    check("catalog_city_code_nonempty", sql`octet_length(${t.code}) > 0`),
    check(
      "catalog_city_name_ru_nonempty",
      sql`${t.nameRu} IS NULL OR char_length(${t.nameRu}) > 0`,
    ),
    foreignKey({
      name: "catalog_city_region_fk",
      columns: [t.regionId, t.game],
      foreignColumns: [catalogRegions.id, catalogRegions.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalog_city_dlc_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);

export const catalogCargoes = mysqlTable(
  "catalog_cargoes",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: code("code").notNull(),
    nameEn: name("name_en").notNull(),
    nameRu: name("name_ru"),
    adrClass: mysqlEnum("adr_class", adrClasses),
    dlcId: idColumn("dlc_id"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("catalog_cargo_game_code").on(t.game, t.code),
    uniqueIndex("catalog_cargo_id_game").on(t.id, t.game),
    check("catalog_cargo_code_nonempty", sql`octet_length(${t.code}) > 0`),
    check(
      "catalog_cargo_name_ru_nonempty",
      sql`${t.nameRu} IS NULL OR char_length(${t.nameRu}) > 0`,
    ),
    foreignKey({
      name: "catalog_cargo_dlc_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);

export const catalogTrailers = mysqlTable(
  "catalog_trailers",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: code("code").notNull(),
    nameEn: name("name_en").notNull(),
    nameRu: name("name_ru"),
    dlcId: idColumn("dlc_id"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [
    uniqueIndex("catalog_trailer_game_code").on(t.game, t.code),
    uniqueIndex("catalog_trailer_id_game").on(t.id, t.game),
    check("catalog_trailer_code_nonempty", sql`octet_length(${t.code}) > 0`),
    check(
      "catalog_trailer_name_ru_nonempty",
      sql`${t.nameRu} IS NULL OR char_length(${t.nameRu}) > 0`,
    ),
    foreignKey({
      name: "catalog_trailer_dlc_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);
