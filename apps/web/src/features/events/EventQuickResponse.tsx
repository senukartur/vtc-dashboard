import { type FormEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Label } from "../../shared/ui/primitives.js";
import { EventFailureView } from "./components.js";
import {
  type ResponseProjection,
  useEventQuickCommand,
  useEventResponseView,
} from "./event-quick-response.js";
import { responseInput } from "./model.js";

export function EventQuickResponse({
  projection,
  compact = false,
  focusTarget,
}: {
  projection: ResponseProjection;
  compact?: boolean;
  focusTarget: () => void;
}) {
  const { t } = useTranslation(["dashboard", "events"]);
  const id = useId();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const declineButton = useRef<HTMLButtonElement>(null);
  const fallback = useRef(focusTarget);
  const view = useEventResponseView(projection);
  const command = useEventQuickCommand(projection);
  const disabled = view.pending || command.seconds > 0;
  const retryGoing = !!command.failure && !declining;

  useLayoutEffect(() => {
    fallback.current = focusTarget;
  });
  useLayoutEffect(() => {
    const node = region.current;
    return () => {
      if (node?.contains(document.activeElement)) {
        queueMicrotask(() => {
          if (document.activeElement === document.body) fallback.current();
        });
      }
    };
  }, []);

  async function going() {
    if (disabled || (view.response === "participating" && !retryGoing)) return;
    setSaved(false);
    if (await command.run({ response: "participating" })) {
      setDeclining(false);
      setReason("");
      setSaved(true);
    }
  }

  async function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = event.currentTarget;
    setSaved(false);
    const body = responseInput("declined", reason);
    setInvalid(!body);
    if (body?.response === "declined" && (await command.run(body))) {
      if (form.contains(document.activeElement)) declineButton.current?.focus();
      setDeclining(false);
      setReason("");
      setSaved(true);
    }
  }

  return (
    <div className="event-quick-response" ref={region}>
      <fieldset aria-label={t("events:response")} className="event-quick-choices">
        <Button
          type="button"
          variant="outline"
          aria-pressed={view.response === "participating" && !declining}
          aria-disabled={disabled || undefined}
          onClick={() => void going()}
        >
          {t("upcomingEvent.goingButton")}
        </Button>
        {!compact && (
          <Button
            ref={declineButton}
            type="button"
            variant="outline"
            aria-pressed={view.response === "declined" || declining}
            aria-expanded={declining}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (disabled) return;
              setDeclining(true);
              setSaved(false);
            }}
          >
            {t("upcomingEvent.cantGoButton")}
          </Button>
        )}
      </fieldset>
      {declining && (
        <form className="event-quick-form" noValidate onSubmit={(event) => void decline(event)}>
          <Label htmlFor={id}>{t("events:declineReason")}</Label>
          <textarea
            className="input"
            id={id}
            required
            maxLength={2048}
            aria-describedby={invalid ? `${id}-hint ${id}-error` : `${id}-hint`}
            aria-invalid={invalid || undefined}
            value={reason}
            readOnly={view.pending}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="muted" id={`${id}-hint`}>
            {t("events:declineHint")}
          </p>
          {invalid && (
            <p className="field-error" id={`${id}-error`} role="alert">
              {t("upcomingEvent.reasonRequired")}
            </p>
          )}
          <div className="event-quick-choices">
            <Button type="submit" aria-disabled={disabled || undefined}>
              {t(view.pending ? "events:savingResponse" : "events:respond")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-disabled={view.pending || undefined}
              onClick={() => {
                if (view.pending) return;
                setDeclining(false);
                setInvalid(false);
                declineButton.current?.focus();
              }}
            >
              {t("upcomingEvent.cancelDecline")}
            </Button>
          </div>
        </form>
      )}
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && (
        <p role="status" className="confirmation">
          {t("events:savedResponse")}
        </p>
      )}
    </div>
  );
}
