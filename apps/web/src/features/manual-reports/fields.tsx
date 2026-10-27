import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { formatUtc } from "../../shared/formatting.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { Failure, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import type { DTO } from "../trips/transport.js";
export function ManualCatalogField({
  name,
  game,
  revision,
  value,
  onChange,
}: {
  name: "origin" | "destination" | "cargo" | "trailerType";
  game: "ets2" | "ats";
  revision: string;
  value: DTO["ManualCatalogSelection"] | undefined;
  onChange: (value: DTO["ManualCatalogSelection"] | undefined) => void;
}) {
  const { t, i18n } = useTranslation("trips"),
    id = useId(),
    unresolved = value?.status === "unresolved";
  return (
    <fieldset className="stack">
      <legend>{t(name)}</legend>
      <label className="trip-check">
        <input
          type="checkbox"
          checked={unresolved}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    status: "unresolved",
                    label: "",
                    reasonCode: "not_listed",
                    locale: i18n.resolvedLanguage === "en" ? "en" : "ru",
                    context: null,
                  }
                : undefined,
            )
          }
        />
        {t("unresolved")}
      </label>
      {unresolved ? (
        <>
          <Label htmlFor={`${id}-label`}>{t("unresolvedLabel")}</Label>
          <Input
            id={`${id}-label`}
            value={value.label}
            maxLength={256}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
          />
          <Label htmlFor={`${id}-reason`}>{t("unresolvedReason")}</Label>
          <select
            id={`${id}-reason`}
            className="input"
            value={value.reasonCode}
            onChange={(e) =>
              onChange({
                ...value,
                reasonCode: e.target.value as DTO["ManualUnresolvedSelection"]["reasonCode"],
              })
            }
          >
            {["not_found", "ambiguous", "not_listed"].map((code) => (
              <option key={code} value={code}>
                {t(code)}
              </option>
            ))}
          </select>
          <Label htmlFor={`${id}-context`}>{t("context")}</Label>
          <Input
            id={`${id}-context`}
            value={value.context ?? ""}
            maxLength={512}
            onChange={(e) => onChange({ ...value, context: e.target.value || null })}
          />
        </>
      ) : (
        <CatalogSelector
          label={t(name)}
          game={game}
          revisionId={revision}
          kind={name === "cargo" ? "cargo" : name === "trailerType" ? "trailer_type" : "city"}
          value={
            value?.status === "resolved"
              ? { entityId: value.entityId, revisionId: value.catalogRevisionId }
              : null
          }
          onChange={(v) =>
            onChange(
              v
                ? { status: "resolved", entityId: v.entityId, catalogRevisionId: v.revisionId }
                : undefined,
            )
          }
        />
      )}
    </fieldset>
  );
}
export function EvidenceItem({
  id,
  onRemove,
  onState,
  metadata,
  enabled = true,
}: {
  id: string;
  onRemove?: () => void;
  onState?: (value: DTO["Evidence"] | null, checked: boolean) => void;
  metadata?: DTO["Evidence"];
  enabled?: boolean;
}) {
  const { t } = useTranslation("trips"),
    query = useTripQuery(
      `/evidence/${id}`,
      "EnvelopeEvidence",
      enabled && (!metadata || metadata.state === "processing"),
      true,
    ),
    [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState(false),
    item = query.isError ? undefined : (query.data?.data.data ?? metadata),
    session = useSession(),
    client = useQueryClient(),
    lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    lifetime.current = ctl;
    return () => ctl.abort();
  }, []);
  useEffect(() => {
    onState?.(item ?? null, !!metadata || query.isFetched);
  }, [item, onState, metadata, query.isFetched]);
  return (
    <article className="trip-evidence">
      {!metadata && enabled && <State query={query} />}
      {metadata && query.isError && <Failure error={query.error} />}
      {item && (
        <>
          <strong>{item.originalName}</strong>
          <p>
            {t(item.state)} · {item.contentType} · {item.byteLength}
          </p>
          <small>{item.id}</small>
          {item.state === "expired" && <p>{t("expired")}</p>}
          <Button
            type="button"
            variant="outline"
            disabled={item.state !== "ready" || pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              let url: string | undefined;
              try {
                const r = await fetch(`/api/v1/evidence/${id}/content`, {
                  credentials: "same-origin",
                  cache: "no-store",
                  signal: AbortSignal.any([
                    lifetime.current?.signal ?? AbortSignal.abort(),
                    AbortSignal.timeout(15000),
                  ]),
                });
                if (!r.ok) {
                  const { fail } = await import("../trips/transport.js");
                  fail(r);
                }
                if (r.headers.get("Content-Type")?.split(";")[0] !== item.contentType)
                  throw new AccountFailure("unavailable");
                const blob = await r.blob();
                if (blob.size !== item.byteLength) throw new AccountFailure("unavailable");
                url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `evidence.${item.contentType === "image/png" ? "png" : "jpg"}`;
                a.click();
              } catch (e) {
                if (!lifetime.current?.signal.aborted) {
                  setError(e);
                  if (e instanceof AccountFailure && e.kind === "unauthorized")
                    await session.confirmSessionLoss(
                      lifetime.current?.signal ?? AbortSignal.abort(),
                    );
                  if (e instanceof AccountFailure && e.kind === "forbidden") {
                    client.removeQueries({
                      type: "inactive",
                      predicate: (query) => query.meta?.private === true,
                    });
                    await session.refresh();
                  }
                }
              } finally {
                if (url) URL.revokeObjectURL(url);
                if (!lifetime.current?.signal.aborted) setPending(false);
              }
            }}
          >
            {t("download")}
          </Button>
        </>
      )}
      {onRemove && (
        <Button type="button" variant="ghost" onClick={onRemove}>
          {t("remove")}
        </Button>
      )}
      <Failure error={error} />
    </article>
  );
}
export function EvidenceUpload({
  ids,
  onChange,
  onReady,
}: {
  ids: string[];
  onChange: (update: (ids: string[]) => string[]) => void;
  onReady: (ready: boolean) => void;
}) {
  const { t } = useTranslation("trips"),
    policy = useTripQuery("/me/upload-policy", "EnvelopeUploadPolicy"),
    command = useTripCommand(),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(false),
    [states, setStates] = useState<Record<string, DTO["Evidence"] | null>>({}),
    [hashing, setHashing] = useState(false);
  const p = policy.data?.data.data;
  const ready = ids.length > 0 && ids.every((id) => states[id]?.state === "ready");
  useEffect(() => onReady(ready), [ready, onReady]);
  return (
    <fieldset className="stack">
      <legend>{t("evidence")}</legend>
      <p>{t("uploadHelp")}</p>
      <State query={policy} />
      {p && !p.enabled && <p>{t("policyDisabled")}</p>}
      {p?.enabled && (
        <>
          <p>
            {t("uploadBounds", {
              types: p.allowedMimeTypes.join(", "),
              bytes: p.maxFileBytes,
              count: p.maxFilesPerReport,
            })}
          </p>
          <Label htmlFor="manual-file">{t("chooseFile")}</Label>
          <Input
            id="manual-file"
            type="file"
            accept={p.allowedMimeTypes.join(",")}
            disabled={command.pending || hashing}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(false);
            }}
          />
          <Button
            type="button"
            disabled={
              !file ||
              command.pending ||
              hashing ||
              command.seconds > 0 ||
              ids.length >= (p.maxFilesPerReport ?? 0)
            }
            onClick={async () => {
              if (
                !file ||
                !p.maxFileBytes ||
                file.size > p.maxFileBytes ||
                !p.allowedMimeTypes.includes(file.type)
              ) {
                setError(true);
                return;
              }
              setHashing(true);
              try {
                const hash = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
                )
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                const body = new FormData();
                body.append("file", file);
                const result = await command.run(
                  "/evidence",
                  body,
                  "EnvelopeEvidence",
                  undefined,
                  "POST",
                  JSON.stringify([hash, file.name, file.type]),
                );
                if (result) {
                  onChange((current) => [...new Set([...current, result.data.data.id])]);
                  setFile(null);
                }
              } catch {
                setError(true);
              } finally {
                setHashing(false);
              }
            }}
          >
            {t(command.pending || hashing ? "loading" : "upload")}
          </Button>
        </>
      )}
      {error && <p role="alert">{t("invalid")}</p>}
      <Failure error={command.failure} seconds={command.seconds} />
      {ids.map((id, index) => (
        <EvidenceState
          enabled={index === 0 || Object.hasOwn(states, ids[index - 1] ?? "")}
          key={id}
          id={id}
          remove={() => onChange((current) => current.filter((i) => i !== id))}
          update={setStates}
        />
      ))}
      <p>{t("retention")}</p>
    </fieldset>
  );
}
function EvidenceState({
  id,
  remove,
  update,
  enabled,
}: {
  id: string;
  remove: () => void;
  enabled: boolean;
  update: React.Dispatch<React.SetStateAction<Record<string, DTO["Evidence"] | null>>>;
}) {
  const observe = useCallback(
    (value: DTO["Evidence"] | null, checked: boolean) => {
      if (checked) update((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
    },
    [id, update],
  );
  return <EvidenceItem id={id} enabled={enabled} onRemove={remove} onState={observe} />;
}
export function EventSelect({
  value,
  onChange,
  game,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  game: "ets2" | "ats";
}) {
  const { t, i18n } = useTranslation("trips"),
    session = useSession(),
    timezone = session.self?.preferences.displayTimezone ?? "UTC",
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    [period, setPeriod] = useState("upcoming"),
    [cursor, setCursor] = useState<string | null>(null),
    query = useTripQuery(
      `/events?period=${period}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListEventPublic",
    );
  const items = query.data?.data.data.items ?? [];
  return (
    <div className="stack">
      <Label htmlFor="report-event">{t("event")}</Label>
      <select
        id="report-event"
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t("noEvent")}</option>
        {value && !items.some((e) => e.id === value) && <option value={value}>{value}</option>}
        {items
          .filter((e) => e.game === game)
          .map((e) => (
            <option value={e.id} key={e.id}>
              {e.title} · {formatUtc(e.startsAt, locale, timezone)} · {timezone}
            </option>
          ))}
      </select>
      <div className="trip-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setPeriod(period === "upcoming" ? "past" : "upcoming");
            setCursor(null);
          }}
        >
          {period === "upcoming" ? t("pastEvents") : t("upcomingEvents")}
        </Button>
        {query.data?.data.data.nextCursor && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCursor(query.data?.data.data.nextCursor ?? null)}
          >
            {t("next")}
          </Button>
        )}
      </div>
      <State query={query} />
      <p>{t("eventHelp")}</p>
      {value && <Link to={`/account/events/${value}`}>{t("events:eventLink")}</Link>}
    </div>
  );
}
