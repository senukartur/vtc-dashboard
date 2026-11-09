import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, Label } from "../ui/primitives.js";
import {
  type ComboboxRow,
  clampActive,
  comboboxRows,
  leaveAction,
  moveActive,
  searchTerm,
  selectorDisplay,
  typedText,
} from "./combobox.js";
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
import "./catalog-selector.css";

/** Picks an extra list row; the consumer owns the value it stands for. */
export type CatalogExtraRow = {
  label: string;
  active: boolean;
  onChoose: (typed: string) => void;
};

const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * One editable ARIA combobox for a catalog row: typing searches through the server after a
 * debounce and pages inside the list. Form state holds canonical IDs only; language changes labels.
 */
export function CatalogSelector({
  label,
  game,
  kind,
  regionId,
  value,
  onChange,
  extraRow,
}: {
  label: string;
  game: Game;
  kind: Kind;
  regionId?: string | undefined;
  value: string | null;
  onChange: (value: string | null) => void;
  extraRow?: CatalogExtraRow | undefined;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    id = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const list = listOfKind[kind];
  const inputRef = useRef<HTMLInputElement>(null),
    listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null),
    [effective, setEffective] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [picked, setPicked] = useState<CatalogItem | null>(null);
  const term = searchTerm(draft);
  const typed = typedText(draft, extraRow);
  useEffect(() => {
    const timer = window.setTimeout(() => setEffective(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const settled = effective === term;
  const query = useCatalogPages(
    ["selector", list, game, locale, regionId, effective],
    `/catalogs/${list}`,
    { game, locale, regionId, search: effective || undefined },
    listSchema,
    open && settled,
  );
  const selected = useCatalogQuery(
    ["item", list, value, locale],
    `/catalogs/${list}/${value}?locale=${locale}`,
    itemSchema,
    !!value,
  );
  // The detail read stays authoritative; a just-picked row only prevents a blank input meanwhile.
  const current =
    selected.data?.data.data ??
    (picked?.id === value && picked?.display.requestedLocale === locale ? picked : undefined);
  const hasValue = !!value || !!extraRow?.active;
  const incompatible = !!current && !compatibleSelection(current, game, regionId);
  const currentDisplay = current ? selectorDisplay(current) : undefined;
  const fallback = !!currentDisplay?.englishFallback && draft === null;
  const hiddenMark = !!current?.display.hidden && draft === null;

  // While the search is unsettled or loading no catalog row exists, so a stale one cannot be taken.
  const ready = settled && !query.isPending;
  const items = ready ? (query.data?.pages.flatMap((p) => p.data.data.items) ?? []) : [];
  const failed = ready && query.isError;
  const rows = comboboxRows({
    items,
    game,
    regionId,
    hasMore: ready && query.hasNextPage,
    failed,
    extra: !!extraRow,
  });
  const noRows = ready && query.isSuccess && !rows.some((row) => row.kind === "item");
  const shownActive = ready ? clampActive(active, rows.length) : -1;
  const activeRow = open ? rows[shownActive] : undefined;
  const optionId = (row: ComboboxRow) => `${id}-option-${row.key}`;
  const activeId = activeRow ? optionId(activeRow) : undefined;
  const listRendered = open && rows.length > 0;

  useEffect(() => {
    if (open && ready) listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, ready]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const close = () => {
    setOpen(false);
    setDraft(null);
    setEffective("");
    setActive(0);
  };
  const activate = (row: ComboboxRow, index: number) => {
    if (row.kind === "item") {
      setPicked(row.item);
      onChange(row.item.id);
      close();
    } else if (row.kind === "more") {
      // The first newly loaded row takes this row's place, so the active index stays put.
      if (!query.isFetchingNextPage) {
        setActive(index);
        void query.fetchNextPage();
      }
    } else if (row.kind === "refresh") void query.refetch();
    else {
      extraRow?.onChoose(typed);
      close();
    }
  };
  // Selecting the displayed value makes the next keystroke replace it instead of appending. A
  // frame later, because the browser collapses an existing selection after the mouse release.
  const openList = (index = 0) => {
    setOpen(true);
    setActive(index);
    if (draft !== null) return;
    const displayed = shown;
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input && document.activeElement === input && input.value === displayed) input.select();
    });
  };
  const clear = () => {
    setPicked(null);
    close();
    if (hasValue) onChange(null);
    inputRef.current?.focus();
  };
  const leave = () => {
    if (draft === null && !open) return;
    if (leaveAction(draft, hasValue) === "clear") onChange(null);
    close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Let IME confirmation finish; otherwise Enter must not submit a consumer form.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      if (!open) openList(delta === 1 ? 0 : Number.MAX_SAFE_INTEGER);
      else if (ready) setActive(moveActive(shownActive, delta, rows.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeRow) activate(activeRow, shownActive);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const shown = draft ?? (extraRow?.active ? extraRow.label : (currentDisplay?.text ?? ""));
  const canClear = hasValue || !!draft;
  const describedBy = [
    fallback && `${id}-fallback`,
    hiddenMark && `${id}-hidden`,
    incompatible && `${id}-historical`,
    selected.isError && `${id}-read-error`,
  ]
    .filter(Boolean)
    .join(" ");
  const status = !ready
    ? t("loading")
    : failed
      ? ""
      : noRows
        ? t("empty")
        : t("found", { count: query.data?.pages[0]?.data.data.total ?? 0 });

  return (
    <div className="stack catalog-selector">
      <Label htmlFor={id}>{label}</Label>
      <div className="catalog-combobox">
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          className="catalog-input"
          autoComplete="off"
          maxLength={128}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listRendered ? `${id}-list` : undefined}
          aria-activedescendant={activeId}
          aria-busy={selected.isFetching || undefined}
          aria-describedby={describedBy || undefined}
          data-historical={incompatible || undefined}
          data-clear={canClear || undefined}
          data-chips={Number(fallback) + Number(hiddenMark) || undefined}
          placeholder={t(value && selected.isPending ? "loading" : "choose")}
          title={draft === null && !extraRow?.active ? currentDisplay?.text : undefined}
          value={shown}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onClick={() => {
            if (!open) openList();
          }}
          onBlur={leave}
          onKeyDown={onKeyDown}
        />
        <span className="catalog-adornments">
          {fallback && (
            <>
              <span
                className="catalog-chip"
                aria-hidden="true"
                title={t("fallback")}
                onMouseDown={keepFocus}
                onClick={() => {
                  // A disabled field refuses focus, even when only its fieldset is disabled.
                  inputRef.current?.focus();
                  if (!open && document.activeElement === inputRef.current) openList();
                }}
              >
                EN
              </span>
              <span id={`${id}-fallback`} className="visually-hidden">
                {t("fallback")}
              </span>
            </>
          )}
          {hiddenMark && (
            <span id={`${id}-hidden`} className="catalog-chip">
              {t("hidden")}
            </span>
          )}
          {canClear && (
            <button
              type="button"
              className="catalog-clear"
              aria-label={t("clearField", { label })}
              // A draft or erased text is resolved when focus leaves, so Tab must not land here.
              tabIndex={hasValue && draft === null ? undefined : -1}
              onMouseDown={keepFocus}
              onClick={clear}
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          <svg
            className="catalog-chevron"
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
        </span>
        {open && (
          // biome-ignore lint/a11y/noStaticElementInteractions: mouse down only keeps input focus.
          <div className="catalog-popup" onMouseDown={keepFocus}>
            <span className="visually-hidden" role="status">
              {status}
            </span>
            {!ready && <p className="catalog-popup-note">{t("loading")}</p>}
            {failed && (
              <p className="catalog-popup-note catalog-popup-error" role="alert">
                {t("readError")}
              </p>
            )}
            {noRows && <p className="catalog-popup-note">{t("empty")}</p>}
            {rows.length > 0 && (
              <div
                ref={listRef}
                id={`${id}-list`}
                className="catalog-options"
                role="listbox"
                aria-label={label}
              >
                {rows.map((row, index) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard stays on the combobox input (aria-activedescendant).
                  <div
                    key={row.key}
                    id={optionId(row)}
                    className={`catalog-option catalog-option-${row.kind}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === shownActive}
                    aria-disabled={
                      row.kind === "more" && query.isFetchingNextPage ? true : undefined
                    }
                    onClick={() => activate(row, index)}
                  >
                    {row.kind === "item" && (
                      <>
                        <span className="catalog-option-name">
                          {selectorDisplay(row.item).text}
                          {selectorDisplay(row.item).englishFallback && (
                            <>
                              {" "}
                              <span
                                className="catalog-chip"
                                aria-hidden="true"
                                title={t("fallback")}
                              >
                                EN
                              </span>
                              <span className="visually-hidden">{t("fallback")}</span>
                            </>
                          )}
                        </span>
                        <code title={row.item.code}>{row.item.code}</code>
                      </>
                    )}
                    {row.kind === "more" && (
                      <span className="catalog-option-name">
                        {t(query.isFetchingNextPage ? "loading" : "more")}
                      </span>
                    )}
                    {row.kind === "refresh" && (
                      <span className="catalog-option-name">{t("refresh")}</span>
                    )}
                    {row.kind === "extra" && (
                      <>
                        <span className="catalog-option-name">{extraRow?.label}</span>
                        {typed && <code title={typed}>«{typed}»</code>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {incompatible && (
        <p id={`${id}-historical`} className="catalog-note">
          {t("historical")}
        </p>
      )}
      {selected.isError && (
        <p id={`${id}-read-error`} className="catalog-note">
          {t("historyError")}
        </p>
      )}
    </div>
  );
}
