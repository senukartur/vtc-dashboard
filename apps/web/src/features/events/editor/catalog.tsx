import { useQueries } from "@tanstack/react-query";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";
import {
  type CatalogItem,
  type CatalogList,
  catalogParams,
  itemSchema,
  listSchema,
} from "../../../shared/catalog-selectors/contracts.js";
import { CatalogSelector } from "../../../shared/catalog-selectors/index.js";
import {
  useCatalogAccess,
  useCatalogPages,
  useCatalogQuery,
} from "../../../shared/catalog-selectors/queries.js";
import { Button, Input, Label, Select } from "../../../shared/ui/primitives.js";
import { CompanyLogo } from "../../catalogs/CompanyLogo.js";
import type { DTO } from "../model.js";
import { schema } from "../transport.js";
import {
  type DepotOption,
  type EditorEndpoint,
  type EditorForm,
  eventEditorDlcs,
  resolveDepotChoice,
} from "./model.js";
import { useEditorText } from "./text.js";

/** Compatible with the shared VTC-151 company picker until it offers canonical depot IDs. */
export type EventDepotSelector = ComponentType<{
  id?: string | undefined;
  label: string;
  game: NonNullable<DTO["EventStage2DraftInput"]["game"]>;
  cityId: string | undefined;
  value: string | null;
  selected: DepotOption | undefined;
  selectedPending?: boolean | undefined;
  onChange: (value: string | null) => void;
  describedBy?: string | undefined;
}>;

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
  hint: DTO["EventStage2CanonicalCatalogOption"] | null | undefined,
) {
  const code = hint?.id === endpoint.depotId ? hint.code : undefined;
  const path = `/catalogs/depots?${catalogParams({ game, cityId: endpoint.cityId, locale: "en", search: code, includeHidden: "true", limit: 25 })}`;
  const retained = useCatalogQuery(
    ["event-editor", path],
    path,
    schema("CatalogDepotList"),
    !!(game && endpoint.cityId && code && !endpoint.depot),
  );
  return (
    endpoint.depot ??
    retained.data?.data.data.items.find(
      (depot) =>
        depot.id === endpoint.depotId && depot.city.id === endpoint.cityId && depot.game === game,
    )
  );
}

export function DepotField({
  id,
  label,
  game,
  endpoint,
  resolved,
  hint,
  picker: Picker,
  onChange,
  onBlocked,
  errorId,
}: {
  id: string;
  label: string;
  game: EditorForm["game"];
  endpoint: EditorEndpoint;
  resolved: DTO["CatalogDepot"] | undefined;
  hint: DTO["EventStage2CanonicalCatalogOption"] | null | undefined;
  picker: EventDepotSelector | undefined;
  onChange: (value: DTO["CatalogDepot"] | null) => void;
  onBlocked: (blocked: boolean) => void;
  errorId: string | undefined;
}) {
  const { text } = useEditorText();
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
      const query = catalogParams({ game, cityId, companyId, locale: "en", limit: 1 });
      const response = await catalog.read(
        `/catalogs/depots?${query}`,
        schema("CatalogDepotList"),
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
      {Picker && game ? (
        <Picker
          id={id}
          label={label}
          game={game}
          cityId={endpoint.cityId ?? undefined}
          value={candidate?.id ?? selected?.id ?? null}
          selected={selected}
          selectedPending={candidate?.pending}
          onChange={(companyId) => void choose(companyId)}
          describedBy={errorId}
        />
      ) : (
        <>
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} disabled placeholder={text.unavailableDepot} aria-describedby={errorId} />
        </>
      )}
      {Picker && game && !endpoint.cityId && <p className="muted">{text.chooseCity}</p>}
      {resolved && (
        <div className="event-editor-depot-logo">
          <CompanyLogo companyId={resolved.company.id} logo={resolved.company.logo} />
          <span>
            {resolved.company.label.label} · <code>{resolved.company.code}</code>
          </span>
        </div>
      )}
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
  game,
  kind,
  value,
  item,
  onChange,
}: {
  label: string;
  game: EditorForm["game"];
  kind: "city" | "cargo" | "trailer";
  value: string | null;
  item: CatalogItem | undefined;
  onChange: (value: string | null) => void;
}) {
  const { text } = useEditorText();
  const id = useId();
  return game ? (
    <>
      <CatalogSelector
        key={game}
        label={label}
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
  const [picked, setPicked] = useState("");
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
  const choices = settled
    ? (pages.data?.pages
        .flatMap((page) => page.data.data.items)
        .filter((item) => item.game === game && !item.hidden && !manualIds.includes(item.id)) ?? [])
    : [];
  return (
    <div className="stack">
      <Label htmlFor={id}>{text.requiredDlcIds}</Label>
      {entries.length > 0 && (
        <ul className="event-editor-dlcs">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span>{entry.label ?? text.retainedCatalog}</span>
              {entry.code && <code>{entry.code}</code>}
              {entry.sources.includes("from_city") && (
                <span className="event-editor-tag">{text.lockedDlc}</span>
              )}
              {entry.sources.includes("manual") && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={[text.remove, text.manual, entry.label ?? text.requiredDlcIds].join(
                    " · ",
                  )}
                  onClick={() => onChange(manualIds.filter((value) => value !== entry.id))}
                >
                  {text.remove} · {text.manual}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <>
          <div className="event-editor-field">
            <Label htmlFor={`${id}-search`}>{text.searchDlc}</Label>
            <Input
              id={`${id}-search`}
              type="search"
              maxLength={128}
              value={search}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                )
                  event.preventDefault();
              }}
              onChange={(event) => {
                setSearch(event.target.value);
                setPicked("");
              }}
            />
          </div>
          <div className="event-editor-inline">
            <Select
              id={id}
              value={picked}
              aria-describedby={errorId}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">{text.chooseDlc}</option>
              {choices.map(({ id, nameEn, code }) => (
                <option value={id} key={id}>
                  {nameEn} · {code}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!choices.some(({ id }) => id === picked)}
              onClick={() => {
                onChange([...manualIds, picked]);
                setPicked("");
              }}
            >
              {text.add}
            </Button>
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
          {settled && pages.isSuccess && !choices.length && (
            <p className="muted">{text.noCatalogOptions}</p>
          )}
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
        </>
      ) : (
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={!game}
          aria-describedby={errorId}
          onClick={() => setOpen(true)}
        >
          {text.chooseDlc}
        </Button>
      )}
    </div>
  );
}
