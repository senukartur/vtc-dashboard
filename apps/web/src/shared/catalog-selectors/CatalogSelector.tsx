import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label } from "../ui/primitives.js";
import {
  type CatalogItem,
  compatibleSelection,
  type Game,
  itemSchema,
  type Kind,
  listOfKind,
  listSchema,
} from "./contracts.js";
import { useCatalogPages, useCatalogQuery } from "./queries.js";

export function CatalogSelector({
  label,
  game,
  kind,
  regionId,
  value,
  onChange,
}: {
  label: string;
  game: Game;
  kind: Kind;
  regionId?: string | undefined;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    id = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const list = listOfKind[kind];
  const [search, setSearch] = useState(""),
    [effective, setEffective] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setEffective(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useCatalogPages(
    ["selector", list, game, locale, regionId, effective],
    `/catalogs/${list}`,
    { game, locale, regionId, search: effective || undefined },
    listSchema,
  );
  const selected = useCatalogQuery(
    ["item", list, value, locale],
    `/catalogs/${list}/${value}?locale=${locale}`,
    itemSchema,
    !!value,
  );
  const items = query.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  const current = selected.data?.data.data;
  const usable = current?.game === game && (!regionId || current.regionId === regionId);
  const compatible = !!current && compatibleSelection(current, game, regionId);
  const describe = (item: CatalogItem | undefined) =>
    item
      ? `${item.display.label}${item.display.englishFallback ? ` · ${t("fallback")}` : ""}${item.display.hidden ? ` · ${t("hidden")}` : ""}`
      : "";
  return (
    <div className="stack catalog-selector">
      <Label htmlFor={`${id}-search`}>{t("search", { label })}</Label>
      <Input
        id={`${id}-search`}
        type="search"
        maxLength={128}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(event) => {
          // Let IME confirmation finish; ordinary search Enter must not submit a consumer form.
          if (
            event.key === "Enter" &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          )
            event.preventDefault();
        }}
      />
      <Label htmlFor={id}>{label}</Label>
      <select
        className="input"
        id={id}
        value={usable && current ? current.id : ""}
        disabled={query.isPending}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t("choose")}</option>
        {usable && current && !items.some((e) => e.id === current.id) && (
          <option value={current.id}>{describe(current)}</option>
        )}
        {items
          .filter((e) => compatibleSelection(e, game, regionId))
          .map((e) => (
            <option key={e.id} value={e.id}>
              {describe(e)} · {e.code}
            </option>
          ))}
      </select>
      {value && (
        <div className="catalog-selection" aria-live="polite">
          {current ? (
            <>
              <strong>{describe(current)}</strong>
              <p>{t(compatible ? "selected" : "historical")}</p>
            </>
          ) : (
            <p>{t(selected.isError ? "historyError" : "loading")}</p>
          )}
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            {t("clear")}
          </Button>
        </div>
      )}
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.isError && (
        <p role="alert">
          {t("readError")}{" "}
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t("refresh")}
          </Button>
        </p>
      )}
      {query.isSuccess && !items.length && <p>{t("empty")}</p>}
      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </div>
  );
}
