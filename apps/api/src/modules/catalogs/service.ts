import { createHash } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  catalogCargoes,
  catalogCities,
  catalogDlcs,
  catalogRegions,
  catalogTrailers,
  eq,
  gt,
  inArray,
  or,
  sql,
} from "@vtc/db/catalogs-schema";
import { alias } from "drizzle-orm/mysql-core";
import { retryTransaction } from "../../platform/jobs/queue.js";
import { duplicateKey } from "../../platform/outbox/events.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  type AdrClass,
  adrClasses,
  CATALOG_IMPORT_TOKEN_TTL_MS,
  CATALOG_PREVIEW_MAX_LINES,
  type CatalogConfig,
  type CatalogKind,
  type CatalogList,
  type Game,
  validateCatalogConfig,
  validCode,
} from "./config.js";
import { cursorCodec } from "./cursor.js";
import { CatalogFileError, type ImportRow, readImportFile } from "./import-file.js";

type S = components["schemas"];
type Locale = "en" | "ru";
export interface CatalogPorts {
  identity: Pick<Identity, "authorizeInTransaction" | "onboardingCompany" | "externalCommand">;
}
const parentKinds = { dlc: catalogDlcs, region: catalogRegions } as const;
const kindTables = {
  city: catalogCities,
  cargo: catalogCargoes,
  trailer: catalogTrailers,
} as const;
const tables = {
  dlcs: catalogDlcs,
  regions: catalogRegions,
  cities: catalogCities,
  cargoes: catalogCargoes,
  trailers: catalogTrailers,
} as const;
// Column access shared by every list; list-specific columns are read through it deliberately.
type Common = typeof catalogCities;
const common = (list: CatalogList) => tables[list] as unknown as Common;
const dlcParent = alias(catalogDlcs, "dlc_parent");
const regionParent = alias(catalogRegions, "region_parent");

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
): S["CatalogLabel"] {
  const ru = locale === "ru" && nameRu !== null;
  return {
    entityId: id,
    label: ru ? nameRu : nameEn,
    requestedLocale: locale,
    renderedLocale: ru ? "ru" : "en",
    englishFallback: locale === "ru" && !ru,
    hidden,
  };
}
const keyOf = (game: Game, code: Buffer | string) =>
  `${game}\0${typeof code === "string" ? Buffer.from(code).toString("hex") : code.toString("hex")}`;
const fileError = (error: unknown): never => {
  if (error instanceof CatalogFileError) throw catalogError(422, "CATALOG_FILE_INVALID");
  throw error;
};

export interface CatalogEntity {
  id: string;
  game: Game;
  kind: CatalogKind;
  hidden: boolean;
  adrClass: AdrClass | null;
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
  function selectColumns(list: CatalogList) {
    const t = common(list);
    return {
      id: t.id,
      game: t.game,
      code: t.code,
      nameEn: t.nameEn,
      nameRu: t.nameRu,
      hidden: t.hidden,
      dlcId: list === "dlcs" ? sql<string | null>`NULL` : t.dlcId,
      regionId: list === "cities" ? catalogCities.regionId : sql<string | null>`NULL`,
      steamAppId: list === "dlcs" ? catalogDlcs.steamAppId : sql<number | null>`NULL`,
      adrClass: list === "cargoes" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`,
      dlcEn: list === "dlcs" ? sql<string | null>`NULL` : dlcParent.nameEn,
      dlcRu: list === "dlcs" ? sql<string | null>`NULL` : dlcParent.nameRu,
      dlcHidden: list === "dlcs" ? sql<boolean | null>`NULL` : dlcParent.hidden,
      regionEn: list === "cities" ? regionParent.nameEn : sql<string | null>`NULL`,
      regionRu: list === "cities" ? regionParent.nameRu : sql<string | null>`NULL`,
      regionHidden: list === "cities" ? regionParent.hidden : sql<boolean | null>`NULL`,
    };
  }
  type ListRow = {
    id: string;
    game: Game;
    code: Buffer;
    nameEn: string;
    nameRu: string | null;
    hidden: boolean;
    dlcId: string | null;
    regionId: string | null;
    steamAppId: number | null;
    adrClass: AdrClass | null;
    dlcEn: string | null;
    dlcRu: string | null;
    dlcHidden: boolean | null;
    regionEn: string | null;
    regionRu: string | null;
    regionHidden: boolean | null;
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
    let query = c(tx).select(selectColumns(list)).from(t).$dynamic();
    if (list !== "dlcs") query = query.leftJoin(dlcParent, eq(t.dlcId, dlcParent.id));
    if (list === "cities")
      query = query.leftJoin(regionParent, eq(catalogCities.regionId, regionParent.id));
    query = query.where(where);
    if (order) {
      const display = locale === "ru" ? sql`COALESCE(${t.nameRu}, ${t.nameEn})` : t.nameEn;
      query = query.orderBy(asc(display), asc(t.id));
    }
    if (limit !== undefined) query = query.limit(limit);
    return (await query) as unknown as ListRow[];
  }
  function itemDto(list: CatalogList, row: ListRow, locale: Locale): S["CatalogItem"] {
    const dlc =
      row.dlcId && row.dlcEn !== null
        ? label(row.dlcId, row.dlcEn, row.dlcRu, row.dlcHidden === true, locale)
        : null;
    return {
      id: row.id,
      game: row.game,
      code: row.code.toString(),
      nameEn: row.nameEn,
      nameRu: row.nameRu,
      hidden: row.hidden,
      display: label(row.id, row.nameEn, row.nameRu, row.hidden, locale),
      dlcId: list === "dlcs" ? null : row.dlcId,
      dlc: list === "dlcs" ? null : dlc,
      ...(list === "dlcs" ? { steamAppId: row.steamAppId } : {}),
      ...(list === "cities"
        ? {
            regionId: row.regionId,
            region:
              row.regionId && row.regionEn !== null
                ? label(row.regionId, row.regionEn, row.regionRu, row.regionHidden === true, locale)
                : null,
          }
        : {}),
      ...(list === "cargoes" ? { adrClass: row.adrClass } : {}),
    };
  }
  async function itemById(tx: TxContext, list: CatalogList, id: string, locale: Locale) {
    const [row] = await fetchRows(tx, list, eq(common(list).id, id));
    if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
    return itemDto(list, row, locale);
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
      ...("nameRu" in input ? { nameRu } : {}),
      ...("nameEn" in input ? { nameEn: input.nameEn } : {}),
      ...("code" in input ? { code: requireCode(input.code as string) } : {}),
      ...(list === "dlcs" && "steamAppId" in input ? { steamAppId: input.steamAppId } : {}),
      ...(list !== "dlcs" && "dlcId" in input ? { dlcId: input.dlcId } : {}),
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
    });
  }
  function assertPatchShape(list: CatalogList, input: S["CatalogItemPatch"]) {
    const allowed: readonly string[] = {
      dlcs: ["code", "nameEn", "nameRu", "steamAppId", "hidden"],
      regions: ["code", "nameEn", "nameRu", "dlcId", "hidden"],
      cities: ["code", "nameEn", "nameRu", "regionId", "dlcId", "hidden"],
      cargoes: ["code", "nameEn", "nameRu", "adrClass", "dlcId", "hidden"],
      trailers: ["code", "nameEn", "nameRu", "dlcId", "hidden"],
    }[list];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw identityError(422);
  }
  async function resolveInTransaction(
    tx: TxContext,
    input: { game: Game; kind: CatalogKind; code: string },
  ): Promise<
    | { status: "resolved"; id: string; adrClass: AdrClass | null }
    | { status: "unknown"; reasonCode: string }
  > {
    if (!validCode(input.code)) return { status: "unknown", reasonCode: "unknown_source_id" };
    const table = kindTables[input.kind];
    const adr = input.kind === "cargo" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`;
    const [row] = await c(tx)
      .select({ id: table.id, adrClass: adr })
      .from(table)
      .where(and(eq(table.game, input.game), eq(table.code, Buffer.from(input.code))));
    if (!row) return { status: "unknown", reasonCode: "unknown_source_id" };
    return { status: "resolved", id: row.id, adrClass: (row.adrClass as AdrClass | null) ?? null };
  }
  async function selectionsInTransaction(
    tx: TxContext,
    selections: readonly { kind: CatalogKind; id: string }[],
  ) {
    const result = new Map<string, CatalogEntity>();
    for (const kind of ["city", "cargo", "trailer"] as const) {
      const ids = selections.filter((s) => s.kind === kind).map((s) => applicationId(s.id));
      if (!ids.length) continue;
      const table = kindTables[kind];
      const adr = kind === "cargo" ? catalogCargoes.adrClass : sql<AdrClass | null>`NULL`;
      const rows = await c(tx)
        .select({ id: table.id, game: table.game, hidden: table.hidden, adrClass: adr })
        .from(table)
        .where(inArray(table.id, [...new Set(ids)]));
      for (const row of rows)
        result.set(row.id, {
          id: row.id,
          game: row.game,
          kind,
          hidden: row.hidden,
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
      let query = c(tx).select(selectColumns(list)).from(t).$dynamic();
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
      const nameEn = v.name_en ?? "";
      if (!nameEn.trim()) issues.push({ field: "name_en", reason: "required" });
      else if ([...nameEn].length > 256) issues.push({ field: "name_en", reason: "too_long" });
      const nameRu = v.name_ru ?? "";
      if ([...nameRu].length > 256) issues.push({ field: "name_ru", reason: "too_long" });
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
      const linkedRow = game && codeOk ? existing.get(keyOf(game, code)) : undefined;
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
          ...(list === "cities" ? { regionId: regionId ?? null } : {}),
          ...(list === "cargoes" ? { adrClass: adrClass ?? null } : {}),
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
      compare("name_en", "nameEn", current.nameEn, nameEn);
      if (nameRu !== "") compare("name_ru", "nameRu", current.nameRu, nameRu);
      if (list === "dlcs" && steamAppId !== undefined)
        compare("steam_app_id", "steamAppId", current.steamAppId, steamAppId);
      if (list !== "dlcs" && dlcId !== undefined)
        compare("dlc_code", "dlcId", current.dlcId, dlcId);
      if (list === "cities" && regionId !== undefined)
        compare("region_code", "regionId", current.regionId, regionId);
      if (list === "cargoes" && adrClass !== undefined)
        compare("adr_class", "adrClass", current.adrClass, adrClass);
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
  const tokenBinding = (list: CatalogList, fileHash: string, actor: Actor) =>
    ["catalog-import", list, fileHash, actor.userId] as const;
  function parseFile(list: CatalogList, bytes: Buffer) {
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

  return {
    config,
    async authorize(actor: Actor, admin = true) {
      return run((tx) => authority(tx, actor, admin));
    },
    async summary(actor: Actor, game: Game): Promise<S["CatalogSummary"]> {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const lists = {} as S["CatalogSummary"]["lists"];
        for (const list of Object.keys(tables) as CatalogList[]) {
          const t = common(list);
          const rows = await c(tx)
            .select({ hidden: t.hidden, count: sql<number | string>`COUNT(*)` })
            .from(t)
            .where(eq(t.game, game))
            .groupBy(t.hidden);
          const count = (flag: boolean) => Number(rows.find((r) => r.hidden === flag)?.count ?? 0);
          lists[list] = { visible: count(false), hidden: count(true) };
        }
        return { game, lists };
      });
    },
    async list(
      actor: Actor,
      list: CatalogList,
      query: {
        game: Game;
        search?: string;
        includeHidden?: boolean;
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
        const t = common(list),
          binding = [
            actor.userId,
            actor.sessionId,
            actor.accessEpoch,
            list,
            query.game,
            query.search ?? null,
            query.includeHidden ?? false,
            query.dlc ?? null,
            query.regionId ?? null,
            locale,
          ];
        let after: [string, string] | null = null;
        if (query.cursor) {
          try {
            after = JSON.parse(codec.read(binding, query.cursor));
          } catch {
            throw identityError(409, "VERSION_CONFLICT");
          }
        }
        const display =
          locale === "ru" ? sql`COALESCE(${t.nameRu}, ${t.nameEn})` : sql`${t.nameEn}`;
        const escaped = query.search?.replace(/[\\%_]/g, (v) => `\\${v}`);
        const filter = and(
          eq(t.game, query.game),
          query.includeHidden ? undefined : eq(t.hidden, false),
          escaped
            ? or(
                sql`${t.nameEn} LIKE ${`%${escaped}%`}`,
                sql`${t.nameRu} LIKE ${`%${escaped}%`}`,
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
        const [total] = await c(tx)
          .select({ count: sql<number | string>`COUNT(*)` })
          .from(t)
          .where(filter);
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
        const last = visible[visible.length - 1];
        return {
          items: visible.map((row) => itemDto(list, row, locale)),
          total: Number(total?.count ?? 0),
          nextCursor:
            page.length > limit && last
              ? codec.write(
                  binding,
                  JSON.stringify([
                    locale === "ru" && last.nameRu !== null ? last.nameRu : last.nameEn,
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
                } as never);
            } catch (error) {
              if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
              throw error;
            }
            await recordAudit(tx, actor, "catalog.changed", id);
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
            const [row] = (await c(tx)
              .select({
                id: t.id,
                game: t.game,
                ...(list !== "dlcs" ? { dlcId: t.dlcId } : {}),
                ...(list === "cities" ? { regionId: catalogCities.regionId } : {}),
              })
              .from(t)
              .where(eq(t.id, id))
              .for("update")) as {
              id: string;
              game: Game;
              dlcId?: string | null;
              regionId?: string | null;
            }[];
            if (!row) throw catalogError(404, "CATALOG_ROW_NOT_FOUND");
            if (list !== "dlcs" && "dlcId" in input)
              await parent(tx, "dlc", row.game, input.dlcId, row.dlcId ?? null);
            if (list === "cities" && "regionId" in input)
              await parent(tx, "region", row.game, input.regionId, row.regionId ?? null);
            const fields = fieldsOf(list, input);
            if (Object.keys(fields).length) {
              try {
                await c(tx)
                  .update(t)
                  .set(fields as never)
                  .where(eq(t.id, row.id));
              } catch (error) {
                if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
                throw error;
              }
            }
            await recordAudit(tx, actor, "catalog.changed", row.id);
            return { item: await itemById(tx, list, row.id, "en") };
          },
        );
        return saved.item as S["CatalogItem"];
      });
    },
    async previewImport(actor: Actor, list: CatalogList, bytes: Buffer) {
      const fileSha256 = sha(bytes);
      const rows = parseFile(list, bytes);
      return run(async (tx): Promise<S["CatalogImportPreview"]> => {
        await authority(tx, actor, true);
        const plan = await computeImport(tx, list, rows, false);
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
      list: CatalogList,
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
            const plan = await computeImport(tx, list, rows, true);
            if (plan.errors)
              throw importInvalid(plan.lines.filter((line) => line.status === "error"));
            const table = tables[list] as Common;
            for (let i = 0; i < plan.inserts.length; i += 200) {
              try {
                await c(tx)
                  .insert(table)
                  .values(plan.inserts.slice(i, i + 200) as never[]);
              } catch (error) {
                if (duplicateKey(error)) throw catalogError(409, "CATALOG_CODE_CONFLICT");
                throw error;
              }
            }
            for (const update of plan.updates)
              await c(tx)
                .update(table)
                .set(update.set as never)
                .where(eq(table.id, update.id));
            const importId = newId();
            await recordAudit(tx, actor, "catalog.imported", importId);
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
    resolveInTransaction,
    selectionsInTransaction,
    async cargoAdrInTransaction(tx: TxContext, cargoId: string) {
      return (await selectionsInTransaction(tx, [{ kind: "cargo", id: cargoId }])).get(cargoId)
        ?.adrClass;
    },
    /** Current labels; names follow the live row, including hidden rows. */
    async labelsInTransaction(
      tx: TxContext,
      refs: readonly { kind: CatalogKind; id: string }[],
      locale: Locale,
    ) {
      if (refs.length > 300) throw new Error("CATALOG_LABEL_BATCH_BOUND_EXCEEDED");
      const result = new Map<string, S["CatalogLabel"]>();
      for (const kind of ["city", "cargo", "trailer"] as const) {
        const ids = [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
        if (!ids.length) continue;
        const table = kindTables[kind];
        const rows = await c(tx)
          .select({
            id: table.id,
            nameEn: table.nameEn,
            nameRu: table.nameRu,
            hidden: table.hidden,
          })
          .from(table)
          .where(inArray(table.id, ids));
        for (const row of rows)
          result.set(row.id, label(row.id, row.nameEn, row.nameRu, row.hidden, locale));
      }
      return result;
    },
  };
}
export type Catalogs = ReturnType<typeof createCatalogs>;
