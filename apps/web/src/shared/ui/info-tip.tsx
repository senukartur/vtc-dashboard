import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js";

// Long enough to cross the gap between the icon and the explanation without it closing.
const CLOSE_DELAY_MS = 150;

/**
 * A small circled "i" button with a short explanation. A mouse shows it on hover; a click keeps it open, and
 * a tap or the keyboard opens it too, so touch screens and assistive technology reach the same text. The label
 * names the button for assistive technology. After Escape, an outside click or a click closes the tip, a hover
 * does not reopen it until the pointer moves away from the button.
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
  const closeTimer = useRef<number | undefined>(undefined);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const trigger = useRef<HTMLButtonElement>(null);
  // Chromium sends pointer enter/leave on its own after a layout or scroll change under a resting pointer, with
  // no pointermove. So after an explicit close only a real pointermove away from the button allows hover again;
  // a leave does not, since a layout-caused leave and enter pair would release and reopen at once.
  const hoverBlocked = useRef(false);
  const stopWatching = useRef<(() => void) | undefined>(undefined);
  const allowHover = () => {
    hoverBlocked.current = false;
    stopWatching.current?.();
    stopWatching.current = undefined;
  };
  const blockHover = () => {
    if (hoverBlocked.current) return;
    hoverBlocked.current = true;
    const watch = (event: Event) => {
      if (event.target instanceof Node && trigger.current?.contains(event.target)) return;
      allowHover();
    };
    document.addEventListener("pointermove", watch, true);
    stopWatching.current = () => document.removeEventListener("pointermove", watch, true);
  };
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
      hoverBlocked.current = false;
      stopWatching.current?.();
      stopWatching.current = undefined;
    },
    [],
  );

  const hoverStart = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || hoverBlocked.current) return;
    cancelClose();
    setOpen(true);
  };
  const hoverEnd = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || pinned.current) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        pinned.current = next;
        if (next) allowHover();
        else blockHover();
        setOpen(next);
      }}
    >
      <PopoverTrigger
        ref={trigger}
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
        // Focus returns to the button only when it was inside the removed text; focus elsewhere, such as an
        // input typed into during a hover preview, stays where it is.
        onCloseAutoFocus={(event) => {
          const active = document.activeElement;
          if (active && active !== document.body) event.preventDefault();
        }}
      >
        {title && <strong>{title}</strong>}
        {children}
      </PopoverContent>
    </Popover>
  );
}
