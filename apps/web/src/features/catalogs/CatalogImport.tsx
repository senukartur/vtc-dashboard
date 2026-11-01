import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { type CatalogDTO, type Game, uuid } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { formatDecimal } from "../../shared/formatting.js";
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { Failure } from "./Feedback.js";
import { importSteps, type StepState } from "./model.js";
import { artifactSchema, operationSchema, policySchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

export function CatalogImport({
  game,
  onCandidate,
}: {
  game: Game;
  onCandidate: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("catalogs"),
    [params, setParams] = useSearchParams(),
    headingId = useId();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const opParam = params.get("operation"),
    operationId = uuid.safeParse(opParam).success ? opParam : null;
  const policy = useCatalogQuery(["policy"], "/admin/catalog-import-policy", policySchema);
  const operation = useCatalogQuery(
    ["operation", operationId],
    `/operations/${operationId}`,
    operationSchema,
    !!operationId,
    true,
  );
  const [file, setFile] = useState<File | null>(null),
    [artifact, setArtifact] = useState<CatalogDTO["CatalogArtifact"] | null>(null),
    [invalid, setInvalid] = useState(false),
    [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const command = useCatalogCommand(),
    recover = useRef<HTMLFormElement>(null);
  const resultId =
    operation.data?.data.data.state === "completed" ? operation.data.data.data.resultId : null;
  useEffect(() => {
    if (resultId) onCandidate(resultId);
  }, [resultId, onCandidate]);
  const p = policy.data?.data.data,
    op = operation.data?.data.data;
  const busy = preparing || command.pending || command.seconds > 0;
  const steps = importSteps(artifact?.state, operationId ? (op?.state ?? "unknown") : undefined);
  const stepLabel = { uploaded: "stepUploaded", imported: "stepImported", ready: "stepReady" },
    stateLabel: Record<StepState, string> = {
      done: "stepDone",
      current: "stepCurrent",
      failed: "stepFailed",
      pending: "stepPending",
    },
    glyph: Record<StepState, string> = { done: "✓", current: "●", failed: "✕", pending: "—" };
  return (
    <Card className="catalog-card catalog-import" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("importTitle")}</h2>
      {p?.enabled && p.maxFileBytes ? (
        <p className="catalog-muted">{t("policy", { bytes: p.maxFileBytes })}</p>
      ) : (
        <p role="status" className="catalog-muted">
          {t("policyUnavailable")}
        </p>
      )}
      <form
        className="catalog-form"
        aria-label={t("importTitle")}
        onSubmit={async (e) => {
          e.preventDefault();
          if (preparingRef.current || busy) return;
          if (
            !file ||
            !p?.enabled ||
            !p.maxFileBytes ||
            file.size > p.maxFileBytes ||
            file.size === 0 ||
            file.type !== "application/json"
          ) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          preparingRef.current = true;
          setPreparing(true);
          try {
            const body = new FormData();
            body.append("file", file);
            const bytes = await file.arrayBuffer();
            const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            const result = await command.run(
              "/admin/catalog-import-artifacts",
              body,
              artifactSchema,
              undefined,
              `upload:${digest}`,
            );
            if (result) setArtifact(result);
          } catch {
            setInvalid(true);
          } finally {
            preparingRef.current = false;
            setPreparing(false);
          }
        }}
      >
        <Label htmlFor="catalog-file">{t("file")}</Label>
        <Input
          className="catalog-file"
          id="catalog-file"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setArtifact(null);
            setInvalid(false);
            command.reset();
          }}
        />
        {invalid && <p role="alert">{t("invalidFile")}</p>}
        <Button disabled={busy || !file || !p?.enabled}>
          {t(command.pending ? "pendingAction" : "upload")}
        </Button>
      </form>
      <ol className="catalog-steps" aria-label={t("progressLabel")}>
        {steps.map((step) => (
          <li key={step.id} className={`catalog-step catalog-step-${step.state}`}>
            {/* A no-break space keeps the glyph on the same line as the label's first word. */}
            <span aria-hidden="true">{glyph[step.state]}</span>
            {" "}
            <span>{t(stepLabel[step.id])}</span>
            <span className="visually-hidden">: {t(stateLabel[step.state])}</span>
          </li>
        ))}
      </ol>
      {artifact && (
        <div className="catalog-artifact">
          <strong>{t("uploaded")}</strong>
          <dl className="catalog-pairs">
            <dt>{t("artifact")}</dt>
            <dd>
              <code>{artifact.id}</code>
            </dd>
            <dt>{t("sha256")}</dt>
            <dd>
              <code>{artifact.sha256}</code>
            </dd>
            <dt>{t("bytes")}</dt>
            <dd>{formatDecimal(String(artifact.byteLength), locale)}</dd>
          </dl>
          <Button
            className="catalog-start"
            disabled={busy || artifact.state !== "ready"}
            onClick={async () => {
              const result = await command.run(
                "/admin/catalog-imports",
                { artifactId: artifact.id, sha256: artifact.sha256, game },
                operationSchema,
              );
              if (result) {
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.set("operation", result.id);
                    next.delete("candidate");
                    return next;
                  },
                  { replace: true },
                );
                setArtifact(null);
                setFile(null);
              }
            }}
          >
            {t("import")}
          </Button>
        </div>
      )}
      <Failure error={command.failure} seconds={command.seconds} />
      {operationId && (
        <div role="status" className="catalog-operation">
          <strong>{t(op?.state ?? "loading")}</strong>
          <p className="catalog-muted">
            {t("operation")}: <code>{operationId}</code>
          </p>
          {op?.state === "failed" && (
            <p>{t(op.failureCode === "artifact_expired" ? "expired" : "failed")}</p>
          )}
        </div>
      )}
      {operation.isError && (
        <div role="alert" className="catalog-inline-alert">
          <p>{t("readError")}</p>
          <Button size="xs" variant="outline" onClick={() => void operation.refetch()}>
            {t("refresh")}
          </Button>
        </div>
      )}
      <p className="catalog-muted">{t("importNote")}</p>
      <details className="catalog-details">
        <summary>{t("recover")}</summary>
        <p className="catalog-muted">{t("operationHelp")}</p>
        <form
          ref={recover}
          className="catalog-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget),
              operation = String(data.get("operation") ?? "").trim(),
              candidate = String(data.get("candidate") ?? "").trim();
            if (
              (operation && !uuid.safeParse(operation).success) ||
              (candidate && !uuid.safeParse(candidate).success) ||
              (!operation && !candidate)
            ) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete("operation");
                next.delete("candidate");
                if (operation) next.set("operation", operation);
                if (candidate) next.set("candidate", candidate);
                return next;
              },
              { replace: true },
            );
          }}
        >
          <Label htmlFor="recover-operation">{t("operationInput")}</Label>
          <Input id="recover-operation" name="operation" maxLength={36} />
          <Label htmlFor="recover-candidate">{t("revisionInput")}</Label>
          <Input id="recover-candidate" name="candidate" maxLength={36} />
          <Button>{t("open")}</Button>
        </form>
      </details>
      {opParam && !operationId && <p role="alert">{t("invalidId")}</p>}
    </Card>
  );
}
