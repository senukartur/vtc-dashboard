import { randomBytes } from "node:crypto";
import { newId, type UnitOfWork } from "@vtc/db";
import {
  type AdrClass,
  catalogCargoes,
  catalogCities,
  catalogDlcs,
  catalogRegions,
  catalogTrailers,
} from "@vtc/db/catalogs-schema";

type Game = "ets2" | "ats";
export interface SeedRow {
  code: string;
  nameEn?: string;
  nameRu?: string | null;
  adrClass?: AdrClass | null;
  hidden?: boolean;
  dlcCode?: string;
  regionCode?: string;
}
type Entry = string | SeedRow;
export interface SeedCatalog {
  dlcs?: Entry[];
  regions?: Entry[];
  cities?: Entry[];
  cargoes?: Entry[];
  trailers?: Entry[];
}

export const catalogConfig = () => ({ cursorKey: randomBytes(32).toString("hex") });

const row = (entry: Entry): SeedRow => (typeof entry === "string" ? { code: entry } : entry);
const label = (entry: SeedRow) => entry.nameEn ?? `Fictional ${entry.code}`;

/**
 * Seed fictional list rows directly for tests that exercise another module.
 * Returns the row ids by code; a code may repeat across lists only when the
 * caller reads it through the matching game.
 */
export async function seedCatalog(unit: UnitOfWork, game: Game, seed: SeedCatalog) {
  const ids = new Map<string, string>();
  await unit.run(async (tx) => {
    const client = unit.client(tx);
    for (const entry of (seed.dlcs ?? []).map(row)) {
      const id = newId();
      ids.set(entry.code, id);
      await client.insert(catalogDlcs).values({
        id,
        game,
        code: Buffer.from(entry.code),
        nameEn: label(entry),
        nameRu: entry.nameRu ?? null,
        hidden: entry.hidden ?? false,
      });
    }
    const dlcId = (entry: SeedRow) => (entry.dlcCode ? (ids.get(entry.dlcCode) ?? null) : null);
    for (const entry of (seed.regions ?? []).map(row)) {
      const id = newId();
      ids.set(entry.code, id);
      await client.insert(catalogRegions).values({
        id,
        game,
        code: Buffer.from(entry.code),
        nameEn: label(entry),
        nameRu: entry.nameRu ?? null,
        dlcId: dlcId(entry),
        hidden: entry.hidden ?? false,
      });
    }
    for (const entry of (seed.cities ?? []).map(row)) {
      const id = newId();
      ids.set(entry.code, id);
      await client.insert(catalogCities).values({
        id,
        game,
        code: Buffer.from(entry.code),
        nameEn: label(entry),
        nameRu: entry.nameRu ?? null,
        dlcId: dlcId(entry),
        regionId: entry.regionCode ? (ids.get(entry.regionCode) ?? null) : null,
        hidden: entry.hidden ?? false,
      });
    }
    for (const entry of (seed.cargoes ?? []).map(row)) {
      const id = newId();
      ids.set(entry.code, id);
      await client.insert(catalogCargoes).values({
        id,
        game,
        code: Buffer.from(entry.code),
        nameEn: label(entry),
        nameRu: entry.nameRu ?? null,
        dlcId: dlcId(entry),
        adrClass: entry.adrClass ?? null,
        hidden: entry.hidden ?? false,
      });
    }
    for (const entry of (seed.trailers ?? []).map(row)) {
      const id = newId();
      ids.set(entry.code, id);
      await client.insert(catalogTrailers).values({
        id,
        game,
        code: Buffer.from(entry.code),
        nameEn: label(entry),
        nameRu: entry.nameRu ?? null,
        dlcId: dlcId(entry),
        hidden: entry.hidden ?? false,
      });
    }
  });
  const id = (code: string) => {
    const found = ids.get(code);
    if (!found) throw new Error(`SYNTHETIC_CATALOG_CODE_MISSING:${code}`);
    return found;
  };
  return { ids, id };
}
