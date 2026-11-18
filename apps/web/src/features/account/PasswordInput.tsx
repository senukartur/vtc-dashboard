import { Eye, EyeOff } from "lucide-react";
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
        {visible ? (
          <EyeOff size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" />
        ) : (
          <Eye size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" />
        )}
      </button>
    </div>
  );
}
