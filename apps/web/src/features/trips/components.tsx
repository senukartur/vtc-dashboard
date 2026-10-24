import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Badge, Button, Card } from "../../shared/ui/primitives.js";
import type { AccountFailure } from "../account/transport.js";
import { type DTO, revisionFields, TripFailure } from "./transport.js";
export function Failure({ error, seconds = 0 }: { error: unknown; seconds?: number }) {
  const { t } = useTranslation("trips");
  if (!error) return null;
  const safe = error as AccountFailure;
  return (
    <div role="alert" className="field-error">
      <p>
        {t(
          error instanceof TripFailure && error.status === 410
            ? "expired"
            : error instanceof TripFailure && error.status === 404
              ? "notFound"
              : safe.kind || "unavailable",
        )}
      </p>
      {seconds > 0 && <p>{t("wait", { seconds })}</p>}
    </div>
  );
}
export function State({
  query,
  refresh,
}: {
  refresh?: () => unknown;
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  const { t } = useTranslation("trips");
  return query.isPending ? (
    <p role="status">{t("loading")}</p>
  ) : query.isError ? (
    <>
      <Failure error={query.error} />
      <Button type="button" variant="outline" onClick={() => void (refresh ?? query.refetch)()}>
        {t("refresh")}
      </Button>
    </>
  ) : null;
}
export function Confirm({
  label,
  guard,
  children,
  onConfirm,
  disabled = false,
  pending = false,
  failure,
}: {
  label: string;
  guard: string;
  children: ReactNode;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  pending?: boolean;
  failure?: unknown;
}) {
  const { t } = useTranslation("trips"),
    [snapshot, setSnapshot] = useState<{
      guard: string;
      run: () => Promise<unknown>;
      content: ReactNode;
      failure: unknown;
    } | null>(null);
  useEffect(() => {
    if (
      snapshot &&
      (snapshot.guard !== guard ||
        (failure !== snapshot.failure &&
          (failure as AccountFailure | undefined)?.kind === "conflict"))
    )
      setSnapshot(null);
  }, [guard, failure, snapshot]);
  return (
    <Dialog
      open={!!snapshot}
      onOpenChange={(open) => {
        if (!open) setSnapshot(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => setSnapshot({ guard, run: onConfirm, content: children, failure })}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t("confirmTitle")}</DialogTitle>
        <DialogDescription>{t("confirmHelp")}</DialogDescription>
        <div className="stack trip-wrap">
          {snapshot?.content}
          <Failure error={failure} />
          <div className="trip-actions">
            <Button
              disabled={pending || !snapshot || snapshot.guard !== guard}
              onClick={async () => {
                const result = await snapshot?.run();
                if (result) setSnapshot(null);
              }}
            >
              {pending ? t("loading") : t("confirm")}
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                {t("cancel")}
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function Codes({ values }: { values: string[] }) {
  const { t } = useTranslation("trips");
  return values.length ? (
    <div>
      <span>{t("reasonCodes")}: </span>
      {values.map((c) => (
        <code className="trip-code" key={c}>
          {c}
        </code>
      ))}
    </div>
  ) : null;
}
export function Fields({ values }: { values: Record<string, unknown> }) {
  const { t } = useTranslation("trips");
  return (
    <dl className="trip-facts">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{t(key)}</dt>
          <dd>
            {value === null || value === undefined
              ? t("unknown")
              : Array.isArray(value)
                ? value.join(" · ")
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function TripSummary({ trip, link = true }: { trip: DTO["TripSummary"]; link?: boolean }) {
  const { t, i18n } = useTranslation("trips"),
    session = useSession(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  const label = (value: DTO["CatalogLabel"] | null) => (
    <>
      {value?.label ?? t("unknown")}
      {value?.englishFallback && (
        <small className="trip-fallback"> · {t("catalogs:fallback")}</small>
      )}
    </>
  );
  return (
    <article className="trip-row">
      <div>
        <div className="trip-actions">
          <Badge>{trip.game.toUpperCase()}</Badge>
          <Badge className={`status-${trip.decision}`}>{t(trip.decision)}</Badge>
          <Badge>{t(trip.outcome)}</Badge>
          <Badge>
            {t(
              trip.recording === "partial"
                ? "partialRecording"
                : trip.recording === "unknown"
                  ? "unknownRecording"
                  : (trip.recording ?? "unknownRecording"),
            )}
          </Badge>
        </div>
        <h2>
          {link ? (
            <Link to={`/account/trips/${trip.id}`}>
              {label(trip.origin)} → {label(trip.destination)}
            </Link>
          ) : (
            <>
              {label(trip.origin)} → {label(trip.destination)}
            </>
          )}
        </h2>
        <p>
          {trip.owner.nickname} · {label(trip.cargo)}
        </p>
        <p>{formatQuantity(trip.actualDistanceM, "km", locale)}</p>
        <small>
          {trip.sourceKinds.map((s) => t(s)).join(" + ")} · {t("version")} {trip.version}
        </small>
      </div>
      <div>
        <strong>{t("reportingAt")}</strong>
        <p>{formatUtc(trip.reportingAt, locale, timezone)}</p>
        <p>{t(trip.reportingBasis ?? "unknown")}</p>
        <small>{timezone}</small>
      </div>
    </article>
  );
}
export function EffectiveFacts({ facts }: { facts: DTO["EffectiveTripFacts"] | null | undefined }) {
  const { t, i18n } = useTranslation("trips"),
    session = useSession(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  if (!facts) return <p>{t("partial")}</p>;
  return (
    <Card className="stack">
      <h2>{t("facts")}</h2>
      <Fields
        values={{
          factRevisionId: facts.factRevisionId,
          actualStartAt: formatUtc(facts.actualStartAt, locale, timezone),
          actualCompletedAt: formatUtc(facts.actualCompletedAt, locale, timezone),
          actualDistanceM: formatQuantity(facts.actualDistanceM, "km", locale),
          plannedDistanceM: formatQuantity(facts.plannedDistanceM, "km", locale),
          cargoMassKg: formatQuantity(facts.cargoMassKg, "t", locale),
        }}
      />
      <p>{t("basisTime", { timezone })}</p>
      {(["origin", "destination", "cargo"] as const).map((k) => (
        <div key={k}>
          <strong>{t(k)}</strong>
          <Fields values={facts[k] ?? { [k]: null }} />
        </div>
      ))}
      {facts.trailers.map((pin, i) => (
        <div key={pin?.entityId ?? `unknown-${i}`}>
          <strong>
            {t("trailerType")} {i + 1}
          </strong>
          <Fields values={pin ?? { trailerType: null }} />
        </div>
      ))}
      {(!facts.ruleContextComplete ||
        !facts.wholeTripDistanceSupported ||
        !facts.trailersComplete) && <p>{t("partial")}</p>}
    </Card>
  );
}
export function Revision({
  revision,
  previous,
}: {
  revision: DTO["ManualRevisionRead"];
  previous?: DTO["ManualRevisionRead"];
}) {
  const { t } = useTranslation("trips"),
    fields = revisionFields(revision),
    lineage = "reportId" in revision ? revision.reportId : null,
    prior =
      previous &&
      lineage &&
      "reportId" in previous &&
      previous.reportId === lineage &&
      previous.number === revision.number - 1
        ? revisionFields(previous)
        : null;
  const selection = (value: DTO["ManualCatalogSelection"]) =>
    value.status === "resolved"
      ? `${value.entityId} · ${value.catalogRevisionId}`
      : [value.label, t(value.reasonCode), value.locale, value.context].filter(Boolean).join(" · ");
  const display = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? selection(v as DTO["ManualCatalogSelection"])
      : Array.isArray(v)
        ? v.join(" · ")
        : v === null
          ? t("unknown")
          : String(v);
  return (
    <section className="stack trip-revision">
      <h3>
        {t("revision")} {revision.number}
      </h3>
      <Fields
        values={{
          report: lineage,
          reviewedRevisionId: revision.id,
          submittedAt: revision.submittedAt,
        }}
      />
      {(!lineage || (revision.number > 1 && !prior)) && <p>{t("comparisonUnavailable")}</p>}
      {Object.entries(fields).map(([k, v]) => (
        <div key={k}>
          <strong>{t(k)}: </strong>
          <span>{display(v)}</span>
          {prior && JSON.stringify(prior[k as keyof typeof prior]) !== JSON.stringify(v) && (
            <p className="trip-change">
              {t("compare")}: <del>{display(prior[k as keyof typeof prior])}</del> →{" "}
              <ins>{display(v)}</ins>
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
export function PageNav({
  next,
  onNext,
  onPrevious,
  hasPrevious,
}: {
  next: string | null | undefined;
  onNext: (cursor: string) => void;
  onPrevious: () => void;
  hasPrevious: boolean;
}) {
  const { t } = useTranslation("trips");
  return (
    <div className="trip-actions">
      <Button type="button" variant="outline" disabled={!hasPrevious} onClick={onPrevious}>
        {t("previous")}
      </Button>
      <Button type="button" variant="outline" disabled={!next} onClick={() => next && onNext(next)}>
        {t("next")}
      </Button>
    </div>
  );
}
