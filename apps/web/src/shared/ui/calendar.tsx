// Adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
// Class names map to semantic calendar-* rules in date-time-field.css; the react-day-picker
// stylesheet is not imported.
import { type ComponentProps, useEffect, useRef } from "react";
import {
  type ChevronProps,
  type DayButton,
  DayPicker,
  formatCaption,
  getDefaultClassNames,
  type RootProps,
} from "react-day-picker";
import { cn } from "../cn.js";
import { Button } from "./primitives.js";

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  formatters,
  components,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("calendar", className)}
      captionLayout={captionLayout}
      formatters={{
        // Russian month names are lower case in date-fns; a caption starts with a capital.
        formatCaption: (month, options, dateLib) => {
          const caption = formatCaption(month, options, dateLib);
          return caption.charAt(0).toLocaleUpperCase() + caption.slice(1);
        },
        ...formatters,
      }}
      classNames={{
        root: cn("calendar-root", defaults.root),
        months: cn("calendar-months", defaults.months),
        month: cn("calendar-month", defaults.month),
        nav: cn("calendar-nav", defaults.nav),
        button_previous: cn("button button-ghost calendar-nav-button", defaults.button_previous),
        button_next: cn("button button-ghost calendar-nav-button", defaults.button_next),
        month_caption: cn("calendar-caption", defaults.month_caption),
        caption_label: cn("calendar-caption-label", defaults.caption_label),
        month_grid: cn("calendar-grid", defaults.month_grid),
        weekdays: cn("calendar-weekdays", defaults.weekdays),
        weekday: cn("calendar-weekday", defaults.weekday),
        week: cn("calendar-week", defaults.week),
        day: cn("calendar-day", defaults.day),
        today: cn("calendar-today", defaults.today),
        outside: cn("calendar-outside", defaults.outside),
        disabled: cn("calendar-disabled", defaults.disabled),
        hidden: cn("calendar-hidden", defaults.hidden),
        ...classNames,
      }}
      components={{
        Root: CalendarRoot,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

// Components stay at module level: DayPicker remounts a slot whose component identity changes.
function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
}

function CalendarChevron({ className, orientation }: ChevronProps) {
  return (
    <svg
      className={cn("calendar-chevron", className)}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={orientation === "left" ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const defaults = getDefaultClassNames();
  const ref = useRef<HTMLButtonElement>(null);
  // DayPicker moves keyboard focus by marking the focused day.
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <Button
      ref={ref}
      variant="ghost"
      data-day={day.isoDate}
      data-selected-single={modifiers.selected || undefined}
      data-today={modifiers.today || undefined}
      data-outside={modifiers.outside || undefined}
      className={cn("calendar-day-button", defaults.day_button, className)}
      {...props}
    />
  );
}
