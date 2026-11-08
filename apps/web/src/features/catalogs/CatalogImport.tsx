import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO, CatalogList } from "../../shared/catalog-selectors/contracts.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button } from "../../shared/ui/primitives.js";
import { Failure } from "./Feedback.js";
import { digest, downloadText, importColumns, templateCsv, templateJson } from "./model.js";
import { importPreviewSchema, importResultSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
type Preview = CatalogDTO["CatalogImportPreview"];
type Result = CatalogDTO["CatalogImportResult"];
type Step =
  | { step: "file" }
  | { step: "preview"; file: File; preview: Preview }
  | { step: "done"; file: File; result: Result };

export function CatalogImport({
  list,
  listLabel,
  onClose,
  onApplied,
}: {
  list: CatalogList;
  listLabel: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation("catalogs");
  const command = useCatalogCommand();
  const [step, setStep] = useState<Step>({ step: "file" });
  const [invalid, setInvalid] = useState(false);
  const [dragging, setDragging] = useState(false);
  const columns = importColumns[list].join(", ");
  async function check(file: File) {
    setInvalid(false);
    command.reset();
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setInvalid(true);
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const preview = await command.run(
      `/admin/catalogs/${list}/import-previews`,
      body,
      importPreviewSchema,
    );
    if (preview) setStep({ step: "preview", file, preview });
  }
  async function apply(file: File, preview: Preview) {
    if (!preview.token) return;
    const body = new FormData();
    body.append("file", file);
    const sha = await digest(await file.arrayBuffer());
    const result = await command.run(`/admin/catalogs/${list}/imports`, body, importResultSchema, {
      etag: `"${preview.token}"`,
      fingerprint: `import:${list}:${sha}:${preview.token}`,
    });
    if (result) setStep({ step: "done", file, result });
  }
  const errorMessage = (() => {
    switch (command.errorCode) {
      case "CATALOG_FILE_INVALID":
        return "fileRejected";
      case "CATALOG_FILE_TOO_LARGE":
        return "fileTooLarge";
      case "CATALOG_IMPORT_TOKEN_INVALID":
        return "tokenExpired";
      case "CATALOG_IMPORT_INVALID":
        return "importInvalid";
      default:
        return null;
    }
  })();
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (files && files.length === 1 && file) void check(file);
    else if (files?.length) setInvalid(true);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="catalog-dialog">
        <DialogTitle>{t("importTitle", { list: listLabel })}</DialogTitle>
        {step.step === "file" && (
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a pointer enhancement; the file input below is the keyboard path */}
            <div
              className="catalog-drop"
              data-dragging={dragging}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files);
              }}
            >
              <p>{t("dropHint")}</p>
              <label className="button button-outline">
                {t("chooseFile")}
                <input
                  type="file"
                  className="visually-hidden"
                  accept=".csv,.json,text/csv,application/json"
                  disabled={command.pending}
                  onChange={(e) => pick(e.target.files)}
                />
              </label>
              <p className="catalog-muted">{t("fileNote")}</p>
            </div>
            <div className="catalog-columns">
              <strong>{t("columnsTitle")}</strong>
              <p>
                <code>{columns}</code>
              </p>
              <p className="catalog-muted">{t("columnsNote")}</p>
            </div>
            <div className="catalog-dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadText(`${list}.csv`, templateCsv(list), "text/csv")}
              >
                {t("templateCsv")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadText(`${list}.json`, templateJson(list), "application/json")}
              >
                {t("templateJson")}
              </Button>
            </div>
            {command.pending && <p role="status">{t("checking")}</p>}
            {invalid && (
              <p role="alert" className="field-error">
                {t("invalidFile")}
              </p>
            )}
          </>
        )}
        {step.step === "preview" && (
          <>
            <p>{t("checkedTitle", { name: step.file.name })}</p>
            <div className="catalog-counts">
              <div>
                <strong>{step.preview.added}</strong>
                <span>{t("willAdd")}</span>
              </div>
              <div>
                <strong>{step.preview.changed}</strong>
                <span>{t("willChange")}</span>
              </div>
              <div>
                <strong>{step.preview.unchanged}</strong>
                <span>{t("unchanged")}</span>
              </div>
              <div>
                <strong>{step.preview.errors}</strong>
                <span>{t("errors")}</span>
              </div>
            </div>
            {step.preview.lines.length > 0 && (
              <div className="catalog-lines">
                <table>
                  <thead>
                    <tr>
                      <th>{t("colLine")}</th>
                      <th>{t("colCode")}</th>
                      <th>{t("colResult")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.preview.lines.map((line) => (
                      <tr key={line.line} data-status={line.status}>
                        <td>{line.line}</td>
                        <td>
                          <code>{line.code ?? "—"}</code>
                        </td>
                        <td>
                          {line.status === "error"
                            ? line.issues.map((i) => `${i.field}: ${i.reason}`).join("; ")
                            : t("statusChanged", { fields: line.changedFields.join(", ") })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {step.preview.truncated && <p className="catalog-muted">{t("truncated")}</p>}
            {step.preview.errors > 0 && (
              <p role="alert" className="field-error">
                {t("fixAndRetry", { count: step.preview.errors })}
              </p>
            )}
            <div className="catalog-dialog-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  command.reset();
                  setStep({ step: "file" });
                }}
              >
                {t("otherFile")}
              </Button>
              <Button
                type="button"
                disabled={!step.preview.token || command.pending}
                onClick={() => void apply(step.file, step.preview)}
              >
                {t(command.pending ? "applying" : "apply")}
              </Button>
            </div>
          </>
        )}
        {step.step === "done" && (
          <>
            <div className="catalog-applied">
              <strong>{t("appliedTitle")}</strong>
              <p>
                {t("appliedSummary", {
                  added: step.result.added,
                  changed: step.result.changed,
                })}
              </p>
              <p className="catalog-muted">{t("appliedNote")}</p>
            </div>
            <div className="catalog-dialog-actions">
              <Button
                type="button"
                onClick={() => {
                  onApplied();
                  onClose();
                }}
              >
                {t("done")}
              </Button>
            </div>
          </>
        )}
        {errorMessage ? (
          <p role="alert" className="field-error">
            {t(errorMessage)}
          </p>
        ) : (
          <Failure error={command.failure} seconds={command.seconds} />
        )}
      </DialogContent>
    </Dialog>
  );
}
