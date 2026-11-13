import { useQueries } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
  type CatalogItem,
  type CatalogList,
  catalogParams,
  depotListSchema,
  itemSchema,
  listSchema,
} from "../../../shared/catalog-selectors/contracts.js";
import { CatalogSelector, DepotSelector } from "../../../shared/catalog-selectors/index.js";
import {
  useCatalogAccess,
  useCatalogPages,
  useCatalogQuery,
} from "../../../shared/catalog-selectors/queries.js";
import { Button, Input, Label } from "../../../shared/ui/primitives.js";
import { CompanyLogo } from "../../catalogs/CompanyLogo.js";
import type { DTO } from "../model.js";
import {
  type EditorEndpoint,
  type EditorForm,
  eventEditorDlcs,
  resolveDepotChoice,
} from "./model.js";
import { useEditorText } from "./text.js";

export function useEditorCatalogItem(list: CatalogList, id: string | null, locale: "en" | "ru") {
  const query = useCatalogQuery(
    ["item", list, id, locale],
    `/catalogs/${list}/${id}?locale=${locale}`,
    itemSchema,
    !!id,
  );
  const item = query.data?.data.data;
  return item?.id === id ? item : undefined;
}

export function useRetainedDepot(
  game: EditorForm["game"],
  endpoint: EditorEndpoint,
  locale: "en" | "ru",
) {
  const { cityId, depotId, depot } = endpoint;
  const path = `/catalogs/depots?${catalogParams({ game, cityId, depotId, includeHidden: "true", locale, limit: 1 })}`;
  const retained = useCatalogQuery(
    ["event-editor", path],
    path,
    depotListSchema,
    !!(game && cityId && depotId && !depot),
  );
  const rows = retained.data?.data.data;
  const found = rows?.total === 1 && rows.items.length === 1 ? rows.items[0] : undefined;
  return (
    depot ??
    (found?.id === depotId && found.game === game && found.city.id === cityId ? found : undefined)
  );
}

export function DepotField({
  id,
  label,
  caption,
  game,
  endpoint,
  resolved,
  hint,
  onChange,
  onBlocked,
  errorId,
}: {
  id: string;
  label: string;
  caption?: string;
  game: EditorForm["game"];
  endpoint: EditorEndpoint;
  resolved: DTO["CatalogDepot"] | undefined;
  hint: DTO["EventStage2CanonicalCatalogOption"] | null | undefined;
  onChange: (value: DTO["CatalogDepot"] | null) => void;
  onBlocked: (blocked: boolean) => void;
  errorId: string | undefined;
}) {
  const { text, locale } = useEditorText();
  const catalog = useCatalogAccess();
  const [candidate, setCandidate] = useState<{ id: string; pending: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function undo() {
    controller.current?.abort();
    setCandidate(null);
    onBlocked(false);
  }

  async function choose(companyId: string | null) {
    undo();
    if (!companyId) {
      if (!candidate) onChange(null);
      return;
    }
    const { cityId } = endpoint;
    if (!game || !cityId) return;
    const request = new AbortController();
    controller.current = request;
    onBlocked(true);
    setCandidate({ id: companyId, pending: true });
    try {
      const query = catalogParams({ game, cityId, companyId, locale, limit: 1 });
      const response = await catalog.read(
        `/catalogs/depots?${query}`,
        depotListSchema,
        request.signal,
      );
      if (request.signal.aborted) return;
      const rows = response.data.data;
      const selected = rows.total === 1 && resolveDepotChoice(rows.items, game, cityId, companyId);
      if (!selected) {
        setCandidate({ id: companyId, pending: false });
        return;
      }
      onChange(selected);
      setCandidate(null);
      onBlocked(false);
    } catch {
      if (!request.signal.aborted) setCandidate({ id: companyId, pending: false });
    }
  }

  const selected = resolved
    ? {
        id: resolved.company.id,
        label: resolved.company.label.label,
        code: resolved.company.code,
      }
    : undefined;
  const historical =
    resolved && (resolved.hidden || resolved.city.label.hidden || resolved.company.label.hidden);
  const kept = endpoint.depotId && !resolved;
  const retainedName = kept && hint?.id === endpoint.depotId ? hint : undefined;
  return (
    <div className="stack event-editor-depot">
      {game ? (
        <DepotSelector
          id={id}
          label={label}
          caption={caption ? `${caption} · ${text.optional.toLowerCase()}` : undefined}
          game={game}
          cityId={endpoint.cityId ?? undefined}
          value={candidate?.id ?? selected?.id ?? null}
          selected={selected}
          selectedPending={candidate?.pending}
          onChange={(companyId) => void choose(companyId)}
          describedBy={errorId}
          selectedPrefix={
            resolved && (
              <span className="event-editor-depot-logo">
                <CompanyLogo companyId={resolved.company.id} logo={resolved.company.logo} />
              </span>
            )
          }
        />
      ) : (
        <>
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} disabled placeholder={text.chooseGame} aria-describedby={errorId} />
        </>
      )}
      {game && !endpoint.cityId && <p className="muted">{text.chooseCity}</p>}
      {historical && <p className="muted">{text.hiddenDepot}</p>}
      {kept && (
        <div className="event-editor-inline">
          <p className="muted">
            {retainedName ? (
              <>
                {retainedName.name} · <code>{retainedName.code}</code>
              </>
            ) : (
              text.retainedDepot
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              undo();
              onChange(null);
            }}
          >
            {text.clear}
          </Button>
        </div>
      )}
      {candidate && (
        <div className="event-editor-inline">
          <p
            role={candidate.pending ? "status" : "alert"}
            className={candidate.pending ? "muted" : "field-error"}
          >
            {candidate.pending ? text.loading : text.depotError}
          </p>
          {!candidate.pending && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void choose(candidate.id)}
            >
              {text.retry}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={undo}>
            {text.undoDepot}
          </Button>
        </div>
      )}
    </div>
  );
}

export function EditorCatalogSelector({
  label,
  caption,
  game,
  kind,
  value,
  item,
  required = false,
  onChange,
}: {
  label: string;
  caption?: string;
  game: EditorForm["game"];
  kind: "city" | "cargo" | "trailer";
  value: string | null;
  item: CatalogItem | undefined;
  required?: boolean;
  onChange: (value: string | null) => void;
}) {
  const { text } = useEditorText();
  const id = useId();
  return game ? (
    <>
      <CatalogSelector
        key={game}
        label={label}
        caption={caption}
        required={required}
        game={game}
        kind={kind}
        value={value}
        onChange={onChange}
      />
      {value && !item && <span className="visually-hidden">{text.retainedCatalog}</span>}
    </>
  ) : (
    <>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} disabled placeholder={text.chooseGame} />
    </>
  );
}

export function useEditorDlcs(
  manualIds: readonly string[],
  derivedIds: readonly (string | null | undefined)[],
  retained: readonly DTO["EventStage2Dlc"][],
) {
  const access = useCatalogAccess();
  const entries = eventEditorDlcs(manualIds, derivedIds);
  const catalog = useQueries({
    queries: entries.map(({ id }) => ({
      queryKey: ["catalogs", ...access.scope, "event-editor-dlc", id],
      meta: { private: true },
      retry: false,
      staleTime: 10_000,
      gcTime: 0,
      queryFn: ({ signal }) => access.read(`/catalogs/dlcs/${id}?locale=en`, itemSchema, signal),
    })),
  });
  return entries.map((entry, index) => {
    const found = catalog[index]?.data?.data.data;
    const item = found?.id === entry.id ? found : undefined;
    const saved = retained.find(({ id }) => id === entry.id);
    return {
      ...entry,
      label: item?.nameEn ?? saved?.name,
      code: item?.code ?? saved?.code,
      game: item?.game,
      hidden: item?.hidden,
    };
  });
}

export type EditorDlc = ReturnType<typeof useEditorDlcs>[number];

export function DlcField({
  id,
  game,
  entries,
  onChange,
  errorId,
}: {
  id: string;
  game: EditorForm["game"];
  entries: readonly EditorDlc[];
  onChange: (value: string[]) => void;
  errorId: string | undefined;
}) {
  const { text } = useEditorText();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [effective, setEffective] = useState("");
  const term = search.trim();
  const settled = term === effective;
  useEffect(() => {
    const timer = window.setTimeout(() => setEffective(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const pages = useCatalogPages(
    ["event-editor-dlc", game, effective],
    "/catalogs/dlcs",
    { game, locale: "en", search: effective || undefined },
    listSchema,
    open && !!game && settled,
  );
  const manualIds = entries.filter(({ sources }) => sources.includes("manual")).map(({ id }) => id);
  const searchText = term.toLowerCase();
  const choices = new Map(
    entries.map((entry) => [
      entry.id,
      {
        label: entry.label ?? text.retainedCatalog,
        code: entry.code,
        derived: entry.sources.includes("from_city"),
        canAdd: entry.game === game && entry.hidden === false,
        matchesSearch:
          [entry.label, entry.code].some((value) => value?.toLowerCase().includes(searchText)) ||
          !term,
      },
    ]),
  );
  if (settled) {
    for (const page of pages.data?.pages ?? []) {
      for (const item of page.data.data.items) {
        if (item.game === game && !item.hidden) {
          choices.set(item.id, {
            label: item.nameEn,
            code: item.code,
            derived: choices.get(item.id)?.derived ?? false,
            canAdd: true,
            matchesSearch: true,
          });
        }
      }
    }
  }
  const visibleChoices = Array.from(choices).filter(([, choice]) => choice.matchesSearch);

  function close() {
    setOpen(false);
    setSearch("");
    trigger.current?.focus();
  }

  useEffect(() => {
    if (open) searchInput.current?.focus();
  }, [open]);

  return (
    <div className="event-editor-dlc-picker">
      <Label htmlFor={id}>{text.requiredDlcIds}</Label>
      <Button
        ref={trigger}
        id={id}
        type="button"
        variant="outline"
        className="event-editor-dlc-trigger"
        aria-label={text.requiredDlcIds}
        aria-expanded={open}
        aria-controls={open ? `${id}-choices` : undefined}
        aria-describedby={errorId}
        disabled={!game}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {entries.length ? (
          entries.map((entry) => (
            <span key={entry.id} className="event-editor-tag">
              {entry.label ?? text.retainedCatalog}
            </span>
          ))
        ) : (
          <span className="muted">{text.chooseDlc}</span>
        )}
        <svg
          className="catalog-chevron event-editor-chevron"
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Button>
      {open && (
        <fieldset
          className="event-editor-dlc-options"
          id={`${id}-choices`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
            if (event.key === "Enter" && event.target === searchInput.current)
              event.preventDefault();
          }}
        >
          <legend className="visually-hidden">{text.requiredDlcIds}</legend>
          <Input
            ref={searchInput}
            aria-label={text.searchDlc}
            placeholder={text.searchDlc}
            type="search"
            maxLength={128}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="event-editor-dlc-list">
            {visibleChoices.map(([id, choice]) => (
              <label key={id} className="event-editor-dlc-option">
                <input
                  type="checkbox"
                  aria-label={
                    choice.derived
                      ? [choice.label, choice.code, text.manual].filter(Boolean).join(" · ")
                      : undefined
                  }
                  checked={manualIds.includes(id)}
                  disabled={!choice.canAdd && !manualIds.includes(id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...manualIds, id]
                        : manualIds.filter((value) => value !== id),
                    )
                  }
                />
                <span>
                  {choice.label}
                  {choice.code && (
                    <>
                      {" "}
                      · <code>{choice.code}</code>
                    </>
                  )}
                </span>
                {choice.derived && (
                  <small className="muted">
                    {text.manual} · {text.lockedDlc}
                  </small>
                )}
              </label>
            ))}
          </div>
          {(!settled || pages.isPending) && <p role="status">{text.loading}</p>}
          {settled && pages.isError && (
            <div className="event-editor-inline">
              <p role="alert" className="field-error">
                {text.catalogUnavailable}
              </p>
              <Button type="button" variant="outline" onClick={() => void pages.refetch()}>
                {text.retry}
              </Button>
            </div>
          )}
          {settled && pages.isSuccess && visibleChoices.length === 0 && (
            <p className="muted">{text.noCatalogOptions}</p>
          )}
          <div className="event-editor-inline">
            {settled && pages.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {text.more}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={close}>
              {text.done}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
