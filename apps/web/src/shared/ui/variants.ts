// Button variant shape adapted from shadcn/ui d2fba50; see third_party/shadcn-ui/LICENSE.
// Size variants emit semantic classes; metrics live in shared/styles.css custom properties.
// The base class carries the default `sm` metrics, so raw `.button` links and native selects
// stay compact without opting in.
import { cva } from "class-variance-authority";

export type ControlSize = "xs" | "sm";

export const buttonVariants = cva("button", {
  variants: {
    variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost" },
    size: { xs: "button-xs", sm: "" },
  },
  defaultVariants: { variant: "default", size: "sm" },
});

export const inputVariants = cva("input", {
  variants: { size: { xs: "input-xs", sm: "" } },
  defaultVariants: { size: "sm" },
});

export const selectVariants = cva("select", {
  variants: { size: { xs: "select-xs", sm: "" } },
  defaultVariants: { size: "sm" },
});

export const badgeVariants = cva("badge", {
  variants: { size: { xs: "badge-xs", sm: "" } },
  defaultVariants: { size: "sm" },
});

export const tableVariants = cva("table", {
  variants: { size: { xs: "table-xs", sm: "" } },
  defaultVariants: { size: "sm" },
});
