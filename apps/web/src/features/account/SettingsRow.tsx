import type { ReactNode } from "react";
import "./account.css";

/**
 * One settings row: a titled label with an optional hint, the current value and an action,
 * plus optional full-width content (for example a disclosed form). The title is a real
 * heading so screen-reader users can move between settings; controls reference
 * `${id}-title` and `${id}-hint` for their names and descriptions.
 */
export function SettingsRow({
  id,
  title,
  level = 2,
  hint,
  value,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  level?: 2 | 3;
  hint?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <div className="settings-row-text">
          <Heading id={`${id}-title`} className="settings-row-title">
            {title}
          </Heading>
          {hint && (
            <p id={`${id}-hint`} className="settings-row-hint">
              {hint}
            </p>
          )}
        </div>
        {value && <div className="settings-row-value">{value}</div>}
        {action && <div className="settings-row-action">{action}</div>}
      </div>
      {children}
    </div>
  );
}
