import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog.js";
import { Button, FieldError, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./components.js";
import { usePromotionDisplay } from "./promotion-lists.js";
import { useRefreshPromotionReads } from "./promotion-queries.js";
import type { Candidate } from "./promotion-transport.js";
import { useQualificationCommand } from "./queries.js";
import type { DTO } from "./transport.js";

export type ReadyCandidate = Candidate & { nextLevel: NonNullable<Candidate["nextLevel"]> };

export function PromotionConfirmation({
  candidate,
  initialReason,
  onClose,
  onRefresh,
  onFocusReturn,
}: {
  candidate: ReadyCandidate;
  initialReason: string;
  onClose: (result?: { kind: "committed" | "conflict"; reason: string }) => void;
  onRefresh: () => void;
  onFocusReturn: () => void;
}) {
  const { t } = useTranslation("promotions");
  const { self } = useSession();
  const display = usePromotionDisplay();
  const refresh = useRefreshPromotionReads();
  const command = useQualificationCommand({
    kind: "member",
    game: candidate.game,
    id: candidate.member.id,
    // This command can change the membership role. Recheck only our own session.
    rolePromotionLevelId: candidate.member.id === self?.member.id ? candidate.nextLevel.id : null,
  });
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const recovery = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState(initialReason);
  const [invalid, setInvalid] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [open, setOpen] = useState(true);
  const held = command.canRecover || command.failure?.kind === "limited";
  const busy = command.pending || finishing;
  const blocked = busy || command.seconds > 0;
  const trimmed = reason.trim();

  async function submit() {
    if (blocked) return;
    if (!trimmed) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    const body: DTO["PromotionInput"] = {
      game: candidate.game,
      assignmentId: candidate.assignmentId,
      targetLevelId: candidate.nextLevel.id,
      reason: trimmed,
    };
    setFinishing(true);
    const result = await (command.canRecover
      ? command.recover()
      : command.run(
          `/admin/members/${encodeURIComponent(candidate.member.id)}/promotions`,
          body,
          "EnvelopeAssignment",
          `"v${candidate.version}"`,
        ));
    if (result) {
      onRefresh();
      await refresh(candidate);
      onClose({ kind: "committed", reason: trimmed });
    } else {
      setFinishing(false);
    }
  }

  // A rejected version or state requires a newly opened preview from fresh candidates.
  const conflict = command.failure?.kind === "conflict";
  async function reviewAgain() {
    if (busy) return;
    setFinishing(true);
    onRefresh();
    await refresh(candidate);
    onClose({ kind: "conflict", reason: trimmed });
  }

  function dismiss() {
    if (busy || conflict) return;
    if (held) setOpen(false);
    else onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      {!open && (
        <div className="promotion-recovery stack">
          <p role="status">{t("uncertain")}</p>
          <Button ref={recovery} type="button" variant="outline" onClick={() => setOpen(true)}>
            {t("recover")}
          </Button>
        </div>
      )}
      <DialogContent
        className="promotion-confirmation"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!open && recovery.current?.isConnected) recovery.current.focus();
          else onFocusReturn();
        }}
      >
        <DialogTitle>{t("confirmTitle")}</DialogTitle>
        <DialogDescription>{t("confirmHelp")}</DialogDescription>
        <dl className="promotion-preview">
          <div>
            <dt>{t("driver")}</dt>
            <dd>{candidate.member.nickname}</dd>
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
            void (conflict ? reviewAgain() : submit());
          }}
        >
          <div className="promotion-field">
            <Label htmlFor={id}>{t("reason")}</Label>
            <textarea
              ref={input}
              id={id}
              className="input"
              rows={3}
              maxLength={2048}
              required
              readOnly={busy || held || conflict}
              value={reason}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(false);
              }}
            />
            <FieldError id={`${id}-error`}>{invalid ? t("reasonRequired") : undefined}</FieldError>
          </div>
          {conflict ? (
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
            {!conflict && (
              <Button
                type="button"
                variant="outline"
                aria-disabled={busy || undefined}
                onClick={dismiss}
              >
                {t(held ? "closePreview" : "cancel")}
              </Button>
            )}
            <Button type="submit" aria-disabled={blocked || undefined}>
              {busy ? t("saving") : conflict ? t("refresh") : held ? t("recover") : t("confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
