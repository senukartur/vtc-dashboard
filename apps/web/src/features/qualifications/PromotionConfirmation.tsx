import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog.js";
import { Button, FieldError, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./components.js";
import { type ReadyCandidate, usePromotionCommand } from "./PromotionCommandProvider.js";
import { usePromotionDisplay } from "./promotion-lists.js";

export function PromotionConfirmation({
  candidate,
  initialReason,
  onDismiss,
  onFocusReturn,
}: {
  candidate: ReadyCandidate;
  initialReason: string;
  onDismiss: () => void;
  onFocusReturn: () => void;
}) {
  const { t } = useTranslation("promotions");
  const display = usePromotionDisplay();
  const command = usePromotionCommand();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState(initialReason);
  const [invalid, setInvalid] = useState(false);
  const frozen = command.busy || command.held || command.conflict;
  const shownReason = frozen ? (command.attemptReason ?? reason) : reason;

  function submit() {
    if (command.blocked) return;
    if (command.conflict) {
      command.reviewAgain();
      return;
    }
    const trimmed = shownReason.trim();
    if (!trimmed) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    void command.submit(trimmed);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !command.busy && !command.conflict) onDismiss();
      }}
    >
      <DialogContent
        className="promotion-confirmation"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onFocusReturn();
        }}
      >
        <DialogTitle>{t("confirmTitle")}</DialogTitle>
        <DialogDescription>{t("confirmHelp")}</DialogDescription>
        <dl className="promotion-preview">
          <div>
            <dt>{t("driver")}</dt>
            <dd>
              {candidate.member.nickname}
              <code className="promotion-member-id">{candidate.member.id}</code>
            </dd>
          </div>
          <div>
            <dt>{t("game")}</dt>
            <dd>{candidate.game.toUpperCase()}</dd>
          </div>
          <div>
            <dt>{t("transition")}</dt>
            <dd>
              {candidate.currentLevel.name} → {candidate.nextLevel.name}
            </dd>
          </div>
          <div>
            <dt>{t("trips")}</dt>
            <dd>{display.trips(candidate.acceptedTrips, candidate.requiredTrips)}</dd>
          </div>
          <div>
            <dt>{t("distance")}</dt>
            <dd>{display.distance(candidate.actualDistanceM, candidate.requiredDistanceM)}</dd>
          </div>
        </dl>
        <form
          className="stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="promotion-field promotion-reason-field">
            <Label htmlFor={id}>{t("reason")}</Label>
            <textarea
              ref={input}
              id={id}
              className="input"
              rows={3}
              maxLength={2048}
              required
              readOnly={frozen}
              value={shownReason}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(false);
              }}
            />
            <FieldError id={`${id}-error`}>{invalid ? t("reasonRequired") : undefined}</FieldError>
          </div>
          {command.conflict ? (
            <p role="alert" className="field-error">
              {t("conflict")}
            </p>
          ) : command.canRecover ? (
            <p role="alert" className="field-error">
              {t("uncertain")}
            </p>
          ) : (
            <Failure error={command.failure} seconds={command.seconds} />
          )}
          <div className="promotion-dialog-actions">
            {!command.conflict && (
              <Button
                type="button"
                variant="outline"
                aria-disabled={command.busy || undefined}
                onClick={() => {
                  if (!command.busy) onDismiss();
                }}
              >
                {t(command.held ? "closePreview" : "cancel")}
              </Button>
            )}
            <Button type="submit" aria-disabled={command.blocked || undefined}>
              {command.busy
                ? t("saving")
                : command.conflict
                  ? t("refresh")
                  : command.held
                    ? t("recover")
                    : t("confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
