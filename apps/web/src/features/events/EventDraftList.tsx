import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog.js";
import { Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { EventFailureView } from "./components.js";
import { eventListCopy } from "./event-list-copy.js";
import { useEventListLocale } from "./event-list-queries.js";
import type { DTO } from "./model.js";
import { useEventStage2Command } from "./stage-2-queries.js";
import { type EventStage2Command, eventStage2Commands } from "./stage-2-transport.js";
import { compactTime } from "./view-model.js";

type Draft = DTO["EventStage2Draft"];
type DiscardCommand = EventStage2Command<"EventStage2EnvelopeDraftDeletion">;
type DiscardTarget = { draft: Draft; trigger: HTMLButtonElement };

export function EventDraftList({
  rows,
  timezone,
  focusHeading,
}: {
  rows: DTO["EventStage2AdminList"]["items"] | undefined;
  timezone: string;
  focusHeading: () => void;
}) {
  const locale = useEventListLocale();
  const copy = eventListCopy[locale];
  const { t } = useTranslation("events");
  const [target, setTarget] = useState<DiscardTarget | null>(null);
  const [notice, setNotice] = useState<"discarded" | "draftChanged" | null>(null);
  const drafts = rows?.filter((row) => row.lifecycle === "draft");

  return (
    <>
      {notice === "discarded" && <p role="status">{copy.discarded}</p>}
      {notice === "draftChanged" && <p role="alert">{copy.draftChanged}</p>}
      {drafts &&
        (drafts.length ? (
          <ul className="events-list event-draft-list">
            {drafts.map((draft) => {
              const title = draft.fields.title?.trim() || copy.untitled;
              return (
                <li className="events-row" key={draft.id}>
                  <div className="events-row-body">
                    <h2 className="events-row-title">{title}</h2>
                    <p className="events-row-meta">
                      {draft.fields.game && (
                        <span className="events-game">{draft.fields.game.toUpperCase()}</span>
                      )}
                      <span>
                        {copy.updated}{" "}
                        <time dateTime={draft.updatedAt}>
                          {compactTime(draft.updatedAt, locale, timezone)}
                        </time>
                      </span>
                      {draft.fields.startsAt && (
                        <span>
                          {t("startsAt")}{" "}
                          <time dateTime={draft.fields.startsAt}>
                            {compactTime(draft.fields.startsAt, locale, timezone)}
                          </time>
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="event-draft-actions">
                    <Button asChild>
                      <Link
                        to={`/account/events/new?${new URLSearchParams({ draftId: draft.id })}`}
                      >
                        {copy.continueDraft}
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      aria-label={`${copy.discard}: ${title}`}
                      disabled={!Number.isSafeInteger(draft.version) || draft.version < 1}
                      onClick={(event) => {
                        setNotice(null);
                        setTarget({ draft, trigger: event.currentTarget });
                      }}
                    >
                      {copy.discard}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="event-list-empty">{copy.draftsEmpty}</p>
        ))}
      {target && (
        <DiscardDraft
          target={target}
          title={target.draft.fields.title?.trim() || copy.untitled}
          focusHeading={focusHeading}
          onClose={(outcome) => {
            setNotice(outcome);
            setTarget(null);
          }}
        />
      )}
    </>
  );
}

function DiscardDraft({
  target,
  title,
  focusHeading,
  onClose,
}: {
  target: DiscardTarget;
  title: string;
  focusHeading: () => void;
  onClose: (outcome: "discarded" | "draftChanged" | null) => void;
}) {
  const locale = useEventListLocale();
  const copy = eventListCopy[locale];
  const { t } = useTranslation("events");
  const command = useEventStage2Command<"EventStage2EnvelopeDraftDeletion">();
  const attempt = useRef<DiscardCommand | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const focusList = useRef(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function discard() {
    if (running.current || retryAt > Date.now()) return;
    running.current = true;
    setFailure(null);
    try {
      attempt.current ??= eventStage2Commands.discardDraft(
        target.draft.id,
        `"v${target.draft.version}"`,
      );
      await command.run(attempt.current);
      focusList.current = true;
      onClose("discarded");
    } catch (error) {
      if (error instanceof AccountFailure) {
        if (error.kind === "conflict") {
          focusList.current = true;
          onClose("draftChanged");
          return;
        }
        if (error.retryAfter) {
          const current = Date.now();
          setNow(current);
          setRetryAt(current + error.retryAfter * 1000);
        }
        if (!["uncertain", "unavailable", "limited"].includes(error.kind)) attempt.current = null;
      }
      setFailure(error);
    } finally {
      running.current = false;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !running.current) onClose(null);
      }}
    >
      <DialogContent
        className="event-dialog event-discard-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keep.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (focusList.current || !target.trigger.isConnected) focusHeading();
          else target.trigger.focus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{copy.discardTitle.replace("{{title}}", () => title)}</DialogTitle>
        <DialogDescription>{copy.discardDescription}</DialogDescription>
        <EventFailureView error={failure} seconds={seconds} />
        <div className="event-discard-actions">
          <Button
            ref={keep}
            type="button"
            variant="outline"
            aria-disabled={command.pending || undefined}
            onClick={() => {
              if (!running.current) onClose(null);
            }}
          >
            {copy.keepDraft}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="event-discard-confirm"
            aria-disabled={command.pending || seconds > 0 || undefined}
            onClick={() => void discard()}
          >
            {command.pending ? copy.discarding : failure ? t("retry") : copy.discard}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
