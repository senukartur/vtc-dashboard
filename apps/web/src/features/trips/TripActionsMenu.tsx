import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type Ref, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../shared/ui/primitives.js";

/**
 * The trip page actions menu ("More actions"): link to an event, edit the report, refresh, copy
 * the page link and, for staff, open the trip in dispatch. Items appear only when the viewer may
 * use them; the server still authorizes every command.
 */
export function TripActionsMenu({
  triggerRef,
  tripId,
  onLinkEvent,
  editPath,
  dispatchPath,
  refreshing,
  onRefresh,
  onCopied,
}: {
  /** The menu button, where focus returns after a dialog opened from the menu closes. */
  triggerRef: Ref<HTMLButtonElement>;
  tripId: string;
  /** Opens the event dialog. */
  onLinkEvent: (() => void) | null;
  editPath: string | null;
  dispatchPath: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onCopied: (copied: boolean) => void;
}) {
  const { t } = useTranslation("trips"),
    // A dialog opened from the menu takes focus itself; the menu must not move it back.
    opening = useRef(false),
    item = "trip-menu-item";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="trip-menu-trigger"
          aria-label={t("moreActions")}
          title={t("moreActions")}
        >
          <Ellipsis size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="trip-menu-content"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (opening.current) {
              opening.current = false;
              event.preventDefault();
            }
          }}
        >
          {onLinkEvent && (
            <DropdownMenu.Item
              className={item}
              onSelect={() => {
                opening.current = true;
                onLinkEvent();
              }}
            >
              {t("menuLinkEvent")}
            </DropdownMenu.Item>
          )}
          {editPath && (
            <DropdownMenu.Item asChild className={item}>
              <Link to={editPath}>{t("menuEditReport")}</Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={item} disabled={refreshing} onSelect={onRefresh}>
            {t("menuRefresh")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            onSelect={() => {
              const url = `${window.location.origin}/account/trips/${tripId}`;
              // Clipboard access can be denied or missing; either way the result is announced.
              Promise.resolve()
                .then(() => navigator.clipboard.writeText(url))
                .then(
                  () => onCopied(true),
                  () => onCopied(false),
                );
            }}
          >
            {t("menuCopyLink")}
          </DropdownMenu.Item>
          {dispatchPath && (
            <DropdownMenu.Item asChild className={item}>
              <Link to={dispatchPath}>{t("menuOpenDispatch")}</Link>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
