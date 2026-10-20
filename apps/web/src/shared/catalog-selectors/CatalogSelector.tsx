import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label } from "../ui/primitives.js";
import {
  catalogParams,
  compatibleSelection,
  entitiesSchema,
  entitySchema,
  type Game,
  type Kind,
  type Selection,
} from "./contracts.js";
import { useCatalogPages, useCatalogQuery } from "./queries.js";

export function CatalogSelector({
  label,
  game,
  revisionId,
  kind,
  regionId,
  value,
  onChange,
}: {
  label: string;
  game: Game;
  revisionId: string;
  kind: Kind;
  regionId?: string | undefined;
  value: Selection | null;
  onChange: (value: Selection | null) => void;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    id = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const [search, setSearch] = useState(""),
    [effective, setEffective] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setEffective(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useCatalogPages(
    ["entities", game, revisionId, kind, locale, regionId, effective],
    "/catalogs/entities",
    { revisionId, kind, locale, regionId, search: effective || undefined },
    entitiesSchema,
    !!revisionId,
  );
  const selected = useCatalogQuery(
    ["entity", value?.entityId, value?.revisionId, locale],
    `/catalogs/entities/${value?.entityId}?${catalogParams({ revisionId: value?.revisionId, locale })}`,
    entitySchema,
    !!value,
  );
  const items = query.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  const current = selected.data?.data.data;
  const compatible = current && compatibleSelection(current, game, revisionId, kind, regionId);
  const describe = (entity: typeof current) =>
    entity
      ? `${entity.display.label}${entity.display.englishFallback ? ` · ${t("fallback")}` : ""}${entity.display.retired ? ` · ${t("retired")}` : ""}`
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
        disabled={!revisionId}
      />
      <Label htmlFor={id}>{label}</Label>
      <select
        className="input"
        id={id}
        value={compatible ? current.id : ""}
        disabled={!revisionId || query.isPending}
        onChange={(e) => onChange(e.target.value ? { entityId: e.target.value, revisionId } : null)}
      >
        <option value="">{t("choose")}</option>
        {compatible && !items.some((e) => e.id === current.id) && (
          <option value={current.id}>{describe(current)}</option>
        )}
        {items
          .filter((e) => compatibleSelection(e, game, revisionId, kind, regionId))
          .map((e) => (
            <option key={e.id} value={e.id}>
              {describe(e)} · {e.mapNamespace} · {e.id.slice(0, 8)}
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
          <small>
            {value.entityId} · {value.revisionId}
          </small>
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            {t("clear")}
          </Button>
        </div>
      )}
      {query.isPending && revisionId && <p role="status">{t("loading")}</p>}
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
