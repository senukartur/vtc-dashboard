import type { TFunction } from "i18next";
import { Info } from "lucide-react";
// Drivers directory building blocks (VTC-145): the search draft, the toolbar, the 30-day hint,
// the relative last-trip day (VTC-160) and the DataTable columns. State and requests live in
// DriversPage.tsx; the hint and the relative day are shared with the driver profile.
import { Tooltip } from "radix-ui";
import { type RefObject, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { formatDecimal, formatQuantity, type Locale } from "../../shared/formatting.js";
import type { DataTableColumn } from "../../shared/ui/DataTable.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/popover.js";
import { Badge, Button, Input, Label, Select } from "../../shared/ui/primitives.js";
import { normalizeSearch, orderedRoles, searchMaxLength } from "../admin/members-model.js";
import {
  activityView,
  type DirectoryEntry,
  type DirectoryRole,
  type DirectorySort,
  type DirectoryTab,
  directoryRoles,
  lastTripView,
  levelView,
} from "./directory-model.js";
import { initial, type Level } from "./model.js";
import { relativeDay } from "./relative-day.js";
import "./drivers-common.css";

/**
 * The search box draft: committed to the URL 300 ms after typing stops; Back/Forward and other
 * URL changes of the committed term restore the draft.
 */
export function useDirectorySearch(committed: string, onCommit: (value: string) => void) {
  const { key } = useLocation();
  const navigation = useNavigationType();
  const [location, setLocation] = useState({ key, committed });
  const [draft, setDraft] = useState(committed);
  if (location.key !== key) {
    setLocation({ key, committed });
    if (location.committed !== committed || navigation === "POP") setDraft(committed);
  }
  const term = normalizeSearch(draft) ?? "";
  const commit = useEffectEvent(onCommit);
  useEffect(() => {
    if (term === committed) return;
    const timer = window.setTimeout(() => commit(term), 300);
    return () => window.clearTimeout(timer);
  }, [term, committed]);
  return { draft, setDraft };
}

/** An info (i) button that explains a figure; the text stays out of the page until asked for. */
export function InfoHint({ label, children }: { label: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="drivers-hint-button" aria-label={label}>
          <Info size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="drivers-hint" side="bottom">
        <p>{children}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Wall clock that advances once a minute, so "today" turns into "yesterday" after midnight. */
export function useMinuteNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * A relative day ("today", "2 days ago") whose absolute date and time show in a tooltip on hover
 * or keyboard focus, and on tap on touch screens; Escape hides it. Null for a malformed value.
 */
export function RelativeDay({
  iso,
  now,
  locale,
  timezone,
}: {
  iso: string;
  now: number;
  locale: Locale;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  // A tap: whether the tooltip was open when the finger touched the day. Radix closes it on the
  // touch and may open it again on the tap's focus; the click then sets the toggled state.
  const tap = useRef<{ wasOpen: boolean } | null>(null);
  const view = relativeDay(iso, now, locale, timezone);
  if (!view) return null;
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <time
            className="drivers-relative"
            dateTime={iso}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users reach the absolute date of this relative day through focus.
            tabIndex={0}
            onPointerDown={(event) => {
              tap.current = event.pointerType === "touch" ? { wasOpen: open } : null;
            }}
            onClick={(event) => {
              // Radix closes a tooltip on click; a tap toggles it instead.
              const touch = tap.current;
              tap.current = null;
              if (!touch) return;
              event.preventDefault();
              setOpen(!touch.wasOpen);
            }}
            onKeyDown={(event) => {
              // Focus already shows the date; Enter or Space toggles it like a tap.
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setOpen((value) => !value);
            }}
          >
            {view.text}
          </time>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="drivers-tooltip"
            side="top"
            sideOffset={4}
            collisionPadding={8}
          >
            {view.absolute}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

type LevelOptions = { levels: Level[] | undefined; pending: boolean; shown: boolean };

function LevelSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  options: LevelOptions;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("drivers");
  const levels = [...(options.levels ?? [])].sort((a, b) => a.position - b.position);
  const known = !value || levels.some((level) => level.id === value);
  return (
    <div className="drivers-filter drivers-filter-level">
      <Label htmlFor={id} className="visually-hidden">
        {label}
      </Label>
      <Select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>
        {levels.map((level) => (
          <option key={level.id} value={level.id}>
            {level.name}
          </option>
        ))}
        {!known && value && (
          <option value={value}>
            {t(options.pending ? "directory.levelLoading" : "directory.levelUnknown")}
          </option>
        )}
      </Select>
    </div>
  );
}

export function DirectoryToolbar({
  tab,
  search,
  searchRef,
  onSearch,
  role,
  ets2Level,
  atsLevel,
  levels,
  onChange,
  canReset,
  onReset,
}: {
  tab: Exclude<DirectoryTab, "invited">;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (value: string) => void;
  role: DirectoryRole | null;
  ets2Level: string | null;
  atsLevel: string | null;
  levels: Record<"ets2" | "ats", LevelOptions>;
  onChange: (name: "role" | "ets2Level" | "atsLevel", value: string) => void;
  canReset: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation("drivers");
  const ids = useId();
  return (
    <fieldset className="drivers-toolbar" aria-label={t("directory.filters")}>
      <div className="drivers-search">
        <Label htmlFor={`${ids}-search`} className="visually-hidden">
          {t("directory.search")}
        </Label>
        <Input
          ref={searchRef}
          id={`${ids}-search`}
          type="search"
          placeholder={t("directory.search")}
          maxLength={searchMaxLength * 2}
          value={search}
          onChange={(event) => onSearch(event.target.value.trimStart())}
        />
      </div>
      {tab === "active" && (
        <div className="drivers-filter drivers-filter-role">
          <Label htmlFor={`${ids}-role`} className="visually-hidden">
            {t("directory.role")}
          </Label>
          <Select
            id={`${ids}-role`}
            value={role ?? ""}
            onChange={(event) => onChange("role", event.target.value)}
          >
            <option value="">{t("directory.anyRole")}</option>
            {directoryRoles.map((item) => (
              <option key={item} value={item}>
                {t(`roles.${item}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {tab === "active" && (levels.ets2.shown || ets2Level) && (
        <LevelSelect
          id={`${ids}-ets2`}
          label={t("directory.ets2Level")}
          value={ets2Level}
          options={levels.ets2}
          onChange={(value) => onChange("ets2Level", value)}
        />
      )}
      {tab === "active" && (levels.ats.shown || atsLevel) && (
        <LevelSelect
          id={`${ids}-ats`}
          label={t("directory.atsLevel")}
          value={atsLevel}
          options={levels.ats}
          onChange={(value) => onChange("atsLevel", value)}
        />
      )}
      {canReset && (
        <Button type="button" variant="ghost" className="drivers-reset" onClick={onReset}>
          {t("directory.reset")}
        </Button>
      )}
    </fieldset>
  );
}

/** "—" that assistive technology reads as "Unavailable", never as zero. */
function Unavailable() {
  const { t } = useTranslation("drivers");
  return (
    <span className="drivers-unavailable">
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{t("directory.unavailable")}</span>
    </span>
  );
}

const gameName = { ets2: "ETS2", ats: "ATS" } as const;

function LevelCell({ entry, game }: { entry: DirectoryEntry; game: "ets2" | "ats" }) {
  const { t } = useTranslation("drivers");
  const view = levelView(entry, game);
  if (view.kind === "unavailable") return <Unavailable />;
  if (view.kind === "none")
    return (
      <Badge className="drivers-level drivers-level-none">
        <span aria-hidden="true">{t("directory.noLevel")}</span>
        <span className="visually-hidden">
          {t("directory.noLevelSpoken", { game: gameName[game] })}
        </span>
      </Badge>
    );
  return <Badge className="drivers-level">{view.name}</Badge>;
}

type SortColumn = {
  key: DirectorySort;
  defaultDirection: "asc" | "desc";
  options: Record<"asc" | "desc", string>;
};

export function directoryColumns({
  tab,
  selfId,
  canManage,
  activitySortable,
  locale,
  timezone,
  now,
  onAccess,
  t,
}: {
  tab: Exclude<DirectoryTab, "invited">;
  selfId: string | undefined;
  canManage: boolean;
  activitySortable: boolean;
  locale: Locale;
  timezone: string;
  /** The minute clock that anchors the relative last-trip days. */
  now: number;
  /** Opens the access panel of a member (members.manage). */
  onAccess: (id: string) => void;
  t: TFunction<"drivers">;
}): DataTableColumn<DirectoryEntry, DirectorySort>[] {
  const sort = (
    key: DirectorySort,
    defaultDirection: "asc" | "desc",
    asc: string,
    desc: string,
  ): SortColumn => ({ key, defaultDirection, options: { asc: t(asc), desc: t(desc) } });
  const activity = (column: SortColumn) => (activitySortable ? { sort: column } : {});
  const columns: (DataTableColumn<DirectoryEntry, DirectorySort> | false)[] = [
    {
      id: "driver",
      header: t("directory.driver"),
      rowHeader: true,
      cardLabel: false,
      className: "drivers-col-driver",
      sort: sort("nickname", "asc", "directory.sortNicknameAsc", "directory.sortNicknameDesc"),
      cell: (entry) => (
        <span className="drivers-driver">
          <span className="drivers-avatar" aria-hidden="true">
            {initial(entry.nickname)}
          </span>
          <span className="drivers-driver-text">
            <Link className="drivers-link" to={`/account/drivers/${entry.id}`}>
              {entry.nickname}
            </Link>
            <span className="drivers-badges">
              {orderedRoles(entry.roles).map((role) => (
                <Badge
                  key={role}
                  size="xs"
                  tone={role === "director" || role === "deputy_director" ? "info" : "neutral"}
                >
                  {t(`roles.${role}`)}
                </Badge>
              ))}
              {entry.id === selfId && (
                <Badge size="xs" tone="info" className="drivers-self">
                  {t("profile.you")}
                </Badge>
              )}
            </span>
          </span>
        </span>
      ),
    },
    tab === "active" && {
      id: "ets2",
      header: "ETS2",
      className: "drivers-col-level",
      cell: (entry) => <LevelCell entry={entry} game="ets2" />,
    },
    tab === "active" && {
      id: "ats",
      header: "ATS",
      className: "drivers-col-level",
      cell: (entry) => <LevelCell entry={entry} game="ats" />,
    },
    {
      id: "distance",
      header: t("directory.distance"),
      align: "end",
      className: "drivers-col-number",
      ...activity(
        sort("distance30d", "desc", "directory.sortDistanceAsc", "directory.sortDistanceDesc"),
      ),
      cell: (entry) => {
        const view = activityView(entry);
        return view.kind === "value" ? (
          <span>{formatQuantity(view.distanceM, "km", locale)}</span>
        ) : (
          <Unavailable />
        );
      },
    },
    {
      id: "trips",
      header: t("directory.trips"),
      align: "end",
      className: "drivers-col-number",
      ...activity(sort("trips30d", "desc", "directory.sortTripsAsc", "directory.sortTripsDesc")),
      cell: (entry) => {
        const view = activityView(entry);
        return view.kind === "value" ? (
          <span>{formatDecimal(String(view.trips), locale)}</span>
        ) : (
          <Unavailable />
        );
      },
    },
    {
      id: "lastTrip",
      header: t("directory.lastTrip"),
      className: "drivers-col-last",
      ...activity(
        sort("lastTrip", "desc", "directory.sortLastTripAsc", "directory.sortLastTripDesc"),
      ),
      cell: (entry) => {
        const view = lastTripView(entry.lastAcceptedTripAt);
        if (view.kind === "unavailable") return <Unavailable />;
        if (view.kind === "none")
          return <span className="drivers-muted">{t("directory.noTrips")}</span>;
        return relativeDay(view.iso, now, locale, timezone) ? (
          <RelativeDay iso={view.iso} now={now} locale={locale} timezone={timezone} />
        ) : (
          <Unavailable />
        );
      },
    },
    canManage && {
      id: "access",
      header: t("directory.access"),
      cardLabel: false,
      className: "drivers-col-access",
      cell: (entry) => (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="drivers-access"
          aria-haspopup="dialog"
          aria-label={t("directory.accessFor", { nickname: entry.nickname })}
          data-access-member={entry.id}
          onClick={() => onAccess(entry.id)}
        >
          {t("directory.access")}
        </Button>
      ),
    },
  ];
  return columns.filter((column): column is DataTableColumn<DirectoryEntry, DirectorySort> =>
    Boolean(column),
  );
}
