import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import type { useWorkspaceCommand } from "./transport.js";
import "./administration.css";

// Section links live in the shell sidebar and user menu, not repeated per page.
export function WorkspaceHeading({ title }: { title: string }) {
  return (
    <header className="page-heading stack">
      <p className="eyebrow">Yukon Union</p>
      <h1>{title}</h1>
    </header>
  );
}
export function CommandFeedback({ command }: { command: ReturnType<typeof useWorkspaceCommand> }) {
  const { t } = useTranslation("administration");
  return (
    <>
      {command.pending && <p role="status">{t("working")}</p>}
      {command.failure && (
        <p role="alert">
          {t(`errors.${command.failure.ownResourceId ? "secretIssued" : command.failure.kind}`)}
        </p>
      )}
      {command.seconds > 0 && <p role="status">{t("wait", { seconds: command.seconds })}</p>}
      {command.held && <p>{t("frozen")}</p>}
      {command.committed && <p role="status">{t("saved")}</p>}
    </>
  );
}
export function QueryState({
  pending,
  error,
  retry,
  empty,
}: {
  pending: boolean;
  error: boolean;
  retry: () => unknown;
  empty?: boolean;
}) {
  const { t } = useTranslation("administration");
  return pending ? (
    <p role="status" aria-busy="true">
      {t("loading")}
    </p>
  ) : error ? (
    <div role="alert">
      <p>{t("readError")}</p>
      <Button variant="outline" onClick={() => void retry()}>
        {t("refresh")}
      </Button>
    </div>
  ) : empty ? (
    <p>{t("empty")}</p>
  ) : null;
}
export function Permission({ capability, children }: { capability: string; children: ReactNode }) {
  const session = useSession(),
    { t } = useTranslation("administration");
  return session.self?.capabilities.includes(capability) ? (
    children
  ) : (
    <Card>
      <h1>{t("permission")}</h1>
      <p>{t("permissionHelp")}</p>
    </Card>
  );
}
export function Confirmation({
  label,
  description,
  busy,
  disabled,
  children,
  confirm,
}: {
  label: string;
  description: string;
  busy: boolean;
  disabled?: boolean;
  children?: ReactNode;
  confirm: () => Promise<boolean>;
}) {
  const { t } = useTranslation("administration"),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setFailed(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || busy}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
        {failed && <p role="alert">{t("confirmationFailed")}</p>}
        <div className="button-row">
          <Button
            disabled={busy}
            onClick={() =>
              void confirm().then((done) => {
                if (done) setOpen(false);
                else setFailed(true);
              })
            }
          >
            {t("confirm")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function Pager({
  cursor,
  next,
  setCursor,
}: {
  cursor: string | null;
  next: string | null | undefined;
  setCursor: (value: string | null) => void;
}) {
  const { t } = useTranslation("administration");
  return (
    <div className="button-row">
      {cursor && (
        <Button variant="outline" onClick={() => setCursor(null)}>
          {t("first")}
        </Button>
      )}
      {next && (
        <Button variant="outline" onClick={() => setCursor(next)}>
          {t("next")}
        </Button>
      )}
    </div>
  );
}
