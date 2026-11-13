import { Fragment, type KeyboardEvent, useId, useRef, useState } from "react";
import type { Matcher, Modifiers } from "react-day-picker";
import { enUS } from "react-day-picker/locale/en-US";
import { ru } from "react-day-picker/locale/ru";
import { useTranslation } from "react-i18next";
import { cn } from "../cn.js";
import { Calendar } from "./calendar.js";
import {
  clampSegment,
  composeWallClock,
  type DateLocale,
  decodeIncomplete,
  emptyTime,
  formatDateText,
  incompleteValue,
  isoDate,
  type Precision,
  parseDateText,
  type Segment,
  segmentSpec,
  segmentsFor,
  splitWallClock,
  stepSegment,
  type TimeParts,
  todayIn,
  typeDigits,
} from "./date-time.js";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./popover.js";
import { Button } from "./primitives.js";
import "./date-time-field.css";

export type DateTimeFieldProps = {
  /** Id of the date text input; the form keeps `<Label htmlFor={id}>`. */
  id: string;
  /** Accessible field name used for the calendar button, calendar and time group. */
  fieldName: string;
  /** "" | "YYYY-MM-DDTHH:mm[:ss[.SSS]]" | an incomplete-entry marker. */
  value: string;
  /** Called only for user edits, never on mount or re-render. */
  onChange: (value: string) => void;
  /** IANA zone shown next to the field and used for the calendar's today. */
  timeZone: string;
  precision?: Precision;
  /** Inclusive "YYYY-MM-DD" bounds for calendar days. */
  min?: string | undefined;
  max?: string | undefined;
  required?: boolean;
  "aria-required"?: boolean | "true" | "false";
  invalid?: boolean;
  "aria-describedby"?: string | undefined;
  disabled?: boolean;
};

type Display = { date: string } & TimeParts;
type FieldState = { value: string; locale: DateLocale; display: Display; dateBlurred: boolean };

function deriveDisplay(value: string, locale: DateLocale, precision: Precision): Display {
  if (!value) return { date: "", ...emptyTime };
  const incomplete = decodeIncomplete(value);
  if (incomplete) return incomplete;
  const split = splitWallClock(value);
  if (!split) return { date: value, ...emptyTime };
  return {
    date: formatDateText(split.date, locale),
    hours: split.hours,
    minutes: split.minutes,
    seconds: precision === "minute" ? "" : split.seconds,
    milliseconds: precision === "millisecond" ? split.milliseconds : "",
  };
}

function displayValue(display: Display, locale: DateLocale, precision: Precision): string {
  const segments = segmentsFor(precision);
  if (!display.date.trim() && segments.every((segment) => !display[segment])) return "";
  const date = parseDateText(display.date, locale);
  return (
    (date && composeWallClock({ ...display, date }, precision)) ??
    incompleteValue(display.date, display)
  );
}

// Calendar days are local Date objects for the wall-clock date; only Y/M/D are read back.
function localDate(iso: string) {
  const [year = 1, month = 1, day = 1] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setFullYear(year);
  return date;
}
const fromLocalDate = (date: Date) =>
  isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.5 6.5h11M5.5 2v3M10.5 2v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Shared RU/EN date and 24-hour time field: a typed date with an optional calendar
 * (shadcn "Input" date-picker layout) and hour/minute(/second/millisecond) segments.
 */
export function DateTimeField({
  id,
  fieldName,
  value,
  onChange,
  timeZone,
  precision = "minute",
  min,
  max,
  required,
  "aria-required": ariaRequired,
  invalid,
  "aria-describedby": describedBy,
  disabled,
}: DateTimeFieldProps) {
  const { t, i18n } = useTranslation("core");
  const locale: DateLocale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const segments = segmentsFor(precision);
  const ids = useId();
  const hintId = `${ids}-format`;
  const zoneId = `${ids}-zone`;
  const inputRef = useRef<HTMLInputElement>(null);
  const segmentRefs = useRef<Partial<Record<Segment, HTMLInputElement | null>>>({});
  const returnFocus = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState<string>();
  const [state, setState] = useState<FieldState>(() => ({
    value,
    locale,
    display: deriveDisplay(value, locale, precision),
    dateBlurred: false,
  }));
  // Derive the display from props during render: an external value change re-reads it, and a
  // language change reformats a valid typed date.
  let current = state;
  if (state.value !== value) {
    current = {
      value,
      locale,
      display: deriveDisplay(value, locale, precision),
      dateBlurred: false,
    };
    setState(current);
  } else if (state.locale !== locale) {
    const date = parseDateText(state.display.date, state.locale);
    current = {
      ...state,
      locale,
      display: { ...state.display, date: date ? formatDateText(date, locale) : state.display.date },
    };
    setState(current);
  }
  const { display } = current;
  const parsedDate = parseDateText(display.date, locale);
  const dateError = current.dateBlurred && display.date.trim() !== "" && !parsedDate;
  const invalidAttr = invalid || dateError || undefined;
  const requiredAttr = ariaRequired === true || ariaRequired === "true" || required || undefined;
  const describe = (...extra: string[]) =>
    [describedBy, ...extra].filter(Boolean).join(" ") || undefined;

  function update(next: Display) {
    const nextValue = displayValue(next, locale, precision);
    setState({ ...current, value: nextValue, display: next });
    if (nextValue !== value) onChange(nextValue);
  }
  function showDisplay(next: Display, dateBlurred = current.dateBlurred) {
    setState({ ...current, display: next, dateBlurred });
  }
  function focusSegment(index: number) {
    const segment = segments[index];
    if (segment) segmentRefs.current[segment]?.focus();
  }
  function openCalendar(next: boolean) {
    if (next) setToday(todayIn(timeZone, Date.now()));
    setOpen(next);
  }
  function pick(date: Date | undefined) {
    const iso = date && fromLocalDate(date);
    if (!iso) return;
    returnFocus.current = true;
    setOpen(false);
    update({ ...display, date: formatDateText(iso, locale) });
  }
  function typeInto(segment: Segment, index: number, raw: string) {
    const before = display[segment];
    const digits = raw.replace(/\D/g, "");
    if (digits === before) return;
    let text: string;
    let complete = false;
    if (raw.length < before.length) text = digits.slice(0, segmentSpec[segment].length);
    else {
      const continues = digits.startsWith(before) && before.length < segmentSpec[segment].length;
      ({ text, complete } = continues
        ? typeDigits(before, digits.slice(before.length), segment)
        : typeDigits("", digits, segment));
    }
    update({ ...display, [segment]: text });
    if (complete) focusSegment(index + 1);
  }
  function segmentKey(segment: Segment, index: number, event: KeyboardEvent<HTMLInputElement>) {
    const text = display[segment];
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      update({
        ...display,
        [segment]: stepSegment(text, event.key === "ArrowUp" ? 1 : -1, segment),
      });
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusSegment(index - 1);
    } else if (event.key === "ArrowRight" && index < segments.length - 1) {
      event.preventDefault();
      focusSegment(index + 1);
    } else if (event.key === "Backspace" && !text && index > 0) {
      event.preventDefault();
      focusSegment(index - 1);
    } else if ([":", ".", ","].includes(event.key)) {
      event.preventDefault();
      if (text) focusSegment(index + 1);
    }
  }

  const disabledDays: Matcher[] = [];
  if (min) disabledDays.push({ before: localDate(min) });
  if (max) disabledDays.push({ after: localDate(max) });
  const dayFormat = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const dayLabel = (date: Date, modifiers?: Modifiers) =>
    [
      modifiers?.today && t("dateTime.today"),
      dayFormat.format(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
      modifiers?.selected && t("dateTime.selected"),
    ]
      .filter(Boolean)
      .join(", ");

  return (
    <Popover open={open} onOpenChange={openCalendar} modal>
      <div className="date-time-field" data-precision={precision}>
        <PopoverAnchor asChild>
          <div className="date-time-date">
            <input
              ref={inputRef}
              id={id}
              className="input date-time-date-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("dateTime.datePlaceholder")}
              value={display.date}
              required={required}
              disabled={disabled}
              aria-required={requiredAttr}
              aria-invalid={invalidAttr}
              aria-describedby={describe(hintId)}
              onChange={(event) => update({ ...display, date: event.target.value })}
              onBlur={() =>
                showDisplay(
                  {
                    ...display,
                    date: parsedDate ? formatDateText(parsedDate, locale) : display.date,
                  },
                  true,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openCalendar(true);
                }
              }}
            />
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="date-time-trigger"
                disabled={disabled}
                aria-label={t("dateTime.chooseDate", { field: fieldName })}
                aria-describedby={describedBy}
              >
                <CalendarIcon />
              </Button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="date-time-popover"
          aria-label={t("dateTime.calendar", { field: fieldName })}
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            // Focus the selected day, else today, else the first enabled day. This runs after the
            // popover focus scope pauses an enclosing dialog scope, which would otherwise take
            // focus back from a day focused during the first render.
            event.preventDefault();
            contentRef.current
              ?.querySelector<HTMLElement>('.calendar-day-button[tabindex="0"]')
              ?.focus();
          }}
          onEscapeKeyDown={() => {
            returnFocus.current = true;
          }}
          onCloseAutoFocus={(event) => {
            // Escape and a picked day return to the typed date, not to the calendar button.
            if (!returnFocus.current) return;
            returnFocus.current = false;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Calendar
            mode="single"
            required
            fixedWeeks
            selected={parsedDate ? localDate(parsedDate) : undefined}
            defaultMonth={localDate(parsedDate ?? today ?? todayIn(timeZone, 0))}
            onSelect={pick}
            locale={locale === "en" ? enUS : ru}
            disabled={disabledDays}
            {...(today ? { today: localDate(today) } : {})}
            {...(min ? { startMonth: localDate(min) } : {})}
            {...(max ? { endMonth: localDate(max) } : {})}
            labels={{
              labelNav: () => t("dateTime.monthNavigation"),
              labelPrevious: () => t("dateTime.previousMonth"),
              labelNext: () => t("dateTime.nextMonth"),
              labelDayButton: dayLabel,
              labelGridcell: dayLabel,
            }}
          />
        </PopoverContent>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a second visible field title. */}
        <div
          className={cn("input date-time-time", disabled && "date-time-disabled")}
          role="group"
          aria-label={t("dateTime.time", { field: fieldName })}
          aria-describedby={zoneId}
          data-invalid={invalidAttr}
        >
          {segments.map((segment, index) => {
            const text = display[segment];
            return (
              <Fragment key={segment}>
                {index > 0 && (
                  <span className="date-time-separator" aria-hidden="true">
                    {segment === "milliseconds" ? "." : ":"}
                  </span>
                )}
                <input
                  ref={(element) => {
                    segmentRefs.current[segment] = element;
                  }}
                  className="date-time-segment"
                  data-segment={segment}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  role="spinbutton"
                  placeholder={t(`dateTime.${segment}Placeholder`)}
                  value={text}
                  disabled={disabled}
                  required={required && index < 2}
                  aria-label={t(`dateTime.${segment}`)}
                  aria-valuemin={0}
                  aria-valuemax={segmentSpec[segment].max}
                  aria-valuenow={text ? Number(text) : undefined}
                  aria-valuetext={text ? clampSegment(text, segment) : t("dateTime.empty")}
                  aria-required={(requiredAttr && index < 2) || undefined}
                  aria-invalid={invalidAttr}
                  aria-describedby={describe(zoneId)}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => typeInto(segment, index, event.target.value)}
                  onKeyDown={(event) => segmentKey(segment, index, event)}
                  onBlur={() => {
                    const padded = clampSegment(text, segment);
                    if (padded !== text) showDisplay({ ...display, [segment]: padded });
                  }}
                />
              </Fragment>
            );
          })}
        </div>
        <span id={zoneId} className="date-time-zone">
          <span className="visually-hidden">{t("dateTime.timeZone")}: </span>
          {timeZone}
        </span>
        <span id={hintId} className="visually-hidden">
          {t("dateTime.dateFormat")}
        </span>
      </div>
    </Popover>
  );
}
