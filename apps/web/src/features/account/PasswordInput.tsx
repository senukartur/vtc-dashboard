import type { ComponentProps } from "react";
import { Input } from "../../shared/ui/primitives.js";
import "./auth.css";

// The toggle keeps one fixed accessible name and reports its state through aria-pressed
// (WAI-ARIA toggle button). Swapping `type` on the same input keeps its value, caret, name,
// id and autocomplete, so password managers and the form keep working.
export function PasswordInput({
  id,
  visible,
  onToggle,
  toggleLabel,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "id"> & {
  id: string;
  visible: boolean;
  onToggle: () => void;
  toggleLabel: string;
}) {
  return (
    <div className="password-field">
      <Input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={toggleLabel}
        aria-pressed={visible}
        aria-controls={id}
        onClick={onToggle}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {visible ? (
            <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          ) : (
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6" />
          )}
        </svg>
      </button>
    </div>
  );
}
