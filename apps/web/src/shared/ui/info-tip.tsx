import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";

/**
 * A small ⓘ button that opens a short explanation on click, tap or keyboard. Important hints live
 * here instead of in small print; the label names the button for assistive technology.
 */
export function InfoTip({
  label,
  title,
  children,
}: {
  label: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger type="button" className="info-tip-trigger" aria-label={label}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </PopoverTrigger>
      <PopoverContent className="info-tip-content">
        {title && <strong>{title}</strong>}
        {children}
      </PopoverContent>
    </Popover>
  );
}
