import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";

// Long enough to cross the gap between the icon and the explanation without it closing.
const CLOSE_DELAY_MS = 150;

/**
 * A small circled "i" button with a short explanation. A mouse shows it on hover; a click keeps it open, and
 * a tap or the keyboard opens it too, so touch screens and assistive technology reach the same text. The label
 * names the button for assistive technology.
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
  const [open, setOpen] = useState(false);
  // A click turns a hover preview into an explanation that stays until Escape or an outside click.
  const pinned = useRef(false);
  // A hover preview never takes focus, so its close must not move focus onto the button either.
  const hoverClosed = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const hoverStart = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    setOpen(true);
  };
  const hoverEnd = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || pinned.current) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      hoverClosed.current = true;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        pinned.current = next;
        hoverClosed.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        type="button"
        className="info-tip-trigger"
        aria-label={label}
        onPointerEnter={hoverStart}
        onPointerLeave={hoverEnd}
        onClick={(event) => {
          // Already shown by hover: the click pins it instead of toggling it closed.
          if (open && !pinned.current) {
            event.preventDefault();
            cancelClose();
            pinned.current = true;
          }
        }}
      >
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
      <PopoverContent
        className="info-tip-content"
        onPointerEnter={hoverStart}
        onPointerLeave={hoverEnd}
        // Keyboard and tap opens move focus into the text so a screen reader reads it; hover leaves focus alone.
        onOpenAutoFocus={(event) => {
          if (!pinned.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (hoverClosed.current) event.preventDefault();
          hoverClosed.current = false;
        }}
      >
        {title && <strong>{title}</strong>}
        {children}
      </PopoverContent>
    </Popover>
  );
}
