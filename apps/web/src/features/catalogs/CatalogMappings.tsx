import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./Feedback.js";
import { commandResultSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

export function CatalogMapping({
  issue,
  revisionId,
  game,
  editable,
  changed,
  labels,
}: {
  issue: CatalogDTO["CatalogMappingIssue"];
  revisionId: string;
  game: Game;
  editable: boolean;
  changed: () => Promise<void>;
  labels: Map<string, string>;
}) {
  const { t } = useTranslation("catalogs"),
    [candidate, setCandidate] = useState(""),
    [reason, setReason] = useState("");
  const command = useCatalogCommand(),
    possible = !!issue.sourceId && !!issue.mapNamespace && issue.candidateEntityIds.length > 0;
  return (
    <article className="stack catalog-selection">
      <h4>{issue.reasonCode}</h4>
      <dl>
        <dt>{t("provider")}</dt>
        <dd>{issue.provider}</dd>
        <dt>{t("sourceId")}</dt>
        <dd>{issue.sourceId ?? t("unavailable")}</dd>
        <dt>{t("map")}</dt>
        <dd>{issue.mapNamespace ?? t("unavailable")}</dd>
        <dt>{t("sourceLocale")}</dt>
        <dd>{issue.sourceLocale ?? t("unavailable")}</dd>
      </dl>
      {possible && editable ? (
        <form
          className="stack"
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
            if (result) await changed();
          }}
        >
          <Label htmlFor={`candidate-${issue.id}`}>{t("candidateEntity")}</Label>
          <select
            className="input"
            id={`candidate-${issue.id}`}
            required
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            disabled={command.pending}
          >
            <option value="">{t("choose")}</option>
            {issue.candidateEntityIds.map((id) => (
              <option key={id} value={id}>
                {labels.get(id) ? `${labels.get(id)} · ` : ""}
                {id}
              </option>
            ))}
          </select>
          <Label htmlFor={`reason-${issue.id}`}>{t("reason")}</Label>
          <Input
            id={`reason-${issue.id}`}
            required
            maxLength={2048}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={command.pending}
          />
          <Failure error={command.failure} seconds={command.seconds} />
          <Button disabled={command.pending || command.seconds > 0 || !candidate || !reason.trim()}>
            {t(command.pending ? "pendingAction" : "resolve")}
          </Button>
        </form>
      ) : (
        <p>{t("reimport")}</p>
      )}
    </article>
  );
}
