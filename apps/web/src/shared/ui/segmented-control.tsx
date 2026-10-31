// Project-authored segmented control: a named group (native fieldset) of toggle buttons where
// exactly one option is pressed. Each option stays a native button in the normal Tab order.
import { cn } from "../cn.js";
import type { ControlSize } from "./variants.js";

export type SegmentedOption<T extends string> = { value: T; label: string };

type GroupName = { "aria-label": string } | { "aria-labelledby": string };

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "xs",
  className,
  ...name
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: ControlSize;
  className?: string;
} & GroupName) {
  return (
    <fieldset
      data-slot="segmented-control"
      className={cn("segmented", size === "sm" && "segmented-sm", className)}
      {...name}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-item"
          aria-pressed={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
