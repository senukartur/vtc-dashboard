import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CatalogDTO,
  type CatalogItem,
  type Game,
  itemSchema,
} from "../../shared/catalog-selectors/contracts.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { Button } from "../../shared/ui/primitives.js";
import { ImportLines } from "./CatalogImport.js";
import { CompanyLogo } from "./CompanyLogo.js";
import { Failure } from "./Feedback.js";
import { digest } from "./model.js";
import { importPreviewSchema, importResultSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

// Mirrors the server's engineering bounds; the server stays authoritative.
const LOGO_MAX_BYTES = 32 * 1024;
const BULK_MAX_FILES = 500;
const BULK_MAX_BYTES = 16 * 1024 * 1024;
type Preview = CatalogDTO["CatalogImportPreview"];
type Result = CatalogDTO["CatalogImportResult"];

const uploadError = (code: string | null) =>
  code === "CATALOG_FILE_TOO_LARGE"
    ? "logoTooLarge"
    : code === "CATALOG_FILE_INVALID"
      ? "logoRejected"
      : null;

/** Logo of one company inside its edit form: upload or replace, and remove. */
export function LogoSection({ item, onChanged }: { item: CatalogItem; onChanged: () => void }) {
  const { t } = useTranslation("catalogs");
  const command = useCatalogCommand();
  const [logo, setLogo] = useState(item.logo ?? null);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const path = `/admin/catalogs/companies/${item.id}/logo`;
  async function upload(file: File) {
    setInvalid(false);
    command.reset();
    if (file.size === 0 || file.size > LOGO_MAX_BYTES) {
      setInvalid(true);
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const sha = await digest(await file.arrayBuffer());
    const result = await command.run(path, body, itemSchema, {
      method: "PUT",
      fingerprint: `logo:${item.id}:${sha}`,
    });
    if (result) {
      setLogo(result.logo ?? null);
      onChanged();
    }
  }
  async function remove() {
    setInvalid(false);
    command.reset();
    const result = await command.run(path, undefined, itemSchema, { method: "DELETE" });
    if (result) {
      setLogo(result.logo ?? null);
      onChanged();
    }
  }
  const message = uploadError(command.errorCode);
  return (
    <fieldset className="catalog-field catalog-logo-section">
      <legend>{t("logoSection")}</legend>
      <div className="catalog-logo-current">
        <CompanyLogo companyId={item.id} logo={logo} />
        <span className="catalog-muted">{t(logo ? "logoCurrent" : "logoNone")}</span>
      </div>
      <p className="field-hint">{t("logoNote")}</p>
      <div className="catalog-dialog-actions catalog-logo-actions">
        <label className="button button-outline" aria-disabled={command.pending || undefined}>
          {t(logo ? "logoReplace" : "logoUpload")}
          <input
            ref={input}
            type="file"
            className="visually-hidden"
            accept="image/png,.png"
            disabled={command.pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {logo && (
          <Button
            type="button"
            variant="outline"
            disabled={command.pending}
            onClick={() => void remove()}
          >
            {t("logoRemove")}
          </Button>
        )}
      </div>
      {command.pending && <p role="status">{t("logoWorking")}</p>}
      {invalid && (
        <p role="alert" className="field-error">
          {t("logoTooLarge")}
        </p>
      )}
      {message ? (
        <p role="alert" className="field-error">
          {t(message)}
        </p>
      ) : (
        <Failure error={command.failure} seconds={command.seconds} />
      )}
    </fieldset>
  );
}

type Step =
  | { step: "files" }
  | { step: "preview"; files: File[]; preview: Preview }
  | { step: "done"; result: Result };

/** Staff dialog: many `<company code>.png` files for one game, a dry run first, then apply. */
export function LogoBulkDialog({
  game,
  onClose,
  onApplied,
}: {
  game: Game;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation("catalogs");
  const command = useCatalogCommand();
  const [step, setStep] = useState<Step>({ step: "files" });
  const [invalid, setInvalid] = useState(false);
  const [dragging, setDragging] = useState(false);
  async function check(files: File[]) {
    setInvalid(false);
    command.reset();
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (!files.length || files.length > BULK_MAX_FILES || total > BULK_MAX_BYTES) {
      setInvalid(true);
      return;
    }
    const body = new FormData();
    for (const file of files) body.append("file", file, file.name);
    const preview = await command.run(
      `/admin/catalogs/companies/logo-previews?game=${game}`,
      body,
      importPreviewSchema,
    );
    if (preview) setStep({ step: "preview", files, preview });
  }
  async function apply(files: File[], preview: Preview) {
    if (!preview.token) return;
    const body = new FormData();
    for (const file of files) body.append("file", file, file.name);
    const result = await command.run(
      `/admin/catalogs/companies/logo-imports?game=${game}`,
      body,
      importResultSchema,
      {
        etag: `"${preview.token}"`,
        fingerprint: `logos:${game}:${preview.fileSha256}:${preview.token}`,
      },
    );
    if (result) setStep({ step: "done", result });
  }
  const pick = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length) void check(files);
  };
  const errorMessage = (() => {
    switch (command.errorCode) {
      case "CATALOG_FILE_INVALID":
        return "logoBulkRejected";
      case "CATALOG_FILE_TOO_LARGE":
        return "logoBulkTooLarge";
      case "CATALOG_IMPORT_TOKEN_INVALID":
        return "tokenExpired";
      case "CATALOG_IMPORT_INVALID":
        return "importInvalid";
      default:
        return null;
    }
  })();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="catalog-dialog">
        <DialogTitle>{t("logoBulkTitle", { game: game.toUpperCase() })}</DialogTitle>
        {step.step === "files" && (
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
              <p>{t("logoBulkDrop")}</p>
              <label className="button button-outline">
                {t("logoBulkChoose")}
                <input
                  type="file"
                  multiple
                  className="visually-hidden"
                  accept="image/png,.png"
                  disabled={command.pending}
                  onChange={(e) => {
                    pick(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="catalog-muted">{t("logoBulkNote")}</p>
            </div>
            {command.pending && <p role="status">{t("checking")}</p>}
            {invalid && (
              <p role="alert" className="field-error">
                {t("logoBulkInvalid")}
              </p>
            )}
          </>
        )}
        {step.step === "preview" && (
          <>
            <p>{t("logoBulkChecked", { count: step.files.length })}</p>
            <div className="catalog-counts">
              <div>
                <strong>{step.preview.added}</strong>
                <span>{t("willAdd")}</span>
              </div>
              <div>
                <strong>{step.preview.changed}</strong>
                <span>{t("logoWillReplace")}</span>
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
            <ImportLines
              lines={step.preview.lines}
              fileNames={step.files.map((file) => file.name)}
            />
            {step.preview.truncated && <p className="catalog-muted">{t("truncated")}</p>}
            {step.preview.errors > 0 && (
              <p role="alert" className="field-error">
                {t("logoFixAndRetry", { count: step.preview.errors })}
              </p>
            )}
            <div className="catalog-dialog-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  command.reset();
                  setStep({ step: "files" });
                }}
              >
                {t("logoOtherFiles")}
              </Button>
              <Button
                type="button"
                disabled={!step.preview.token || command.pending}
                onClick={() => void apply(step.files, step.preview)}
              >
                {t(command.pending ? "applying" : "logoBulkApply")}
              </Button>
            </div>
          </>
        )}
        {step.step === "done" && (
          <>
            <div className="catalog-applied">
              <strong>{t("logoBulkApplied")}</strong>
              <p>
                {t("logoBulkSummary", {
                  added: step.result.added,
                  changed: step.result.changed,
                  unchanged: step.result.unchanged,
                })}
              </p>
              <p className="catalog-muted">{t("logoAuditNote")}</p>
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
