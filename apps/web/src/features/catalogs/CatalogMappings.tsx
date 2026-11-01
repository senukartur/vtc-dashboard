import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./Feedback.js";
import { StateBadge } from "./ReviewTables.js";
import { commandResultSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

export const mappingPossible = (issue: CatalogDTO["CatalogMappingIssue"]) =>
  !!issue.sourceId && !!issue.mapNamespace && issue.candidateEntityIds.length > 0;

/** One mapping issue row; an explicit decision opens a dialog with candidate and reason. */
export function CatalogMapping({
  issue,
  revisionId,
  game,
  editable,
  changed,
  onOpen,
  onSaved,
  labels,
}: {
  issue: CatalogDTO["CatalogMappingIssue"];
  revisionId: string;
  game: Game;
  editable: boolean;
  changed: () => Promise<void>;
  onOpen: () => void;
  onSaved: () => void;
  labels: Map<string, string>;
}) {
  const { t } = useTranslation("catalogs"),
    id = useId(),
    [open, setOpen] = useState(false),
    [candidate, setCandidate] = useState(""),
    [reason, setReason] = useState("");
  const command = useCatalogCommand(),
    possible = mappingPossible(issue);
  const unavailable = t("unavailable"),
    describe = (entityId: string) =>
      labels.get(entityId) ? `${labels.get(entityId)} · ${entityId}` : entityId;
  return (
    <tr>
      <th scope="row">
        {issue.provider} · {issue.sourceId ?? unavailable}
        <small className="catalog-muted">
          {t("sourceLocale")}: {issue.sourceLocale ?? unavailable}
        </small>
      </th>
      <td>
        {issue.candidateEntityIds.length ? (
          <ul className="catalog-plain-list">
            {issue.candidateEntityIds.map((entityId) => (
              <li key={entityId}>
                {labels.get(entityId) ?? <code>{entityId}</code>}
                {labels.get(entityId) && <code className="catalog-id">{entityId}</code>}
              </li>
            ))}
          </ul>
        ) : (
          "—"
        )}
      </td>
      <td>
        {issue.mapNamespace ?? unavailable}
        <code className="catalog-id">{issue.reasonCode}</code>
      </td>
      <td>
        {possible && editable ? (
          <div className="catalog-decision">
            <StateBadge state="pending" label={t("needsDecision")} />
            <Dialog
              open={open}
              onOpenChange={(next) => {
                if (command.pending) return;
                setOpen(next);
                if (next) {
                  setCandidate("");
                  setReason("");
                  command.reset();
                  onOpen();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="xs" variant="outline">
                  {t("resolveOpen")}
                </Button>
              </DialogTrigger>
              <DialogContent
                className="catalog-mapping-dialog"
                onEscapeKeyDown={(e) => {
                  if (command.pending) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                  if (command.pending) e.preventDefault();
                }}
              >
                <DialogTitle>{t("mappingTitle")}</DialogTitle>
                <DialogDescription>
                  {t("mappingContext", {
                    provider: issue.provider,
                    source: issue.sourceId ?? unavailable,
                    map: issue.mapNamespace ?? unavailable,
                    locale: issue.sourceLocale ?? unavailable,
                    reason: issue.reasonCode,
                  })}
                </DialogDescription>
                <form
                  className="catalog-dialog-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!issue.candidateEntityIds.includes(candidate) || !reason.trim()) return;
                    const result = await command.run(
                      "/admin/catalog-mappings",
                      {
                        catalogRevisionId: revisionId,
                        provider: issue.provider,
                        game,
                        mapNamespace: issue.mapNamespace,
                        sourceId: issue.sourceId,
                        entityId: candidate,
                        reason: reason.trim(),
                      },
                      commandResultSchema,
                    );
                    if (result) {
                      setOpen(false);
                      await changed();
                      onSaved();
                    }
                  }}
                >
                  <fieldset className="catalog-radios" disabled={command.pending}>
                    <legend>{t("candidateEntity")}</legend>
                    {issue.candidateEntityIds.map((entityId) => (
                      <label key={entityId} className="catalog-radio">
                        <input
                          type="radio"
                          name={`${id}-candidate`}
                          value={entityId}
                          required
                          checked={candidate === entityId}
                          onChange={() => setCandidate(entityId)}
                        />
                        <span>{describe(entityId)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="catalog-field">
                    <Label htmlFor={`${id}-reason`}>{t("reason")}</Label>
                    <Input
                      id={`${id}-reason`}
                      required
                      maxLength={2048}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={command.pending}
                    />
                  </div>
                  <Failure error={command.failure} seconds={command.seconds} />
                  <div className="catalog-dialog-actions">
                    <DialogClose asChild>
                      <Button type="button" variant="outline" disabled={command.pending}>
                        {t("cancel")}
                      </Button>
                    </DialogClose>
                    <Button
                      disabled={
                        command.pending || command.seconds > 0 || !candidate || !reason.trim()
                      }
                    >
                      {t(command.pending ? "pendingAction" : "resolve")}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <span>{t("reimportRequired")}</span>
        )}
      </td>
    </tr>
  );
}
