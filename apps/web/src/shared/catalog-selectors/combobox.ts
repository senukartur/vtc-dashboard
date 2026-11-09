import { type CatalogItem, compatibleSelection, type Game } from "./contracts.js";

/** One row of the open list; `key` is stable across pages and identifies its DOM option. */
export type ComboboxRow =
  | { kind: "item"; key: string; item: CatalogItem }
  | { kind: "more"; key: "more" }
  | { kind: "refresh"; key: "refresh" }
  | { kind: "extra"; key: "extra" };

/**
 * Catalog rows first, then load more or refresh (a failed read offers only refresh), then the
 * consumer's extra row last. Rows that cannot be newly chosen are dropped here.
 */
export function comboboxRows({
  items,
  game,
  regionId,
  hasMore,
  failed,
  extra,
}: {
  items: CatalogItem[];
  game: Game;
  regionId?: string | undefined;
  hasMore: boolean;
  failed: boolean;
  extra: boolean;
}): ComboboxRow[] {
  const rows: ComboboxRow[] = items
    .filter((item) => compatibleSelection(item, game, regionId))
    .map((item) => ({ kind: "item", key: item.id, item }));
  if (failed) rows.push({ kind: "refresh", key: "refresh" });
  else if (hasMore) rows.push({ kind: "more", key: "more" });
  if (extra) rows.push({ kind: "extra", key: "extra" });
  return rows;
}

/** Arrow keys wrap around the list; -1 means there is nothing to move to. */
export function moveActive(active: number, delta: 1 | -1, length: number) {
  return length === 0 ? -1 : (active + delta + length) % length;
}

/** Keeps the active row inside the list after the list shrinks or a read replaces it. */
export function clampActive(active: number, length: number) {
  return length === 0 ? -1 : Math.min(Math.max(active, 0), length - 1);
}

/** Leaving the field restores the previous value unless the user erased the text entirely. */
export function leaveAction(draft: string | null, hasValue: boolean): "clear" | "restore" {
  return draft !== null && draft.trim() === "" && hasValue ? "clear" : "restore";
}
