import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input, Label } from "../ui/primitives.js";
import {
  type ComboboxRow,
  clampActive,
  leaveAction,
  moveActive,
  optionRows,
  searchTerm,
} from "./combobox.js";
import { depotListSchema, type Game } from "./contracts.js";
import { type DepotCompanyOption, depotCompanyOptions, depotOptionText } from "./depots.js";
import { useCatalogPages } from "./queries.js";
import "./catalog-selector.css";

const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * One editable ARIA combobox for a company with a depot in a city, shared by every depot picker.
 * Typing searches company names and codes through the server after a debounce and pages inside
 * the list. The value is the company's canonical ID; the caller resolves and checks the chosen one.
 */
export function DepotSelector({
  id: givenId,
  label,
  game,
  cityId,
  value,
  selected,
  selectedPending = false,
  onChange,
  disabled = false,
  describedBy: callerDescription,
  emptyText,
}: {
  /** The input ID, for a caller that refers to the field. */
  id?: string | undefined;
  label: string;
  game: Game;
  /** No city means no company can be offered; the field stays disabled. */
  cityId: string | undefined;
  value: string | null;
  /** The resolved chosen company, when the caller has confirmed it. */
  selected: DepotCompanyOption | undefined;
  selectedPending?: boolean | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
  /** Shown when the city has no company to offer and nothing was typed. */
  emptyText?: string | undefined;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    generated = useId();
  const id = givenId ?? generated;
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const inputRef = useRef<HTMLInputElement>(null),
    listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null),
    [effective, setEffective] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [picked, setPicked] = useState<DepotCompanyOption | null>(null);
  const term = searchTerm(draft);
  useEffect(() => {
    const timer = window.setTimeout(() => setEffective(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const settled = effective === term;
  const query = useCatalogPages(
    ["depot-selector", game, cityId, locale, effective],
    "/catalogs/depots",
    { game, cityId, locale, search: effective || undefined },
    depotListSchema,
    open && settled && !!cityId,
  );
  // The caller's resolution stays authoritative; a just-picked row only avoids a blank field.
  const current = value
    ? selected?.id === value
      ? selected
      : picked?.id === value
        ? picked
        : undefined
    : undefined;
  const inactive = disabled || !cityId;

  const ready = settled && !query.isPending;
  const options =
    ready && cityId
      ? depotCompanyOptions(query.data?.pages.flatMap((p) => p.data.data.items) ?? [], game, cityId)
      : [];
  const failed = ready && query.isError;
  const rows = optionRows(options, { hasMore: ready && query.hasNextPage, failed });
  const noRows = ready && query.isSuccess && options.length === 0;
  const shownActive = ready ? clampActive(active, rows.length) : -1;
  const activeRow = open ? rows[shownActive] : undefined;
  const optionId = (row: ComboboxRow<DepotCompanyOption>) => `${id}-option-${row.key}`;
  const activeId = activeRow ? optionId(activeRow) : undefined;
  const listRendered = open && rows.length > 0;

  useEffect(() => {
    if (open && ready) listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, ready]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  // A field that loses its city closes, so no list of another city stays open.
  useEffect(() => {
    if (!inactive) return;
    setOpen(false);
    setDraft(null);
    setEffective("");
  }, [inactive]);

  const close = () => {
    setOpen(false);
    setDraft(null);
    setEffective("");
    setActive(0);
  };
  const activate = (row: ComboboxRow<DepotCompanyOption>, index: number) => {
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
  };
  const shown = draft ?? (current ? depotOptionText(current) : "");
  // Selecting the displayed value makes the next keystroke replace it instead of appending.
  const openList = (index = 0) => {
    if (inactive) return;
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
    if (value) onChange(null);
    inputRef.current?.focus();
  };
  const leave = () => {
    if (draft === null && !open) return;
    if (leaveAction(draft, !!value) === "clear") onChange(null);
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

  const canClear = !inactive && (!!value || !!draft);
  const empty = noRows && !effective && emptyText ? emptyText : t("empty");
  const status = !ready
    ? t("loading")
    : failed
      ? ""
      : noRows
        ? empty
        : t("found", { count: query.data?.pages[0]?.data.data.total ?? options.length });

  return (
    <div className="stack catalog-selector depot-selector">
      <Label htmlFor={id}>{label}</Label>
      <div className="catalog-combobox">
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          className="catalog-input"
          autoComplete="off"
          maxLength={128}
          disabled={inactive}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listRendered ? `${id}-list` : undefined}
          aria-activedescendant={activeId}
          aria-busy={selectedPending || undefined}
          aria-describedby={callerDescription}
          data-clear={canClear || undefined}
          placeholder={value && selectedPending ? t("loading") : t("choose")}
          title={draft === null && current ? depotOptionText(current) : undefined}
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
          {canClear && (
            <button
              type="button"
              className="catalog-clear"
              aria-label={t("clearField", { label })}
              // A draft or erased text is resolved when focus leaves, so Tab must not land here.
              tabIndex={value && draft === null ? undefined : -1}
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
            {noRows && <p className="catalog-popup-note">{empty}</p>}
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
                        <span className="catalog-option-name">{row.item.label}</span>
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
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
