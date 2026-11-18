import { createHash } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  catalogCargoes,
  catalogCities,
  catalogCompanies,
  catalogCompanyCities,
  catalogCompanyLogos,
  catalogDlcs,
  catalogRegions,
  catalogTrailers,
  catalogTrailerTypes,
  eq,
  gt,
  inArray,
  or,
  sql,
} from "@vtc/db/catalogs-schema";
import { exists, isNull, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { retryTransaction } from "../../platform/jobs/queue.js";
import { duplicateKey } from "../../platform/outbox/events.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  type AdrClass,
  adrClasses,
  CATALOG_IMPORT_TOKEN_TTL_MS,
  CATALOG_LOGO_BULK_MAX_FILES,
  CATALOG_PREVIEW_MAX_LINES,
  type CatalogConfig,
  type CatalogKind,
  type CatalogList,
  type Game,
  type ImportList,
  isCanonicalList,
  validateCatalogConfig,
  validCode,
} from "./config.js";
import { cursorCodec, ordered } from "./cursor.js";
import { CatalogFileError, type ImportRow, readImportFile } from "./import-file.js";
import { inspectPng, logoCodeFromName, PngError } from "./png.js";

type S = components["schemas"];
type Locale = "en" | "ru";
type CodeResolution = { game: Game; kind: CatalogKind; code: string };
type ListFilters = {
  hidden?: "only";
  includeHidden?: boolean;
  untranslated?: boolean;
  logo?: "missing";
  trailerTypeId?: string;
};
export interface CatalogPorts {
  identity: Pick<Identity, "authorizeInTransaction" | "onboardingCompany" | "externalCommand">;
}
const parentKinds = { dlc: catalogDlcs, region: catalogRegions } as const;
const kindTables = {
  city: catalogCities,
  cargo: catalogCargoes,
  trailer: catalogTrailers,
  "trailer-type": catalogTrailerTypes,
} as const;
const tables = {
  dlcs: catalogDlcs,
  regions: catalogRegions,
  cities: catalogCities,
  companies: catalogCompanies,
  cargoes: catalogCargoes,
  trailers: catalogTrailers,
} as const;
// Column access shared by every list; list-specific columns are read through it deliberately.
type Common = typeof catalogCities;
const common = (list: CatalogList) => tables[list] as unknown as Common;
const dlcParent = alias(catalogDlcs, "dlc_parent");
const regionParent = alias(catalogRegions, "region_parent");
const trailerPeer = alias(catalogTrailers, "trailer_peer");
const depotVisible = and(
  eq(catalogCompanyCities.hidden, false),
  eq(catalogCompanies.hidden, false),
  eq(catalogCities.hidden, false),
);
const companyLogoLink = eq(catalogCompanyLogos.companyId, catalogCompanies.id);
const companyMissingLogo = isNull(catalogCompanyLogos.companyId);
const countMatching = (condition: SQL | undefined) =>
  sql<number>`COUNT(CASE WHEN ${condition} THEN 1 END)`.mapWith(Number);

// Keep the existing cursor binding when none of the maintenance filters is active.
const maintenanceBinding = ({ hidden, untranslated, logo }: ListFilters) =>
  hidden || untranslated || logo
    ? [{ hidden: hidden ?? null, untranslated: untranslated ?? false, logo: logo ?? null }]
    : [];
// Canonical-name order replaced the localized one for DLCs, companies and company-ordered depots;
// the mark keeps a cursor issued under the old order from being read under the new one.
const canonicalOrderBinding = (canonical: boolean) => (canonical ? ["canonical-name"] : []);

function changesFields(row: Record<string, unknown>, fields: Record<string, unknown>) {
  return Object.entries(fields).some(([field, value]) => {
    const before = row[field];
    return Buffer.isBuffer(value) && Buffer.isBuffer(before)
      ? !value.equals(before)
      : value !== before;
  });
}

const catalogError = (status: number, code: string) => identityError(status, code);
const importInvalid = (lines: S["CatalogImportLine"][]) =>
  Object.assign(catalogError(422, "CATALOG_IMPORT_INVALID"), {
    details: lines.slice(0, 50).flatMap((line) =>
      line.issues.slice(0, 4).map((issue) => ({
        field: `line:${line.line}:${issue.field}`.slice(0, 128),
        code: issue.reason,
      })),
    ),
  });
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function label(
  id: string,
  nameEn: string,
  nameRu: string | null,
  hidden: boolean,
  locale: Locale,
  nameNative: string | null = null,
): S["CatalogLabel"] {
  const ru = locale === "ru" && nameRu !== null;
  return {
    entityId: id,
    label: ru ? nameRu : nameEn,
    requestedLocale: locale,
    renderedLocale: ru ? "ru" : "en",
    englishFallback: locale === "ru" && !ru,
    hidden,
    ...(nameNative === null ? {} : { nameNative }),
  };
}
/** A DLC or company label: always the canonical name, never a translation or a fallback mark. */
function canonicalLabel(id: string, name: string, hidden: boolean, locale: Locale) {
  return { ...label(id, name, null, hidden, locale), englishFallback: false };
}
/** A trimmed optional name; empty means no value, so a blank can never become a label. */
const optionalName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name === "" ? null : name;
};
const keyOf = (game: Game, code: Buffer | string) =>
  `${game}\0${typeof code === "string" ? Buffer.from(code).toString("hex") : code.toString("hex")}`;
const fileError = (error: unknown): never => {
  if (error instanceof CatalogFileError) throw catalogError(422, "CATALOG_FILE_INVALID");
  throw error;
};

/** One uploaded logo file; `truncated` marks a file cut off at the per-logo size limit. */
export interface LogoFile {
  name: string;
  bytes: Buffer;
  truncated: boolean;
}

export interface CatalogEntity {
  id: string;
  game: Game;
  kind: Exclude<CatalogKind, "trailer-type">;
  hidden: boolean;
  adrClass: AdrClass | null;
  identityKind?: "type";
}

export function createCatalogs(
  unit: UnitOfWork,
  config: CatalogConfig,
  ports: CatalogPorts,
  now = () => new Date(),
) {
  validateCatalogConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn),
    audit = createAudit(unit),
    codec = cursorCodec(config.cursorKey);
  const authority = (tx: TxContext, actor: Actor, admin: boolean) =>
    ports.identity.authorizeInTransaction(
      tx,
      actor,
      admin ? "qualifications.manage" : "company.read",
    );
  const parentTable = (kind: keyof typeof parentKinds) => parentKinds[kind];
  /** The name a list orders and pages by; canonical lists ignore the requested locale. */
  function displayName(list: CatalogList, locale: Locale) {
    const t = common(list);
    return locale === "ru" && !isCanonicalList(list)
      ? sql`COALESCE(${t.nameRu}, ${t.nameEn})`
      : sql`${t.nameEn}`;
  }
  function selectColumns(list: CatalogList, withLogo = false) {
    const t = common(list);
    const logo = withLogo && list === "companies";
    return {
      id: t.id,
      game: t.game,
      code: t.code,
      trailerTypeId: list === "trailers" ? catalogTrailers.trailerTypeId : sql<string | null>`NULL`,
      typeEn: list === "trailers" ? catalogTrailerTypes.nameEn : sql<string | null>`NULL`,
      typeRu: list === "trailers" ? catalogTrailerTypes.nameRu : sql<string | null>`NULL`,
      commonTrailer: list === "trailers" ? catalogTrailers.commonTrailer : sql<Buffer | null>`NULL`,
      variantCount:
        list === "trailers"
          ? sql<number>`CASE WHEN ${catalogTrailers.commonTrailer} IS NULL THEN 1 ELSE (
        SELECT COUNT(*) FROM ${catalogTrailers} AS ${sql.identifier("trailer_peer")}
        WHERE ${trailerPeer.game} = ${catalogTrailers.game}
        AND ${trailerPeer.commonTrailer} = ${catalogTrailers.commonTrailer}
      ) END`.mapWith(Number)
          : sql<number>`1`,
      nameEn: t.nameEn,
      nameRu: t.nameRu,
      nameNative: list === "cities" ? catalogCities.nameNative : sql<string | null>`NULL`,
      hidden: t.hidden,
      updatedAt: t.updatedAt,
      dlcId: list === "dlcs" ? sql<string | null>`NULL` : t.dlcId,
      regionId: list === "cities" ? catalogCities.regionId : sql<string | null>`NULL`,
      steamAppId: list === "dlcs" ? catalogDlcs.steamAppId : sql<number | null>`NULL`,
      adrClass: list === "cargoes" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`,
      dlcEn: list === "dlcs" ? sql<string | null>`NULL` : dlcParent.nameEn,
      dlcHidden: list === "dlcs" ? sql<boolean | null>`NULL` : dlcParent.hidden,
      regionEn: list === "cities" ? regionParent.nameEn : sql<string | null>`NULL`,
      regionRu: list === "cities" ? regionParent.nameRu : sql<string | null>`NULL`,
      regionHidden: list === "cities" ? regionParent.hidden : sql<boolean | null>`NULL`,
      // Only the digest and size are listed; the image bytes are never part of a list query.
      logoSha: logo ? catalogCompanyLogos.sha256 : sql<Buffer | null>`NULL`,
      logoBytes: logo ? catalogCompanyLogos.byteLength : sql<number | null>`NULL`,
    };
  }
  type ListRow = {
    id: string;
    game: Game;
    code: Buffer;
    commonTrailer: Buffer | null;
    trailerTypeId: string | null;
    typeEn: string | null;
    typeRu: string | null;
    variantCount: number;
    nameEn: string;
    nameRu: string | null;
    nameNative: string | null;
    hidden: boolean;
    updatedAt: string;
    dlcId: string | null;
    regionId: string | null;
    steamAppId: number | null;
    adrClass: AdrClass | null;
    dlcEn: string | null;
    dlcHidden: boolean | null;
    regionEn: string | null;
    regionRu: string | null;
    regionHidden: boolean | null;
    logoSha: Buffer | null;
    logoBytes: number | null;
  };
  async function fetchRows(
    tx: TxContext,
    list: CatalogList,
    where: ReturnType<typeof and>,
    limit?: number,
    order?: boolean,
    locale: Locale = "en",
  ): Promise<ListRow[]> {
    const t = common(list);
    let query = c(tx).select(selectColumns(list, true)).from(t).$dynamic();
    if (list !== "dlcs") query = query.leftJoin(dlcParent, eq(t.dlcId, dlcParent.id));
    if (list === "trailers")
      query = query.leftJoin(
        catalogTrailerTypes,
        eq(catalogTrailers.trailerTypeId, catalogTrailerTypes.id),
      );
    if (list === "cities")
      query = query.leftJoin(regionParent, eq(catalogCities.regionId, regionParent.id));
    if (list === "companies") query = query.leftJoin(catalogCompanyLogos, companyLogoLink);
    query = query.where(where);
    if (order) query = query.orderBy(asc(displayName(list, locale)), asc(t.id));
    if (limit !== undefined) query = query.limit(limit);
    return (await query) as unknown as ListRow[];
  }
  async function companyDepotCounts(tx: TxContext, game: Game, ids: string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const t = catalogCompanyCities;
    const rows = await c(tx)
      .select({ companyId: t.companyId, count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(t)
      .where(and(eq(t.game, game), inArray(t.companyId, ids)))
      .groupBy(t.companyId);
    return new Map(rows.map((row) => [row.companyId, row.count]));
  }
  const logoOf = (sha: Buffer | null, bytes: number | null): S["CatalogLogo"] | null =>
    sha === null || bytes === null
      ? null
      : { version: Buffer.from(sha).toString("hex").slice(0, 16), byteLength: Number(bytes) };
  function itemDto(
    list: CatalogList,
    row: ListRow,
    locale: Locale,
    depotCount = 0,
  ): S["CatalogItem"] {
    const dlc =
      row.dlcId && row.dlcEn !== null
        ? canonicalLabel(row.dlcId, row.dlcEn, row.dlcHidden === true, locale)
        : null;
    const canonical = isCanonicalList(list);
    return {
      id: row.id,
      game: row.game,
      code: row.code.toString(),
      ...(list === "trailers"
        ? {
            commonTrailer: row.commonTrailer?.toString() ?? null,
            trailerTypeId: row.trailerTypeId,
            trailerType:
              row.trailerTypeId && row.typeEn
                ? label(row.trailerTypeId, row.typeEn, row.typeRu, false, locale)
                : null,
            variantCount: row.variantCount,
          }
        : {}),
      nameEn: row.nameEn,
      // A canonical list's stored Russian name stays in the database but is never returned.
      nameRu: canonical ? null : row.nameRu,
      hidden: row.hidden,
      updatedAt: row.updatedAt,
      display: canonical
        ? canonicalLabel(row.id, row.nameEn, row.hidden, locale)
        : label(row.id, row.nameEn, row.nameRu, row.hidden, locale, row.nameNative),
      dlcId: list === "dlcs" ? null : row.dlcId,
      dlc: list === "dlcs" ? null : dlc,
      ...(list === "dlcs" ? { steamAppId: row.steamAppId } : {}),
      ...(list === "cities"
        ? {
            nameNative: row.nameNative,
            regionId: row.regionId,
            region:
              row.regionId && row.regionEn !== null
                ? label(row.regionId, row.regionEn, row.regionRu, row.regionHidden === true, locale)
                : null,
          }
        : {}),
      ...(list === "cargoes" ? { adrClass: row.adrClass } : {}),
      ...(list === "companies" ? { logo: logoOf(row.logoSha, row.logoBytes), depotCount } : {}),
    };
  }
  async function itemById(tx: TxContext, list: CatalogList, id: string, locale: Locale) {
    const [row] = await fetchRows(tx, list, eq(common(list).id, id));
    if (!row && list === "trailers") {
      const type = await trailerTypeItem(tx, id, locale);
      if (type) return type;
    }
    if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
    const counts = list === "companies" ? await companyDepotCounts(tx, row.game, [id]) : undefined;
    return itemDto(list, row, locale, counts?.get(id));
  }
  async function trailerTypeItem(
    tx: TxContext,
    id: string,
    locale: Locale,
  ): Promise<S["CatalogItem"] | undefined> {
    const [row] = await c(tx)
      .select()
      .from(catalogTrailerTypes)
      .where(eq(catalogTrailerTypes.id, applicationId(id)));
    if (!row) return undefined;
    return {
      id: row.id,
      game: row.game,
      code: row.code.toString(),
      nameEn: row.nameEn,
      nameRu: row.nameRu,
      hidden: false,
      dlcId: null,
      dlc: null,
      display: label(row.id, row.nameEn, row.nameRu, false, locale),
    };
  }
  async function trailerType(tx: TxContext, game: Game, value: unknown) {
    if (value == null) return;
    const [row] = await c(tx)
      .select({ id: catalogTrailerTypes.id })
      .from(catalogTrailerTypes)
      .where(
        and(
          eq(catalogTrailerTypes.id, applicationId(value as string)),
          eq(catalogTrailerTypes.game, game),
        ),
      )
      .for("share");
    if (!row) throw catalogError(422, "CATALOG_PARENT_INVALID");
  }
  async function parent(
    tx: TxContext,
    kind: keyof typeof parentKinds,
    game: Game,
    id: string | null | undefined,
    current: string | null = null,
  ) {
    if (id === null || id === undefined) return;
    const table = parentTable(kind);
    const [row] = await c(tx)
      .select({ id: table.id, hidden: table.hidden })
      .from(table)
      .where(and(eq(table.id, applicationId(id)), eq(table.game, game)))
      .for("share");
    // A hidden parent stays valid only as the unchanged link it already was.
    if (!row || (row.hidden && row.id !== current))
      throw catalogError(422, "CATALOG_PARENT_INVALID");
  }
  function requireCode(value: string) {
    if (!validCode(value)) throw identityError(422);
    return Buffer.from(value);
  }
  function fieldsOf(list: CatalogList, input: Record<string, unknown>): Record<string, unknown> {
    const nameRu = input.nameRu === "" ? null : input.nameRu;
    return {
      ...("nameRu" in input && !isCanonicalList(list) ? { nameRu } : {}),
      ...("nameEn" in input ? { nameEn: input.nameEn } : {}),
      ...("code" in input ? { code: requireCode(input.code as string) } : {}),
      ...(list === "trailers" && "trailerTypeId" in input
        ? { trailerTypeId: input.trailerTypeId }
        : {}),
      ...(list === "trailers" && "commonTrailer" in input
        ? {
            commonTrailer:
              input.commonTrailer === null || input.commonTrailer === ""
                ? null
                : requireCode(input.commonTrailer as string),
          }
        : {}),
      ...(list === "dlcs" && "steamAppId" in input ? { steamAppId: input.steamAppId } : {}),
      ...(list !== "dlcs" && "dlcId" in input ? { dlcId: input.dlcId } : {}),
      ...(list === "cities" && "nameNative" in input
        ? { nameNative: optionalName(input.nameNative) }
        : {}),
      ...(list === "cities" && "regionId" in input ? { regionId: input.regionId } : {}),
      ...(list === "cargoes" && "adrClass" in input ? { adrClass: input.adrClass } : {}),
      ...("hidden" in input ? { hidden: input.hidden } : {}),
    };
  }
  async function recordAudit(
    tx: TxContext,
    actor: Actor,
    operation: "catalog.changed" | "catalog.imported",
    subjectId: string,
    kind: ImportList | "company_logos",
    games: Game[],
  ) {
    const company = await ports.identity.onboardingCompany(tx);
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation,
      subjectKind: "catalog",
      subjectId,
      occurredAt: now().toISOString(),
      companyId: company.id,
      reason: "catalog_update",
      details: { kind, games },
    });
  }
  function assertPatchShape(list: CatalogList, input: S["CatalogItemPatch"]) {
    const allowed: readonly string[] = {
      dlcs: ["code", "nameEn", "steamAppId", "hidden"],
      regions: ["code", "nameEn", "nameRu", "dlcId", "hidden"],
      companies: ["code", "nameEn", "dlcId", "hidden"],
      cities: ["code", "nameEn", "nameRu", "nameNative", "regionId", "dlcId", "hidden"],
      cargoes: ["code", "nameEn", "nameRu", "adrClass", "dlcId", "hidden"],
      trailers: ["code", "nameEn", "nameRu", "dlcId", "hidden", "commonTrailer", "trailerTypeId"],
    }[list];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw identityError(422);
  }
  async function resolveCode(
    tx: TxContext,
    input: CodeResolution,
    current: boolean,
  ): Promise<
    | { status: "resolved"; id: string; adrClass: AdrClass | null }
    | { status: "unknown"; reasonCode: string }
  > {
    if (!validCode(input.code)) return { status: "unknown", reasonCode: "unknown_source_id" };
    const table = kindTables[input.kind];
    const adr = input.kind === "cargo" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`;
    const query = c(tx)
      .select({ id: table.id, adrClass: adr })
      .from(table)
      .where(and(eq(table.game, input.game), eq(table.code, Buffer.from(input.code))))
      .$dynamic();
    const [row] = await (current ? query.for("share") : query);
    if (!row) return { status: "unknown", reasonCode: "unknown_source_id" };
    return { status: "resolved", id: row.id, adrClass: (row.adrClass as AdrClass | null) ?? null };
  }
  async function selectionsInTransaction(
    tx: TxContext,
    selections: readonly { kind: CatalogKind; id: string }[],
  ) {
    const result = new Map<string, CatalogEntity>();
    for (const kind of ["city", "cargo", "trailer", "trailer-type"] as const) {
      const ids = selections
        .filter((s) => s.kind === kind || (kind === "trailer-type" && s.kind === "trailer"))
        .map((s) => applicationId(s.id));
      if (!ids.length) continue;
      const table = kindTables[kind];
      const adr = kind === "cargo" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`;
      const rows = await c(tx)
        .select({
          id: table.id,
          game: table.game,
          hidden:
            kind === "trailer-type"
              ? sql<boolean>`FALSE`
              : (table as typeof catalogTrailers).hidden,
          adrClass: adr,
        })
        .from(table)
        .where(inArray(table.id, [...new Set(ids)]));
      for (const row of rows)
        result.set(row.id, {
          id: row.id,
          game: row.game,
          kind: kind === "trailer-type" ? "trailer" : kind,
          ...(kind === "trailer-type" ? { identityKind: "type" as const } : {}),
          hidden: kind === "trailer-type" ? false : row.hidden,
          adrClass: (row.adrClass as AdrClass | null) ?? null,
        });
    }
    return result;
  }
  async function computeImport(
    tx: TxContext,
    list: CatalogList,
    rows: readonly ImportRow[],
    lock: boolean,
  ) {
    const t = common(list);
    const games = [
      ...new Set(
        rows.flatMap((row) =>
          row.values.game === "ets2" || row.values.game === "ats" ? [row.values.game as Game] : [],
        ),
      ),
    ];
    type Existing = ListRow;
    const existing = new Map<string, Existing>();
    for (const game of games) {
      // Import planning only needs the stored type ID. Keep the read-only dictionary
      // out of this exclusive lock; its reference rows are share-locked below.
      let query = c(tx)
        .select({
          ...selectColumns(list),
          typeEn: sql<string | null>`NULL`,
          typeRu: sql<string | null>`NULL`,
        })
        .from(t)
        .$dynamic();
      if (list !== "dlcs") query = query.leftJoin(dlcParent, eq(t.dlcId, dlcParent.id));
      if (list === "cities")
        query = query.leftJoin(regionParent, eq(catalogCities.regionId, regionParent.id));
      query = query.where(eq(t.game, game));
      const found = (await (lock ? query.for("update") : query)) as unknown as Existing[];
      for (const row of found) existing.set(keyOf(game, row.code), row);
    }
    async function parentCodes(kind: keyof typeof parentKinds) {
      const table = parentTable(kind);
      const map = new Map<string, { id: string; hidden: boolean }>();
      for (const game of games) {
        const query = c(tx)
          .select({ id: table.id, code: table.code, hidden: table.hidden })
          .from(table)
          .where(eq(table.game, game));
        const found = await (lock ? query.for("share") : query);
        for (const row of found) map.set(keyOf(game, row.code), row);
      }
      return map;
    }
    type ParentCodes = Awaited<ReturnType<typeof parentCodes>>;
    const dlcCodes: ParentCodes = list === "dlcs" ? new Map() : await parentCodes("dlc");
    const regionCodes: ParentCodes = list === "cities" ? await parentCodes("region") : new Map();
    const typeCodes = new Map<string, string>();
    if (list === "trailers") {
      const q = c(tx).select().from(catalogTrailerTypes).orderBy(asc(catalogTrailerTypes.id));
      for (const row of await (lock ? q.for("share") : q))
        typeCodes.set(keyOf(row.game, row.code), row.id);
    }
    const seen = new Set<string>();
    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; set: Record<string, unknown> }[] = [];
    const lines: S["CatalogImportLine"][] = [];
    let added = 0,
      changedCount = 0,
      unchanged = 0,
      errors = 0;
    for (const row of rows) {
      const v = row.values;
      const issues: S["CatalogImportIssue"][] = [...row.fileIssues];
      const game = v.game === "ets2" || v.game === "ats" ? (v.game as Game) : null;
      if (!game) issues.push({ field: "game", reason: v.game ? "invalid" : "required" });
      const code = v.code ?? "";
      const codeOk = validCode(code);
      if (!codeOk) issues.push({ field: "code", reason: code === "" ? "required" : "invalid" });
      const linkedRow = game && codeOk ? existing.get(keyOf(game, code)) : undefined;
      const groupingOnly =
        list === "trailers" && (!!v.common_trailer || !!v.trailer_type_code) && !!linkedRow;
      const typeCode = v.trailer_type_code;
      const typeId =
        typeCode === "undefined"
          ? null
          : game && typeCode
            ? typeCodes.get(keyOf(game, typeCode))
            : undefined;
      if (list === "trailers" && typeCode && typeCode !== "undefined" && !typeId)
        issues.push({ field: "trailer_type_code", reason: "unknown_reference" });
      const nameEn = v.name_en ?? "";
      if (!nameEn.trim() && (nameEn !== "" || !groupingOnly))
        issues.push({ field: "name_en", reason: "required" });
      else if ([...nameEn].length > 256) issues.push({ field: "name_en", reason: "too_long" });
      const nameRu = v.name_ru ?? "";
      if ([...nameRu].length > 256) issues.push({ field: "name_ru", reason: "too_long" });
      const nameNative = (v.name_native ?? "").trim();
      const commonTrailer = v.common_trailer || undefined;
      if (list === "trailers" && commonTrailer !== undefined && !validCode(commonTrailer))
        issues.push({ field: "common_trailer", reason: "invalid" });
      if ([...nameNative].length > 256) issues.push({ field: "name_native", reason: "too_long" });
      let steamAppId: number | undefined;
      if (list === "dlcs" && v.steam_app_id) {
        if (!/^[1-9]\d*$/.test(v.steam_app_id) || Number(v.steam_app_id) > 4294967295)
          issues.push({ field: "steam_app_id", reason: "invalid" });
        else steamAppId = Number(v.steam_app_id);
      }
      let adrClass: AdrClass | undefined;
      if (list === "cargoes" && v.adr_class) {
        if ((adrClasses as readonly string[]).includes(v.adr_class))
          adrClass = v.adr_class as AdrClass;
        else issues.push({ field: "adr_class", reason: "invalid" });
      }
      // A hidden parent stays valid only as the unchanged link the row already has.
      let dlcId: string | undefined;
      if (list !== "dlcs" && v.dlc_code && game) {
        const found = dlcCodes.get(keyOf(game, v.dlc_code));
        if (!found) issues.push({ field: "dlc_code", reason: "unknown_reference" });
        else if (found.hidden && linkedRow?.dlcId !== found.id)
          issues.push({ field: "dlc_code", reason: "hidden_reference" });
        else dlcId = found.id;
      }
      let regionId: string | undefined;
      if (list === "cities" && v.region_code && game) {
        const found = regionCodes.get(keyOf(game, v.region_code));
        if (!found) issues.push({ field: "region_code", reason: "unknown_reference" });
        else if (found.hidden && linkedRow?.regionId !== found.id)
          issues.push({ field: "region_code", reason: "hidden_reference" });
        else regionId = found.id;
      }
      if (codeOk && game) {
        const key = keyOf(game, code);
        if (seen.has(key)) issues.push({ field: "code", reason: "duplicate_in_file" });
        seen.add(key);
      }
      const reportedCode = codeOk ? code : null;
      if (issues.length || !game || !codeOk) {
        errors++;
        lines.push({
          line: row.line,
          code: reportedCode,
          status: "error",
          issues: issues.slice(0, 16),
          changedFields: [],
        });
        continue;
      }
      const current = existing.get(keyOf(game, code));
      if (!current) {
        added++;
        inserts.push({
          id: newId(),
          game,
          code: Buffer.from(code),
          nameEn,
          nameRu: nameRu === "" ? null : nameRu,
          ...(list === "dlcs" ? { steamAppId: steamAppId ?? null } : {}),
          ...(list !== "dlcs" ? { dlcId: dlcId ?? null } : {}),
          ...(list === "cities"
            ? { regionId: regionId ?? null, nameNative: nameNative === "" ? null : nameNative }
            : {}),
          ...(list === "cargoes" ? { adrClass: adrClass ?? null } : {}),
          ...(list === "trailers"
            ? {
                commonTrailer: commonTrailer === undefined ? null : Buffer.from(commonTrailer),
                trailerTypeId: typeId ?? null,
              }
            : {}),
          hidden: false,
        });
        continue;
      }
      const set: Record<string, unknown> = {},
        changedFields: string[] = [];
      const compare = (field: string, column: string, before: unknown, after: unknown) => {
        if (before !== after) {
          set[column] = after;
          changedFields.push(field);
        }
      };
      if (nameEn !== "") compare("name_en", "nameEn", current.nameEn, nameEn);
      if (nameRu !== "") compare("name_ru", "nameRu", current.nameRu, nameRu);
      if (nameNative !== "") compare("name_native", "nameNative", current.nameNative, nameNative);
      if (list === "dlcs" && steamAppId !== undefined)
        compare("steam_app_id", "steamAppId", current.steamAppId, steamAppId);
      if (list !== "dlcs" && dlcId !== undefined)
        compare("dlc_code", "dlcId", current.dlcId, dlcId);
      if (list === "cities" && regionId !== undefined)
        compare("region_code", "regionId", current.regionId, regionId);
      if (list === "cargoes" && adrClass !== undefined)
        compare("adr_class", "adrClass", current.adrClass, adrClass);
      if (list === "trailers" && typeId !== undefined)
        compare("trailer_type_code", "trailerTypeId", current.trailerTypeId, typeId);
      if (list === "trailers" && commonTrailer !== undefined) {
        if (current.commonTrailer?.toString() !== commonTrailer) {
          set.commonTrailer = Buffer.from(commonTrailer);
          changedFields.push("common_trailer");
        }
      }
      if (changedFields.length) {
        changedCount++;
        updates.push({ id: current.id, set });
        lines.push({
          line: row.line,
          code: reportedCode,
          status: "changed",
          issues: [],
          changedFields,
        });
      } else unchanged++;
    }
    return { inserts, updates, lines, added, changed: changedCount, unchanged, errors };
  }
  /** Depot rows name their company, city and optional DLC by `(game, code)`; nothing is deleted. */
  async function computeDepotImport(tx: TxContext, rows: readonly ImportRow[], lock: boolean) {
    const games = [
      ...new Set(
        rows.flatMap((row) =>
          row.values.game === "ets2" || row.values.game === "ats" ? [row.values.game as Game] : [],
        ),
      ),
    ];
    async function codes(
      table: typeof catalogCompanies | typeof catalogCities | typeof catalogDlcs,
    ) {
      const map = new Map<string, { id: string; hidden: boolean }>();
      for (const game of games) {
        const query = c(tx)
          .select({ id: table.id, code: table.code, hidden: table.hidden })
          .from(table)
          .where(eq(table.game, game))
          .orderBy(asc(table.id));
        const found = await (lock ? query.for("share") : query);
        for (const row of found) map.set(keyOf(game, row.code), row);
      }
      return map;
    }
    const companyCodes = await codes(catalogCompanies),
      cityCodes = await codes(catalogCities),
      dlcCodes = await codes(catalogDlcs);
    const existing = new Map<string, { id: string; dlcId: string | null }>();
    for (const game of games) {
      const query = c(tx)
        .select({
          id: catalogCompanyCities.id,
          companyId: catalogCompanyCities.companyId,
          cityId: catalogCompanyCities.cityId,
          dlcId: catalogCompanyCities.dlcId,
        })
        .from(catalogCompanyCities)
        .where(eq(catalogCompanyCities.game, game))
        .orderBy(asc(catalogCompanyCities.id));
      for (const row of await (lock ? query.for("update") : query))
        existing.set(`${row.companyId}\0${row.cityId}`, row);
    }
    const seen = new Set<string>();
    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; set: Record<string, unknown> }[] = [];
    const lines: S["CatalogImportLine"][] = [];
    let added = 0,
      changedCount = 0,
      unchanged = 0,
      errors = 0;
    for (const row of rows) {
      const v = row.values;
      const issues: S["CatalogImportIssue"][] = [...row.fileIssues];
      const game = v.game === "ets2" || v.game === "ats" ? (v.game as Game) : null;
      if (!game) issues.push({ field: "game", reason: v.game ? "invalid" : "required" });
      const companyCode = v.company_code ?? "",
        cityCode = v.city_code ?? "";
      const companyOk = validCode(companyCode),
        cityOk = validCode(cityCode);
      if (!companyOk)
        issues.push({ field: "company_code", reason: companyCode === "" ? "required" : "invalid" });
      if (!cityOk)
        issues.push({ field: "city_code", reason: cityCode === "" ? "required" : "invalid" });
      const company = game && companyOk ? companyCodes.get(keyOf(game, companyCode)) : undefined;
      const city = game && cityOk ? cityCodes.get(keyOf(game, cityCode)) : undefined;
      if (game && companyOk && !company)
        issues.push({ field: "company_code", reason: "unknown_reference" });
      if (game && cityOk && !city) issues.push({ field: "city_code", reason: "unknown_reference" });
      const current = company && city ? existing.get(`${company.id}\0${city.id}`) : undefined;
      // A hidden company or city stays valid only for a depot that already exists.
      if (company?.hidden && !current)
        issues.push({ field: "company_code", reason: "hidden_reference" });
      if (city?.hidden && !current) issues.push({ field: "city_code", reason: "hidden_reference" });
      let dlcId: string | undefined;
      if (v.dlc_code && game) {
        const found = dlcCodes.get(keyOf(game, v.dlc_code));
        if (!found) issues.push({ field: "dlc_code", reason: "unknown_reference" });
        else if (found.hidden && current?.dlcId !== found.id)
          issues.push({ field: "dlc_code", reason: "hidden_reference" });
        else dlcId = found.id;
      }
      if (game && companyOk && cityOk) {
        const key = `${keyOf(game, companyCode)}\0${Buffer.from(cityCode).toString("hex")}`;
        if (seen.has(key)) issues.push({ field: "city_code", reason: "duplicate_in_file" });
        seen.add(key);
      }
      const reportedCode = companyOk ? companyCode : null;
      if (issues.length || !game || !company || !city) {
        errors++;
        lines.push({
          line: row.line,
          code: reportedCode,
          status: "error",
          issues: issues.slice(0, 16),
          changedFields: [],
        });
        continue;
      }
      if (!current) {
        added++;
        inserts.push({
          id: newId(),
          game,
          companyId: company.id,
          cityId: city.id,
          dlcId: dlcId ?? null,
          hidden: false,
        });
        continue;
      }
      if (dlcId !== undefined && dlcId !== current.dlcId) {
        changedCount++;
        updates.push({ id: current.id, set: { dlcId } });
        lines.push({
          line: row.line,
          code: reportedCode,
          status: "changed",
          issues: [],
          changedFields: ["dlc_code"],
        });
      } else unchanged++;
    }
    return { inserts, updates, lines, added, changed: changedCount, unchanged, errors };
  }
  const previewLines = (lines: S["CatalogImportLine"][]) => {
    const sorted = [
      ...lines.filter((l) => l.status === "error"),
      ...lines.filter((l) => l.status !== "error"),
    ].sort((a, b) => a.line - b.line);
    return {
      lines: sorted.slice(0, CATALOG_PREVIEW_MAX_LINES),
      truncated: sorted.length > CATALOG_PREVIEW_MAX_LINES,
    };
  };
  const tokenBinding = (list: ImportList, fileHash: string, actor: Actor) =>
    ["catalog-import", list, fileHash, actor.userId] as const;
  const computePlan = (
    tx: TxContext,
    list: ImportList,
    rows: readonly ImportRow[],
    lock: boolean,
  ) =>
    list === "depots" ? computeDepotImport(tx, rows, lock) : computeImport(tx, list, rows, lock);
  function parseFile(list: ImportList, bytes: Buffer) {
    let rows: ImportRow[];
    try {
      rows = readImportFile(list, bytes);
    } catch (error) {
      fileError(error);
      throw error;
    }
    if (!rows.length) throw catalogError(422, "CATALOG_FILE_INVALID");
    return rows;
  }

  // ---- Depots: a company that operates in a city ----
  const depotColumns = {
    id: catalogCompanyCities.id,
    game: catalogCompanyCities.game,
    hidden: catalogCompanyCities.hidden,
    updatedAt: catalogCompanyCities.updatedAt,
    dlcId: catalogCompanyCities.dlcId,
    dlcEn: dlcParent.nameEn,
    dlcHidden: dlcParent.hidden,
    companyId: catalogCompanies.id,
    companyCode: catalogCompanies.code,
    companyEn: catalogCompanies.nameEn,
    companyHidden: catalogCompanies.hidden,
    logoSha: catalogCompanyLogos.sha256,
    logoBytes: catalogCompanyLogos.byteLength,
    cityId: catalogCities.id,
    cityCode: catalogCities.code,
    cityEn: catalogCities.nameEn,
    cityRu: catalogCities.nameRu,
    cityNative: catalogCities.nameNative,
    cityHidden: catalogCities.hidden,
  };
  async function fetchDepots(
    tx: TxContext,
    where: ReturnType<typeof and>,
    options: { limit?: number; order?: SQL } = {},
  ) {
    let query = c(tx)
      .select(depotColumns)
      .from(catalogCompanyCities)
      .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
      .innerJoin(catalogCities, eq(catalogCompanyCities.cityId, catalogCities.id))
      .leftJoin(dlcParent, eq(catalogCompanyCities.dlcId, dlcParent.id))
      .leftJoin(catalogCompanyLogos, eq(catalogCompanyLogos.companyId, catalogCompanies.id))
      .where(where)
      .$dynamic();
    if (options.order) query = query.orderBy(asc(options.order), asc(catalogCompanyCities.id));
    if (options.limit !== undefined) query = query.limit(options.limit);
    return query;
  }
  type DepotRow = Awaited<ReturnType<typeof fetchDepots>>[number];
  function depotDto(row: DepotRow, locale: Locale): S["CatalogDepot"] {
    return {
      id: row.id,
      game: row.game,
      hidden: row.hidden,
      updatedAt: row.updatedAt,
      dlcId: row.dlcId,
      dlc:
        row.dlcId && row.dlcEn !== null
          ? canonicalLabel(row.dlcId, row.dlcEn, row.dlcHidden === true, locale)
          : null,
      company: {
        id: row.companyId,
        code: row.companyCode.toString(),
        label: canonicalLabel(row.companyId, row.companyEn, row.companyHidden, locale),
        logo: logoOf(row.logoSha, row.logoBytes),
      },
      city: {
        id: row.cityId,
        code: row.cityCode.toString(),
        label: label(row.cityId, row.cityEn, row.cityRu, row.cityHidden, locale, row.cityNative),
      },
    };
  }
  async function depotById(tx: TxContext, id: string, locale: Locale) {
    const [row] = await fetchDepots(tx, eq(catalogCompanyCities.id, id));
    if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
    return depotDto(row, locale);
  }
  /** A company or city a new depot may name: same game and not hidden. */
  async function depotParent(
    tx: TxContext,
    table: typeof catalogCompanies | typeof catalogCities,
    game: Game,
    id: string,
  ) {
    const [row] = await c(tx)
      .select({ id: table.id, game: table.game, hidden: table.hidden })
      .from(table)
      .where(and(eq(table.id, applicationId(id)), eq(table.game, game)))
      .for("share");
    if (!row || row.hidden) throw catalogError(422, "CATALOG_PARENT_INVALID");
    return row;
  }

  // ---- Company logos ----
  const sha256Of = (bytes: Buffer) => createHash("sha256").update(bytes).digest();
  const logoReason = (error: unknown) => (error instanceof PngError ? error.reason : "corrupt");
  async function lockCompany(tx: TxContext, id: string) {
    const [row] = await c(tx)
      .select({ id: catalogCompanies.id, game: catalogCompanies.game })
      .from(catalogCompanies)
      .where(eq(catalogCompanies.id, applicationId(id)))
      .for("update");
    if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
    return row;
  }
  /** The company row is already locked, which serializes writers of its logo. */
  async function saveLogo(tx: TxContext, companyId: string, bytes: Buffer) {
    const digest = sha256Of(bytes);
    const [current] = await c(tx)
      .select({ sha: catalogCompanyLogos.sha256 })
      .from(catalogCompanyLogos)
      .where(eq(catalogCompanyLogos.companyId, companyId));
    if (current && Buffer.from(current.sha).equals(digest)) return;
    const values = {
      png: bytes,
      byteLength: bytes.length,
      sha256: digest,
      updatedAt: now().toISOString(),
    };
    if (!current)
      await c(tx)
        .insert(catalogCompanyLogos)
        .values({ companyId, ...values });
    else
      await c(tx)
        .update(catalogCompanyLogos)
        .set(values)
        .where(eq(catalogCompanyLogos.companyId, companyId));
  }
  /** The manifest a dry-run token binds: sorted (file name, content hash) pairs. */
  const manifestOf = (files: readonly LogoFile[]) =>
    createHash("sha256")
      .update(
        ordered(
          files
            .map((file) => [file.name, sha256Of(file.bytes).toString("hex")])
            .sort((a, b) => (`${a[0]}\0${a[1]}` < `${b[0]}\0${b[1]}` ? -1 : 1)),
        ),
      )
      .digest("hex");
  async function computeLogos(
    tx: TxContext,
    game: Game,
    files: readonly LogoFile[],
    lock: boolean,
  ) {
    const prepared = files.map((file, index) => {
      const issues: S["CatalogImportIssue"][] = [];
      const code = logoCodeFromName(file.name);
      if (code === null) issues.push({ field: "file", reason: "bad_name" });
      if (file.truncated) issues.push({ field: "file", reason: "too_large" });
      else {
        try {
          inspectPng(file.bytes);
        } catch (error) {
          issues.push({ field: "file", reason: logoReason(error) });
        }
      }
      return { line: index + 1, code, issues, bytes: file.bytes };
    });
    const wanted = [
      ...new Set(prepared.flatMap((file) => (file.code === null ? [] : [file.code]))),
    ];
    const companies = new Map<string, string>();
    for (let i = 0; i < wanted.length; i += 200) {
      const query = c(tx)
        .select({ id: catalogCompanies.id, code: catalogCompanies.code })
        .from(catalogCompanies)
        .where(
          and(
            eq(catalogCompanies.game, game),
            inArray(
              catalogCompanies.code,
              wanted.slice(i, i + 200).map((code) => Buffer.from(code)),
            ),
          ),
        )
        .orderBy(asc(catalogCompanies.id));
      for (const row of await (lock ? query.for("update") : query))
        companies.set(row.code.toString(), row.id);
    }
    const stored = new Map<string, Buffer>();
    const ids = [...companies.values()];
    for (let i = 0; i < ids.length; i += 200)
      for (const row of await c(tx)
        .select({ id: catalogCompanyLogos.companyId, sha: catalogCompanyLogos.sha256 })
        .from(catalogCompanyLogos)
        .where(inArray(catalogCompanyLogos.companyId, ids.slice(i, i + 200))))
        stored.set(row.id, Buffer.from(row.sha));
    const seen = new Set<string>();
    const writes: { companyId: string; bytes: Buffer }[] = [];
    const lines: S["CatalogImportLine"][] = [];
    let added = 0,
      changed = 0,
      unchanged = 0,
      errors = 0;
    for (const file of prepared) {
      const issues = [...file.issues];
      const companyId = file.code === null ? undefined : companies.get(file.code);
      if (file.code !== null) {
        if (!companyId) issues.push({ field: "code", reason: "unknown_reference" });
        if (seen.has(file.code)) issues.push({ field: "file", reason: "duplicate_in_file" });
        seen.add(file.code);
      }
      if (issues.length || !companyId) {
        errors++;
        lines.push({
          line: file.line,
          code: file.code,
          status: "error",
          issues: issues.slice(0, 16),
          changedFields: [],
        });
        continue;
      }
      const before = stored.get(companyId);
      if (before?.equals(sha256Of(file.bytes))) {
        unchanged++;
        continue;
      }
      writes.push({ companyId, bytes: file.bytes });
      if (before) {
        changed++;
        lines.push({
          line: file.line,
          code: file.code,
          status: "changed",
          issues: [],
          changedFields: ["logo"],
        });
      } else added++;
    }
    return { writes, lines, added, changed, unchanged, errors };
  }
  const logoTokenBinding = (game: Game, manifest: string, actor: Actor) =>
    ["catalog-logos", game, manifest, actor.userId] as const;

  return {
    config,
    async companionTrailerDisplayInTransaction(
      tx: TxContext,
      game: Game,
      ids: readonly string[],
      asOf: string,
    ) {
      if (ids.length > 110) throw new Error("COMPANION_TRAILER_BOUND");
      const unique = [...new Set(ids)].sort();
      if (!unique.length) return [];
      const variants = await c(tx)
        .select({
          id: catalogTrailers.id,
          code: catalogTrailers.code,
          group: catalogTrailers.commonTrailer,
          nameEn: catalogTrailers.nameEn,
          nameRu: catalogTrailers.nameRu,
          typeId: catalogTrailers.trailerTypeId,
        })
        .from(catalogTrailers)
        .where(and(eq(catalogTrailers.game, game), inArray(catalogTrailers.id, unique)))
        .orderBy(catalogTrailers.id)
        .for("share");
      const types = await c(tx)
        .select({
          id: catalogTrailerTypes.id,
          code: catalogTrailerTypes.code,
          nameEn: catalogTrailerTypes.nameEn,
          nameRu: catalogTrailerTypes.nameRu,
        })
        .from(catalogTrailerTypes)
        .where(and(eq(catalogTrailerTypes.game, game), inArray(catalogTrailerTypes.id, unique)))
        .orderBy(catalogTrailerTypes.id)
        .for("share");
      const byVariant = new Map(variants.map((row) => [row.id, row])),
        byType = new Map(types.map((row) => [row.id, row]));
      return unique.map((id) => {
        const variant = byVariant.get(id),
          type = byType.get(id);
        const row = variant && type ? undefined : (variant ?? type);
        const identityKind = !row
          ? ("unavailable" as const)
          : type
            ? ("type" as const)
            : ("variant" as const);
        return {
          id,
          identityKind,
          code: row?.code.toString() ?? null,
          groupCode: identityKind === "variant" ? (variant?.group?.toString() ?? null) : null,
          nameEn: row?.nameEn ?? null,
          nameRu: row?.nameRu ?? null,
          classification:
            identityKind === "variant"
              ? variant?.typeId
                ? { state: "classified" as const, typeId: variant.typeId }
                : { state: "unclassified" as const }
              : {
                  state:
                    identityKind === "type"
                      ? ("not_applicable" as const)
                      : ("unavailable" as const),
                },
          basis: "current_catalog" as const,
          asOf,
        };
      });
    },
    async trailerTypes(
      actor: Actor,
      query: { game: Game; locale?: Locale; search?: string; limit?: number; cursor?: string },
    ) {
      return run(async (tx): Promise<S["CatalogItemList"]> => {
        await authority(tx, actor, false);
        const locale = query.locale ?? "en",
          limit = query.limit ?? 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        const binding = [
          actor.userId,
          actor.sessionId,
          actor.accessEpoch,
          "trailer-types",
          query.game,
          locale,
          query.search ?? null,
        ];
        let after = 0;
        if (query.cursor) {
          try {
            after = Number(codec.read(binding, query.cursor));
            if (!Number.isInteger(after) || after < 0 || after > 1000) throw new Error();
          } catch {
            throw identityError(409, "VERSION_CONFLICT");
          }
        }
        const rows = await c(tx)
          .select()
          .from(catalogTrailerTypes)
          .where(eq(catalogTrailerTypes.game, query.game))
          .orderBy(asc(catalogTrailerTypes.code))
          .limit(1000);
        const matching = rows
          .map((row) => ({
            id: row.id,
            game: row.game,
            code: row.code.toString(),
            nameEn: row.nameEn,
            nameRu: row.nameRu,
            hidden: false,
            dlcId: null,
            dlc: null,
            display: label(row.id, row.nameEn, row.nameRu, false, locale),
          }))
          .filter(
            (row) =>
              !query.search ||
              `${row.code} ${row.nameEn} ${row.nameRu}`
                .toLocaleLowerCase()
                .includes(query.search.toLocaleLowerCase()),
          );
        return {
          items: matching.slice(after, after + limit),
          total: matching.length,
          nextCursor:
            after + limit < matching.length ? codec.write(binding, String(after + limit)) : null,
        };
      });
    },
    async trailerType(actor: Actor, id: string, locale: Locale = "en") {
      return run(async (tx): Promise<S["CatalogItem"]> => {
        await authority(tx, actor, false);
        return (
          (await trailerTypeItem(tx, id, locale)) ??
          itemById(tx, "trailers", applicationId(id), locale)
        );
      });
    },
    /** Group membership for qualification comparison. IDs/facts remain unchanged, including hidden rows. */
    async trailerGroupsInTransaction(
      tx: TxContext,
      game: Game,
      ids: readonly string[],
      basis: "variant" | "type" = "variant",
    ) {
      if (ids.length > 1010) throw new Error("CATALOG_TRAILER_BATCH_BOUND_EXCEEDED");
      const result: Record<string, string> = {};
      if (!ids.length) return result;
      const rows = await c(tx)
        .select({
          id: catalogTrailers.id,
          commonTrailer: catalogTrailers.commonTrailer,
          trailerTypeId: catalogTrailers.trailerTypeId,
        })
        .from(catalogTrailers)
        .where(
          and(
            eq(catalogTrailers.game, game),
            inArray(catalogTrailers.id, [...new Set(ids)].map(applicationId)),
          ),
        )
        // Decision preparation may already have an older RR snapshot from ownership discovery.
        .orderBy(asc(catalogTrailers.id))
        .for("share");
      for (const row of rows)
        if (basis === "type")
          result[row.id] = row.trailerTypeId ? `type:${row.trailerTypeId}` : "undefined";
        else if (row.commonTrailer !== null)
          result[row.id] = `common:${game}:${row.commonTrailer.toString("hex")}`;
      if (basis === "type") {
        const types = await c(tx)
          .select({ id: catalogTrailerTypes.id })
          .from(catalogTrailerTypes)
          .where(
            and(
              eq(catalogTrailerTypes.game, game),
              inArray(catalogTrailerTypes.id, [...new Set(ids)].map(applicationId)),
            ),
          )
          .orderBy(asc(catalogTrailerTypes.id))
          .for("share");
        for (const row of types) result[row.id] = `type:${row.id}`;
      }
      return result;
    },
    async authorize(actor: Actor, admin = true) {
      return run((tx) => authority(tx, actor, admin));
    },
    async summary(actor: Actor, game: Game): Promise<S["CatalogSummary"]> {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const lists = {} as S["CatalogSummary"]["lists"];
        for (const list of Object.keys(tables) as CatalogList[]) {
          const t = common(list);
          const visible = eq(t.hidden, false);
          const totals = c(tx)
            .select({
              visible: countMatching(visible),
              hidden: countMatching(eq(t.hidden, true)),
              // A canonical list has no translation to miss.
              ...(isCanonicalList(list)
                ? {}
                : { untranslated: countMatching(and(visible, isNull(t.nameRu))) }),
              ...(list === "companies"
                ? { missingLogo: countMatching(and(visible, companyMissingLogo)) }
                : {}),
            })
            .from(t)
            .where(eq(t.game, game))
            .$dynamic();
          if (list === "companies") totals.leftJoin(catalogCompanyLogos, companyLogoLink);
          const [counts] = await totals;
          if (!counts) throw new Error("CATALOG_SUMMARY_COUNT_MISSING");
          lists[list] = counts;
        }
        const [depots] = await c(tx)
          .select({
            visible: countMatching(eq(catalogCompanyCities.hidden, false)),
            hidden: countMatching(eq(catalogCompanyCities.hidden, true)),
          })
          .from(catalogCompanyCities)
          .where(eq(catalogCompanyCities.game, game));
        if (!depots) throw new Error("CATALOG_SUMMARY_COUNT_MISSING");
        lists.depots = depots;
        return { game, lists };
      });
    },
    async list(
      actor: Actor,
      list: CatalogList,
      query: ListFilters & {
        game: Game;
        search?: string;
        dlc?: string;
        regionId?: string;
        locale?: Locale;
        limit?: number;
        cursor?: string;
      },
    ): Promise<S["CatalogItemList"]> {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const limit = query.limit ?? 25,
          locale = query.locale ?? "en";
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        if (list === "dlcs" && query.dlc) throw identityError(422);
        if (list !== "cities" && query.regionId) throw identityError(422);
        if (list !== "companies" && query.logo) throw identityError(422);
        if (list !== "trailers" && query.trailerTypeId) throw identityError(422);
        if (isCanonicalList(list) && query.untranslated) throw identityError(422);
        const includeHidden = query.hidden !== "only" && (query.includeHidden ?? false);
        const t = common(list),
          binding = [
            actor.userId,
            actor.sessionId,
            actor.accessEpoch,
            list,
            query.game,
            query.search ?? null,
            includeHidden,
            query.dlc ?? null,
            query.regionId ?? null,
            locale,
            ...maintenanceBinding(query),
            ...canonicalOrderBinding(isCanonicalList(list)),
            ...(list === "trailers" ? ["trailer-variants-v2", query.trailerTypeId ?? null] : []),
          ];
        let after: [string, string] | null = null;
        if (query.cursor) {
          try {
            after = JSON.parse(codec.read(binding, query.cursor));
          } catch {
            throw identityError(409, "VERSION_CONFLICT");
          }
        }
        const canonical = isCanonicalList(list);
        const display = displayName(list, locale);
        const escaped = query.search?.replace(/[\\%_]/g, (v) => `\\${v}`);
        const filter = and(
          eq(t.game, query.game),
          list === "trailers" && query.trailerTypeId
            ? query.trailerTypeId === "undefined"
              ? isNull(catalogTrailers.trailerTypeId)
              : eq(catalogTrailers.trailerTypeId, applicationId(query.trailerTypeId))
            : undefined,
          includeHidden ? undefined : eq(t.hidden, query.hidden === "only"),
          query.untranslated ? isNull(t.nameRu) : undefined,
          query.logo === "missing" ? companyMissingLogo : undefined,
          escaped
            ? or(
                sql`${t.nameEn} LIKE ${`%${escaped}%`}`,
                canonical ? undefined : sql`${t.nameRu} LIKE ${`%${escaped}%`}`,
                list === "cities"
                  ? sql`${catalogCities.nameNative} LIKE ${`%${escaped}%`}`
                  : undefined,
                sql`CONVERT(${t.code} USING utf8mb4) LIKE ${`%${escaped}%`}`,
              )
            : undefined,
          list !== "dlcs" && query.dlc === "base" ? sql`${t.dlcId} IS NULL` : undefined,
          list !== "dlcs" && query.dlc && query.dlc !== "base"
            ? eq(t.dlcId, applicationId(query.dlc))
            : undefined,
          list === "cities" && query.regionId
            ? eq(catalogCities.regionId, applicationId(query.regionId))
            : undefined,
        );
        const totals = c(tx)
          .select({ count: sql<number | string>`COUNT(*)` })
          .from(t)
          .where(filter)
          .$dynamic();
        if (query.logo === "missing") totals.leftJoin(catalogCompanyLogos, companyLogoLink);
        const [total] = await totals;
        const page = await fetchRows(
          tx,
          list,
          and(
            filter,
            after
              ? or(
                  sql`${display} > ${after[0]}`,
                  and(sql`${display} = ${after[0]}`, gt(t.id, after[1])),
                )
              : undefined,
          ),
          limit + 1,
          true,
          locale,
        );
        const visible = page.slice(0, limit);
        const counts =
          list === "companies"
            ? await companyDepotCounts(
                tx,
                query.game,
                visible.map((row) => row.id),
              )
            : undefined;
        const last = visible[visible.length - 1];
        return {
          items: visible.map((row) => itemDto(list, row, locale, counts?.get(row.id))),
          total: Number(total?.count ?? 0),
          nextCursor:
            page.length > limit && last
              ? codec.write(
                  binding,
                  JSON.stringify([
                    locale === "ru" && !canonical && last.nameRu !== null
                      ? last.nameRu
                      : last.nameEn,
                    last.id,
                  ]),
                )
              : null,
        };
      });
    },
    async get(actor: Actor, list: CatalogList, id: string, locale: Locale = "en") {
      return run(async (tx) => {
        await authority(tx, actor, false);
        return itemById(tx, list, applicationId(id), locale);
      });
    },
    async create(
      actor: Actor,
      list: CatalogList,
      key: string,
      input: Record<string, unknown> & { game: Game },
    ): Promise<S["CatalogItem"]> {
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:create:${list}`,
          key,
          { list, input },
          async () => {
            const id = newId();
            const fields = fieldsOf(list, input);
            if (list === "trailers") await trailerType(tx, input.game, input.trailerTypeId);
            if (list !== "dlcs" && "dlcId" in input)
              await parent(tx, "dlc", input.game, input.dlcId as string | null);
            if (list === "cities" && "regionId" in input)
              await parent(tx, "region", input.game, input.regionId as string | null);
            try {
              await c(tx)
                .insert(tables[list] as Common)
                .values({
                  id,
                  game: input.game,
                  nameRu: null,
                  ...fields,
                  hidden: false,
                  updatedAt: now().toISOString(),
                } as never);
            } catch (error) {
              if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
              throw error;
            }
            await recordAudit(tx, actor, "catalog.changed", id, list, [input.game]);
            return { item: await itemById(tx, list, id, "en") };
          },
        );
        return saved.item as S["CatalogItem"];
      });
    },
    async patch(
      actor: Actor,
      list: CatalogList,
      id: string,
      key: string,
      input: S["CatalogItemPatch"],
    ): Promise<S["CatalogItem"]> {
      assertPatchShape(list, input);
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:patch:${list}:${applicationId(id)}`,
          key,
          { list, id, input },
          async () => {
            const t = common(list);
            const [row] = await c(tx)
              .select({
                id: t.id,
                game: t.game,
                code: t.code,
                ...(list === "trailers"
                  ? {
                      commonTrailer: catalogTrailers.commonTrailer,
                      trailerTypeId: catalogTrailers.trailerTypeId,
                    }
                  : {}),
                nameEn: t.nameEn,
                nameRu: t.nameRu,
                hidden: t.hidden,
                ...(list !== "dlcs" ? { dlcId: t.dlcId } : {}),
                ...(list === "dlcs" ? { steamAppId: catalogDlcs.steamAppId } : {}),
                ...(list === "cities"
                  ? { regionId: catalogCities.regionId, nameNative: catalogCities.nameNative }
                  : {}),
                ...(list === "cargoes" ? { adrClass: catalogCargoes.adrClass } : {}),
              })
              .from(t)
              .where(eq(t.id, id))
              .for("update");
            if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
            if (list !== "dlcs" && "dlcId" in input)
              await parent(tx, "dlc", row.game, input.dlcId, row.dlcId ?? null);
            if (list === "cities" && "regionId" in input)
              await parent(tx, "region", row.game, input.regionId, row.regionId ?? null);
            const fields = fieldsOf(list, input);
            if (list === "trailers") await trailerType(tx, row.game, input.trailerTypeId);
            if (changesFields(row, fields)) {
              try {
                await c(tx)
                  .update(t)
                  .set({ ...fields, updatedAt: now().toISOString() })
                  .where(eq(t.id, row.id));
              } catch (error) {
                if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
                throw error;
              }
            }
            await recordAudit(tx, actor, "catalog.changed", row.id, list, [row.game]);
            return { item: await itemById(tx, list, row.id, "en") };
          },
        );
        return saved.item as S["CatalogItem"];
      });
    },
    async previewImport(actor: Actor, list: ImportList, bytes: Buffer) {
      const fileSha256 = sha(bytes);
      const rows = parseFile(list, bytes);
      return run(async (tx): Promise<S["CatalogImportPreview"]> => {
        await authority(tx, actor, true);
        const plan = await computePlan(tx, list, rows, false);
        const { lines, truncated } = previewLines(plan.lines);
        return {
          fileSha256,
          token: plan.errors
            ? null
            : codec.write(
                tokenBinding(list, fileSha256, actor),
                new Date(now().getTime() + CATALOG_IMPORT_TOKEN_TTL_MS).toISOString(),
              ),
          rows: rows.length,
          added: plan.added,
          changed: plan.changed,
          unchanged: plan.unchanged,
          errors: plan.errors,
          lines,
          truncated,
        };
      });
    },
    async applyImport(
      actor: Actor,
      list: ImportList,
      bytes: Buffer,
      key: string,
      token: string,
    ): Promise<S["CatalogImportResult"]> {
      const fileSha256 = sha(bytes);
      return run(async (tx) => {
        await authority(tx, actor, true);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:import:${list}`,
          key,
          { sha256: fileSha256 },
          async () => {
            // Runs only on a first attempt: a retry with an expired token gets the stored result.
            let expiresAt: string;
            try {
              expiresAt = codec.read(tokenBinding(list, fileSha256, actor), token);
            } catch {
              throw catalogError(412, "CATALOG_IMPORT_TOKEN_INVALID");
            }
            if (!(new Date(expiresAt).getTime() > now().getTime()))
              throw catalogError(412, "CATALOG_IMPORT_TOKEN_INVALID");
            const rows = parseFile(list, bytes);
            const plan = await computePlan(tx, list, rows, true);
            if (plan.errors)
              throw importInvalid(plan.lines.filter((line) => line.status === "error"));
            const table = (list === "depots" ? catalogCompanyCities : tables[list]) as Common;
            const updatedAt = now().toISOString();
            for (let i = 0; i < plan.inserts.length; i += 200) {
              try {
                await c(tx)
                  .insert(table)
                  .values(
                    plan.inserts.slice(i, i + 200).map((row) => ({ ...row, updatedAt })) as never[],
                  );
              } catch (error) {
                if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
                throw error;
              }
            }
            for (const update of plan.updates)
              await c(tx)
                .update(table)
                .set({ ...update.set, updatedAt })
                .where(eq(table.id, update.id));
            const importId = newId();
            // The transaction validated every file row, including unchanged rows.
            const games = [...new Set(rows.map((row) => row.values.game as Game))];
            await recordAudit(tx, actor, "catalog.imported", importId, list, games);
            return {
              importId,
              rows: rows.length,
              added: plan.added,
              changed: plan.changed,
              unchanged: plan.unchanged,
            };
          },
        );
        return result as unknown as S["CatalogImportResult"];
      });
    },
    async listDepots(
      actor: Actor,
      query: Omit<ListFilters, "logo" | "untranslated"> & {
        game: Game;
        companyId?: string;
        cityId?: string;
        depotId?: string;
        search?: string;
        dlc?: string;
        locale?: Locale;
        limit?: number;
        cursor?: string;
      },
    ): Promise<S["CatalogDepotList"]> {
      return run(async (tx) => {
        await authority(tx, actor, false);
        if (query.depotId !== undefined && query.cityId === undefined) throw identityError(422);
        const depotId = query.depotId === undefined ? undefined : applicationId(query.depotId);
        const limit = query.limit ?? 25,
          locale = query.locale ?? "en";
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        const includeHidden = query.hidden !== "only" && (query.includeHidden ?? false);
        const binding = [
          actor.userId,
          actor.sessionId,
          actor.accessEpoch,
          "depots",
          query.game,
          query.companyId ?? null,
          query.cityId ?? null,
          query.search ?? null,
          query.dlc ?? null,
          includeHidden,
          locale,
          ...maintenanceBinding(query),
          // Cities of one company still read by their localized name.
          ...canonicalOrderBinding(query.companyId === undefined),
          ...(depotId === undefined ? [] : [depotId]),
        ];
        let after: [string, string] | null = null;
        if (query.cursor) {
          try {
            after = JSON.parse(codec.read(binding, query.cursor));
          } catch {
            throw identityError(409, "VERSION_CONFLICT");
          }
        }
        // Cities of one company read by their localized name; every other view reads by the
        // company's canonical name.
        const byCity = query.companyId !== undefined;
        const display =
          byCity && locale === "ru"
            ? sql`COALESCE(${catalogCities.nameRu}, ${catalogCities.nameEn})`
            : byCity
              ? sql`${catalogCities.nameEn}`
              : sql`${catalogCompanies.nameEn}`;
        const escaped = query.search?.replace(/[\\%_]/g, (v) => `\\${v}`);
        const like = `%${escaped}%`;
        // In one city a search picks a company; for one company it picks a city.
        const companyMatch = [
          sql`${catalogCompanies.nameEn} LIKE ${like}`,
          sql`CONVERT(${catalogCompanies.code} USING utf8mb4) LIKE ${like}`,
        ];
        const cityMatch = [
          sql`${catalogCities.nameEn} LIKE ${like}`,
          sql`${catalogCities.nameRu} LIKE ${like}`,
          sql`${catalogCities.nameNative} LIKE ${like}`,
          sql`CONVERT(${catalogCities.code} USING utf8mb4) LIKE ${like}`,
        ];
        const searched =
          query.cityId !== undefined && !byCity
            ? companyMatch
            : byCity && query.cityId === undefined
              ? cityMatch
              : [...companyMatch, ...cityMatch];
        const filter = and(
          eq(catalogCompanyCities.game, query.game),
          depotId === undefined ? undefined : eq(catalogCompanyCities.id, depotId),
          query.hidden === "only"
            ? eq(catalogCompanyCities.hidden, true)
            : includeHidden
              ? undefined
              : depotVisible,
          query.companyId
            ? eq(catalogCompanyCities.companyId, applicationId(query.companyId))
            : undefined,
          query.cityId ? eq(catalogCompanyCities.cityId, applicationId(query.cityId)) : undefined,
          query.dlc === "base" ? sql`${catalogCompanyCities.dlcId} IS NULL` : undefined,
          query.dlc && query.dlc !== "base"
            ? eq(catalogCompanyCities.dlcId, applicationId(query.dlc))
            : undefined,
          escaped ? or(...searched) : undefined,
        );
        const [total] = await c(tx)
          .select({ count: sql<number | string>`COUNT(*)` })
          .from(catalogCompanyCities)
          .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
          .innerJoin(catalogCities, eq(catalogCompanyCities.cityId, catalogCities.id))
          .where(filter);
        const page = await fetchDepots(
          tx,
          and(
            filter,
            after
              ? or(
                  sql`${display} > ${after[0]}`,
                  and(sql`${display} = ${after[0]}`, gt(catalogCompanyCities.id, after[1])),
                )
              : undefined,
          ),
          { limit: limit + 1, order: display },
        );
        const visible = page.slice(0, limit);
        const last = visible[visible.length - 1];
        const lastName = last
          ? byCity
            ? locale === "ru" && last.cityRu !== null
              ? last.cityRu
              : last.cityEn
            : last.companyEn
          : null;
        return {
          items: visible.map((row) => depotDto(row, locale)),
          total: Number(total?.count ?? 0),
          nextCursor:
            page.length > limit && last && lastName !== null
              ? codec.write(binding, JSON.stringify([lastName, last.id]))
              : null,
        };
      });
    },
    async createDepot(
      actor: Actor,
      key: string,
      input: S["CatalogDepotInput"],
    ): Promise<S["CatalogDepot"]> {
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:create:depots`,
          key,
          { input },
          async () => {
            const company = await depotParent(tx, catalogCompanies, input.game, input.companyId);
            await depotParent(tx, catalogCities, company.game, input.cityId);
            await parent(tx, "dlc", input.game, input.dlcId ?? null);
            const id = newId();
            try {
              await c(tx)
                .insert(catalogCompanyCities)
                .values({
                  id,
                  game: input.game,
                  companyId: input.companyId,
                  cityId: input.cityId,
                  dlcId: input.dlcId ?? null,
                  hidden: false,
                  updatedAt: now().toISOString(),
                });
            } catch (error) {
              if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
              throw error;
            }
            await recordAudit(tx, actor, "catalog.changed", id, "depots", [company.game]);
            return { item: await depotById(tx, id, "en") };
          },
        );
        return saved.item as S["CatalogDepot"];
      });
    },
    async patchDepot(
      actor: Actor,
      id: string,
      key: string,
      input: S["CatalogDepotPatch"],
    ): Promise<S["CatalogDepot"]> {
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:patch:depots:${applicationId(id)}`,
          key,
          { id, input },
          async () => {
            const [row] = await c(tx)
              .select({
                id: catalogCompanyCities.id,
                game: catalogCompanyCities.game,
                dlcId: catalogCompanyCities.dlcId,
                hidden: catalogCompanyCities.hidden,
              })
              .from(catalogCompanyCities)
              .where(eq(catalogCompanyCities.id, id))
              .for("update");
            if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
            if ("dlcId" in input) await parent(tx, "dlc", row.game, input.dlcId, row.dlcId);
            const fields = {
              ...("dlcId" in input ? { dlcId: input.dlcId ?? null } : {}),
              ...("hidden" in input ? { hidden: input.hidden } : {}),
            };
            if (changesFields(row, fields))
              await c(tx)
                .update(catalogCompanyCities)
                .set({ ...fields, updatedAt: now().toISOString() })
                .where(eq(catalogCompanyCities.id, row.id));
            await recordAudit(tx, actor, "catalog.changed", row.id, "depots", [row.game]);
            return { item: await depotById(tx, row.id, "en") };
          },
        );
        return saved.item as S["CatalogDepot"];
      });
    },
    /** Stores one validated PNG for a company, replacing the current one. */
    async setLogo(
      actor: Actor,
      companyId: string,
      key: string,
      bytes: Buffer,
    ): Promise<S["CatalogItem"]> {
      try {
        inspectPng(bytes);
      } catch (error) {
        if (error instanceof PngError && error.reason === "too_large")
          throw catalogError(413, "CATALOG_FILE_TOO_LARGE");
        throw catalogError(422, "CATALOG_FILE_INVALID");
      }
      const digest = sha256Of(bytes).toString("hex");
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:logo:set:${applicationId(companyId)}`,
          key,
          { companyId, sha256: digest },
          async () => {
            const { id, game } = await lockCompany(tx, companyId);
            await saveLogo(tx, id, bytes);
            await recordAudit(tx, actor, "catalog.changed", id, "company_logos", [game]);
            return { item: await itemById(tx, "companies", id, "en") };
          },
        );
        return saved.item as S["CatalogItem"];
      });
    },
    /** Removing a logo that is not there changes nothing and writes no audit entry. */
    async removeLogo(actor: Actor, companyId: string, key: string): Promise<S["CatalogItem"]> {
      return run(async (tx) => {
        await authority(tx, actor, true);
        const saved = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:logo:remove:${applicationId(companyId)}`,
          key,
          { companyId },
          async () => {
            const { id, game } = await lockCompany(tx, companyId);
            const [current] = await c(tx)
              .select({ sha: catalogCompanyLogos.sha256 })
              .from(catalogCompanyLogos)
              .where(eq(catalogCompanyLogos.companyId, id));
            if (current) {
              await c(tx).delete(catalogCompanyLogos).where(eq(catalogCompanyLogos.companyId, id));
              await recordAudit(tx, actor, "catalog.changed", id, "company_logos", [game]);
            }
            return { item: await itemById(tx, "companies", id, "en") };
          },
        );
        return saved.item as S["CatalogItem"];
      });
    },
    /** The image for `company.read` holders. `matches` lets the caller skip the bytes on a 304. */
    async readLogo(actor: Actor, companyId: string, matches: (etag: string) => boolean) {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const [meta] = await c(tx)
          .select({ sha: catalogCompanyLogos.sha256, length: catalogCompanyLogos.byteLength })
          .from(catalogCompanyLogos)
          .where(eq(catalogCompanyLogos.companyId, applicationId(companyId)));
        if (!meta) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
        const etag = Buffer.from(meta.sha).toString("hex");
        if (matches(etag)) return { etag, version: etag.slice(0, 16), png: null };
        const [row] = await c(tx)
          .select({ png: catalogCompanyLogos.png })
          .from(catalogCompanyLogos)
          .where(eq(catalogCompanyLogos.companyId, applicationId(companyId)));
        if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
        return { etag, version: etag.slice(0, 16), png: Buffer.from(row.png) };
      });
    },
    async previewLogos(
      actor: Actor,
      game: Game,
      files: readonly LogoFile[],
    ): Promise<S["CatalogImportPreview"]> {
      if (!files.length || files.length > CATALOG_LOGO_BULK_MAX_FILES)
        throw catalogError(422, "CATALOG_FILE_INVALID");
      const manifest = manifestOf(files);
      return run(async (tx) => {
        await authority(tx, actor, true);
        const plan = await computeLogos(tx, game, files, false);
        const { lines, truncated } = previewLines(plan.lines);
        return {
          fileSha256: manifest,
          token: plan.errors
            ? null
            : codec.write(
                logoTokenBinding(game, manifest, actor),
                new Date(now().getTime() + CATALOG_IMPORT_TOKEN_TTL_MS).toISOString(),
              ),
          rows: files.length,
          added: plan.added,
          changed: plan.changed,
          unchanged: plan.unchanged,
          errors: plan.errors,
          lines,
          truncated,
        };
      });
    },
    async applyLogos(
      actor: Actor,
      game: Game,
      files: readonly LogoFile[],
      key: string,
      token: string,
    ): Promise<S["CatalogImportResult"]> {
      if (!files.length || files.length > CATALOG_LOGO_BULK_MAX_FILES)
        throw catalogError(422, "CATALOG_FILE_INVALID");
      const manifest = manifestOf(files);
      return run(async (tx) => {
        await authority(tx, actor, true);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:catalog:logos:${game}`,
          key,
          { game, manifest },
          async () => {
            let expiresAt: string;
            try {
              expiresAt = codec.read(logoTokenBinding(game, manifest, actor), token);
            } catch {
              throw catalogError(412, "CATALOG_IMPORT_TOKEN_INVALID");
            }
            if (!(new Date(expiresAt).getTime() > now().getTime()))
              throw catalogError(412, "CATALOG_IMPORT_TOKEN_INVALID");
            // Every file is checked again inside the transaction: all logos are stored or none.
            const plan = await computeLogos(tx, game, files, true);
            if (plan.errors)
              throw importInvalid(plan.lines.filter((line) => line.status === "error"));
            for (const write of plan.writes) await saveLogo(tx, write.companyId, write.bytes);
            const importId = newId();
            // The plan resolves every entry against locked company rows in this game.
            await recordAudit(tx, actor, "catalog.imported", importId, "company_logos", [game]);
            return {
              importId,
              rows: files.length,
              added: plan.added,
              changed: plan.changed,
              unchanged: plan.unchanged,
            };
          },
        );
        return result as unknown as S["CatalogImportResult"];
      });
    },
    /** Frozen ingestion keeps its existing consistent-read resolution. */
    resolveInTransaction: (tx: TxContext, input: CodeResolution) => resolveCode(tx, input, false),
    /** Current preview facts share the company fence and classification's locking-read view. */
    resolveCurrentInTransaction: (tx: TxContext, input: CodeResolution) =>
      resolveCode(tx, input, true),
    selectionsInTransaction,
    /** Published Events need safe canonical route facts without touching company logos. */
    async eventRouteCatalogInTransaction(
      tx: TxContext,
      game: Game,
      selection: {
        cities: readonly (string | null)[];
        depots: readonly (string | null | undefined)[];
        manualDlcs: readonly string[];
      },
    ) {
      const ids = (values: readonly (string | null | undefined)[]) => [
        ...new Set(values.flatMap((id) => (id == null ? [] : [applicationId(id)]))),
      ];
      const cityIds = ids(selection.cities);
      const depotIds = ids(selection.depots);
      const cities = cityIds.length
        ? await c(tx)
            .select({ id: catalogCities.id, dlcId: catalogCities.dlcId })
            .from(catalogCities)
            .where(and(eq(catalogCities.game, game), inArray(catalogCities.id, cityIds)))
            .for("share")
        : [];
      const depots = depotIds.length
        ? await c(tx)
            .select({
              id: catalogCompanyCities.id,
              cityId: catalogCompanyCities.cityId,
              dlcId: catalogCompanyCities.dlcId,
              name: catalogCompanies.nameEn,
              code: catalogCompanies.code,
              depotHidden: catalogCompanyCities.hidden,
              companyHidden: catalogCompanies.hidden,
              cityHidden: catalogCities.hidden,
            })
            .from(catalogCompanyCities)
            .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
            .innerJoin(catalogCities, eq(catalogCompanyCities.cityId, catalogCities.id))
            .where(
              and(eq(catalogCompanyCities.game, game), inArray(catalogCompanyCities.id, depotIds)),
            )
            .for("share")
        : [];
      const dlcIds = ids([
        ...cities.map((row) => row.dlcId),
        ...depots.map((row) => row.dlcId),
        ...selection.manualDlcs,
      ]).sort();
      const dlcs = new Map<string, { id: string; name: string; code: string; hidden: boolean }>();
      // A page can combine the manual DLC sets of many definitions.
      for (let start = 0; start < dlcIds.length; start += 1000) {
        const rows = await c(tx)
          .select({
            id: catalogDlcs.id,
            name: catalogDlcs.nameEn,
            code: catalogDlcs.code,
            hidden: catalogDlcs.hidden,
          })
          .from(catalogDlcs)
          .where(
            and(
              eq(catalogDlcs.game, game),
              inArray(catalogDlcs.id, dlcIds.slice(start, start + 1000)),
            ),
          )
          .for("share");
        for (const row of rows) dlcs.set(row.id, { ...row, code: row.code.toString() });
      }
      return {
        depots: new Map(
          depots.map((row) => [
            row.id,
            {
              id: row.id,
              cityId: row.cityId,
              dlcId: row.dlcId,
              name: row.name,
              code: row.code.toString(),
              hidden: row.depotHidden || row.companyHidden || row.cityHidden,
            },
          ]),
        ),
        dlcs,
        cityDlcs: new Map(cities.map((row) => [row.id, row.dlcId])),
      };
    },
    async hasVisibleDepotInTransaction(
      tx: TxContext,
      { game, cityId, companyId }: { game: Game; cityId: string; companyId: string },
    ) {
      const [depot] = await c(tx)
        .select({ id: catalogCompanyCities.id })
        .from(catalogCompanyCities)
        .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
        .innerJoin(catalogCities, eq(catalogCompanyCities.cityId, catalogCities.id))
        .where(
          and(
            eq(catalogCompanyCities.game, game),
            eq(catalogCompanyCities.cityId, cityId),
            eq(catalogCompanyCities.companyId, companyId),
            depotVisible,
          ),
        )
        .limit(1)
        .for("share");
      return depot !== undefined;
    },
    /**
     * Source recognition of a depot in a trip city by company code or ID. Hidden rows are still
     * recognized; an unknown or invalid code returns null. Pass exactly one of the two keys.
     */
    async depotInTransaction(
      tx: TxContext,
      input: { game: Game; cityId: string; companyCode?: string; companyId?: string },
    ): Promise<{ id: string; companyCode: string } | null> {
      if ((input.companyCode === undefined) === (input.companyId === undefined))
        throw new Error("CATALOG_DEPOT_KEY_INVALID");
      if (input.companyCode !== undefined && !validCode(input.companyCode)) return null;
      const [row] = await c(tx)
        .select({ id: catalogCompanyCities.id, code: catalogCompanies.code })
        .from(catalogCompanyCities)
        .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
        .where(
          and(
            eq(catalogCompanyCities.game, input.game),
            eq(catalogCompanies.game, input.game),
            eq(catalogCompanyCities.cityId, applicationId(input.cityId)),
            input.companyCode !== undefined
              ? eq(catalogCompanies.code, Buffer.from(input.companyCode))
              : eq(catalogCompanies.id, applicationId(input.companyId as string)),
          ),
        )
        .limit(1);
      return row ? { id: row.id, companyCode: row.code.toString() } : null;
    },
    /** Current display facts of depots; only logo metadata, never the image bytes. */
    async depotRefsInTransaction(tx: TxContext, depotIds: readonly string[]) {
      const ids = [...new Set(depotIds.map(applicationId))];
      if (ids.length > 100) throw new Error("CATALOG_DEPOT_BATCH_BOUND_EXCEEDED");
      const result = new Map<
        string,
        {
          depotId: string;
          cityId: string;
          companyId: string;
          name: string;
          code: string;
          hidden: boolean;
          logo: S["CatalogLogo"] | null;
        }
      >();
      if (!ids.length) return result;
      const rows = await c(tx)
        .select({
          id: catalogCompanyCities.id,
          cityId: catalogCompanyCities.cityId,
          companyId: catalogCompanies.id,
          name: catalogCompanies.nameEn,
          code: catalogCompanies.code,
          depotHidden: catalogCompanyCities.hidden,
          companyHidden: catalogCompanies.hidden,
          cityHidden: catalogCities.hidden,
          logoSha: catalogCompanyLogos.sha256,
          logoBytes: catalogCompanyLogos.byteLength,
        })
        .from(catalogCompanyCities)
        .innerJoin(catalogCompanies, eq(catalogCompanyCities.companyId, catalogCompanies.id))
        .innerJoin(catalogCities, eq(catalogCompanyCities.cityId, catalogCities.id))
        .leftJoin(catalogCompanyLogos, companyLogoLink)
        .where(inArray(catalogCompanyCities.id, ids));
      for (const row of rows)
        result.set(row.id, {
          depotId: row.id,
          cityId: row.cityId,
          companyId: row.companyId,
          name: row.name,
          code: row.code.toString(),
          hidden: row.depotHidden || row.companyHidden || row.cityHidden,
          logo: logoOf(row.logoSha, row.logoBytes),
        });
      return result;
    },
    async cargoAdrInTransaction(tx: TxContext, cargoId: string) {
      return (await selectionsInTransaction(tx, [{ kind: "cargo", id: cargoId }])).get(cargoId)
        ?.adrClass;
    },
    /** Correlated search over the displayed labels of a trip's effective fact. */
    labelSearchCondition(
      tx: TxContext,
      refs: { origin: SQLWrapper; destination: SQLWrapper; cargo: SQLWrapper },
      locale: Locale,
      term: string,
    ) {
      const pattern = `%${term.replace(/[!%_]/g, "!$&")}%`;
      const matches = (table: typeof catalogCities | typeof catalogCargoes, ref: SQL) => {
        const display =
          locale === "ru" ? sql`COALESCE(${table.nameRu}, ${table.nameEn})` : table.nameEn;
        return exists(
          c(tx)
            .select({ one: sql`1` })
            .from(table)
            .where(and(ref, sql`${display} LIKE ${pattern} ESCAPE '!'`)),
        );
      };
      return or(
        matches(catalogCities, sql`${catalogCities.id} IN (${refs.origin}, ${refs.destination})`),
        matches(catalogCargoes, eq(catalogCargoes.id, refs.cargo)),
      );
    },
    /** Current labels; names follow the live row, including hidden rows. */
    async labelsInTransaction(
      tx: TxContext,
      refs: readonly { kind: CatalogKind; id: string }[],
      locale: Locale,
    ) {
      if (refs.length > 300) throw new Error("CATALOG_LABEL_BATCH_BOUND_EXCEEDED");
      const result = new Map<string, S["CatalogLabel"]>();
      for (const kind of ["city", "cargo", "trailer", "trailer-type"] as const) {
        const ids = [
          ...new Set(
            refs
              .filter((r) => r.kind === kind || (kind === "trailer-type" && r.kind === "trailer"))
              .map((r) => r.id),
          ),
        ];
        if (!ids.length) continue;
        const table = kindTables[kind];
        const native = kind === "city" ? catalogCities.nameNative : sql<string | null>`NULL`;
        const rows = await c(tx)
          .select({
            id: table.id,
            nameEn: table.nameEn,
            nameRu: table.nameRu,
            nameNative: native,
            hidden:
              kind === "trailer-type"
                ? sql<boolean>`FALSE`
                : (table as typeof catalogTrailers).hidden,
          })
          .from(table)
          .where(inArray(table.id, ids));
        for (const row of rows)
          result.set(
            row.id,
            label(
              row.id,
              row.nameEn,
              row.nameRu,
              kind === "trailer-type" ? false : row.hidden,
              locale,
              row.nameNative,
            ),
          );
      }
      return result;
    },
  };
}
export type Catalogs = ReturnType<typeof createCatalogs>;
