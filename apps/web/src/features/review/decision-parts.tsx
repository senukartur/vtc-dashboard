import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import {
  type Game,
  itemSchema,
  type Kind,
  listOfKind,
} from "../../shared/catalog-selectors/contracts.js";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { evidenceContent } from "../manual-reports/fields.js";
import { Confirm, Failure, Fields } from "../trips/components.js";
import { useTripCommand } from "../trips/queries.js";
import { type DTO, TripFailure } from "../trips/transport.js";
import {
  type CheckRow,
  type Choice,
  checkRows,
  type DiffRow,
  decisionBody,
  decisionState,
  diffRows,
  type HistoryItem,
  previousRevision,
} from "./review-model.js";

type Locale = "ru" | "en";
function useLocale(): Locale {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === "en" ? "en" : "ru";
}

/** One panel section with its own heading. */
export function ReviewSection({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`review-section${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="review-section-head">
        <h3 id={id}>{title}</h3>
        {note && <span className="review-section-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** A reason code in words when it has a translation, otherwise the code itself. */
export function CodeLabel({ code }: { code: string }) {
  const { t, i18n } = useTranslation("trips");
  return i18n.exists(`trips:code_${code}`) ? (
    t(`code_${code}`)
  ) : (
    <code className="review-break">{code}</code>
  );
}

/** Localized label of a pinned catalog entity; the canonical ID stays available as text. */
export function EntityLabel({
  entityId,
  game,
  kind,
}: {
  entityId: string;
  game: Game;
  kind: Kind;
}) {
  const { t } = useTranslation("trips"),
    locale = useLocale(),
    query = useCatalogQuery(
      ["review-entity", kind, entityId, locale],
      `/catalogs/${listOfKind[kind]}/${entityId}?locale=${locale}`,
      itemSchema,
    ),
    entity = query.data?.data.data,
    valid = entity?.id === entityId && entity.game === game;
  return (
    <span className="review-entity">
      {valid ? entity.display.label : query.isPending ? t("loading") : t("unknownEntity")}
      {valid && <CatalogNativeName value={entity.display} />}
      {valid && entity.display.englishFallback && (
        <small className="trip-fallback"> · {t("catalogs:fallback")}</small>
      )}
      {valid && entity.display.hidden && (
        <small className="trip-fallback"> · {t("catalogs:hidden")}</small>
      )}
      <span className="visually-hidden"> {entityId}</span>
    </span>
  );
}

/** Why the trip waits for staff: the trip's stored review reasons, localized where known. */
export function HoldReasons({ codes }: { codes: readonly string[] }) {
  const { t } = useTranslation("trips");
  if (!codes.length) return null;
  return (
    <p className="review-hold">
      <strong>{t("heldBecause")}:</strong>{" "}
      {codes.map((code, index) => (
        <span key={code}>
          {index > 0 && " · "}
          <CodeLabel code={code} />
        </span>
      ))}
    </p>
  );
}

/**
 * Compact effective facts of the trip (telemetry or confirmed manual facts). Unknown values read
 * as unavailable and are never shown as zero.
 */
export function TripFacts({
  facts,
  game,
}: {
  facts: DTO["EffectiveTripFacts"] | null | undefined;
  game: Game;
}) {
  const { t } = useTranslation("trips"),
    locale = useLocale(),
    session = useSession(),
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  if (!facts)
    return (
      <ReviewSection title={t("tripFacts")}>
        <p className="review-muted">{t("partial")}</p>
      </ReviewSection>
    );
  const pin = (value: DTO["EffectiveCatalogPin"] | null, kind: Kind) =>
    value ? <EntityLabel entityId={value.entityId} game={game} kind={kind} /> : t("unknown");
  const rows: [string, ReactNode][] = [
    ["origin", pin(facts.origin, "city")],
    ["destination", pin(facts.destination, "city")],
    ["cargo", pin(facts.cargo, "cargo")],
    ["cargoMassDisplay", formatQuantity(facts.cargoMassKg, "t", locale)],
    [
      "trailersList",
      facts.trailers.length
        ? facts.trailers.map((trailer, index) => (
            // Trailer order is the fact order; an unknown slot has no entity ID to key by.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional trailer slots
            <span key={index}>
              {index > 0 && ", "}
              {pin(trailer, "trailer")}
            </span>
          ))
        : t("unknown"),
    ],
    ["actualDistanceDisplay", formatQuantity(facts.actualDistanceM, "km", locale)],
    ["plannedDistanceM", formatQuantity(facts.plannedDistanceM, "km", locale)],
    ["actualStartAt", formatUtc(facts.actualStartAt, locale, timezone)],
    ["actualCompletedAt", formatUtc(facts.actualCompletedAt, locale, timezone)],
  ];
  return (
    <ReviewSection title={t("tripFacts")} note={t("factsSource", { source: t(facts.provider) })}>
      <dl className="review-facts">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{t(key)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {(!facts.ruleContextComplete ||
        !facts.wholeTripDistanceSupported ||
        !facts.trailersComplete) && <p className="review-muted">{t("partial")}</p>}
    </ReviewSection>
  );
}

const catalogKind: Partial<Record<DiffRow["field"], Kind>> = {
  origin: "city",
  destination: "city",
  cargo: "cargo",
  trailerType: "trailer",
};
function FieldValue({
  field,
  value,
  game,
}: {
  field: DiffRow["field"];
  value: DiffRow["current"];
  game: Game;
}) {
  const { t } = useTranslation("trips"),
    locale = useLocale(),
    kind = catalogKind[field];
  if (kind && value && typeof value === "object" && !Array.isArray(value)) {
    const selection = value as DTO["ManualCatalogSelection"];
    return selection.status === "resolved" ? (
      <EntityLabel entityId={selection.entityId} game={game} kind={kind} />
    ) : (
      <>
        {selection.label} <small className="review-muted">· {t(selection.reasonCode)}</small>
      </>
    );
  }
  if (field === "game" && typeof value === "string") return value.toUpperCase();
  if (field === "cargoMassKg" && typeof value === "string")
    return formatQuantity(value, "t", locale);
  if (field === "actualDistanceM" && typeof value === "string")
    return formatQuantity(value, "km", locale);
  if (field === "eventId")
    return typeof value === "string" ? <code className="review-break">{value}</code> : t("noEvent");
  if (field === "comment")
    return typeof value === "string" ? (
      <span className="review-multiline">{value}</span>
    ) : (
      t("noComment")
    );
  if (field === "evidenceIds" && Array.isArray(value))
    return t("screenshotCount", { count: value.length });
  return value === null || value === undefined ? t("unknown") : String(value);
}

const fieldLabel: Record<DiffRow["field"], string> = {
  game: "game",
  origin: "origin",
  destination: "destination",
  cargo: "cargo",
  cargoMassKg: "cargoMassDisplay",
  trailerType: "trailerType",
  actualDistanceM: "actualDistanceDisplay",
  eventId: "eventId",
  comment: "commentField",
  evidenceIds: "evidence",
};

/** The reviewed revision beside the previous revision of the same report, if one is proven. */
export function RevisionDiff({
  revision,
  revisions,
  game,
}: {
  revision: DTO["ManualRevisionRead"];
  revisions: { isPending: boolean; isError: boolean; items: DTO["ManualRevisionRead"][] };
  game: Game;
}) {
  const { t } = useTranslation("trips"),
    previous = revisions.isError ? null : previousRevision(revision, revisions.items),
    rows = diffRows(revision, previous),
    later = revision.number > 1;
  const note = !later
    ? t("firstSubmission")
    : previous
      ? t("comparedWith", { number: previous.number })
      : revisions.isPending
        ? t("loading")
        : revisions.isError
          ? t("revisionsFailed")
          : t("comparisonUnavailable");
  return (
    <ReviewSection title={t("reportData")} note={note}>
      <table className="review-diff" data-compared={previous ? "true" : undefined}>
        <thead>
          <tr>
            <th scope="col">{t("field")}</th>
            <th scope="col">{t("currentColumn", { number: revision.number })}</th>
            {previous && <th scope="col">{t("previousColumn", { number: previous.number })}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} data-changed={row.changed ? "true" : undefined}>
              <th scope="row">{t(fieldLabel[row.field])}</th>
              <td>
                <FieldValue field={row.field} value={row.current} game={game} />
                {row.changed && <Badge className="review-changed">{t("changed")}</Badge>}
              </td>
              {previous && (
                <td className="review-previous">
                  <FieldValue field={row.field} value={row.previous ?? null} game={game} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ReviewSection>
  );
}

/** Image of one evidence item, loaded on demand while its dialog is open. */
function EvidenceImage({ item, label }: { item: DTO["Evidence"]; label: string }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    client = useQueryClient(),
    [state, setState] = useState<{ url: string | null; error: unknown }>({
      url: null,
      error: null,
    }),
    access = useRef({ session, client }),
    { id, contentType, byteLength } = item;
  useLayoutEffect(() => {
    access.current = { session, client };
  });
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    evidenceContent({ id, contentType, byteLength }, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: null });
      },
      async (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ url: null, error });
        const current = access.current;
        if (error instanceof AccountFailure && error.kind === "unauthorized")
          await current.session.confirmSessionLoss(controller.signal);
        if (error instanceof AccountFailure && error.kind === "forbidden") {
          current.client.removeQueries({
            type: "inactive",
            predicate: (query) => query.meta?.private === true,
          });
          await current.session.refresh();
        }
      },
    );
    // Closing the viewer aborts a pending read and revokes the object URL.
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, contentType, byteLength]);
  if (state.error)
    return (
      <p className="field-error">
        {t(
          state.error instanceof TripFailure && state.error.status === 410
            ? "expiredShort"
            : "imageUnavailable",
        )}
      </p>
    );
  if (!state.url) return <p>{t("loading")}</p>;
  return <img className="review-evidence-image" src={state.url} alt={label} />;
}

function EvidenceViewer({ item, number }: { item: DTO["Evidence"]; number: number }) {
  const { t } = useTranslation("trips"),
    [open, setOpen] = useState(false),
    label = t("evidenceNumber", { number });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="review-view">
          {t("view")}
          <span className="visually-hidden"> {label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div className="review-evidence-viewer">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="review-break">{item.originalName}</DialogDescription>
          {open && <EvidenceImage item={item} label={label} />}
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("closeViewer")}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Private screenshots of the report; images load only when a reviewer opens one. */
export function EvidenceList({ evidence }: { evidence: DTO["Evidence"][] }) {
  const { t } = useTranslation("trips");
  return (
    <ReviewSection title={t("evidenceTitle")} note={t("evidenceNote")}>
      {evidence.length ? (
        <ul className="review-evidence">
          {evidence.map((item, index) => (
            <li key={item.id}>
              <span className="review-evidence-name">
                <strong className="review-break">{item.originalName}</strong>
                <small className="review-muted">
                  {t(item.state === "expired" ? "expiredShort" : item.state)}
                </small>
              </span>
              {item.state === "ready" && <EvidenceViewer item={item} number={index + 1} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="review-muted">{t("noEvidence")}</p>
      )}
    </ReviewSection>
  );
}

function RuleDetail({ row, game }: { row: CheckRow; game: Game }) {
  const { t } = useTranslation("trips"),
    locale = useLocale();
  if (row.observedMassKg && row.limitMassKg)
    return (
      <>
        {t("massDetail", {
          observed: formatQuantity(row.observedMassKg, "t", locale),
          limit: formatQuantity(row.limitMassKg, "t", locale),
        })}
      </>
    );
  if (row.ruleType === "allowed_adr_categories" && row.entityIds.length)
    return (
      <>
        {t("notAllowed")}{" "}
        {row.entityIds.map((value) => t("catalogs:adrClass", { class: value })).join(", ")}
      </>
    );
  if (row.entityIds.length)
    return (
      <>
        {t("notAllowed")} <Entities ids={row.entityIds} game={game} kind="trailer" />
      </>
    );
  return row.reasonCode ? <CodeLabel code={row.reasonCode} /> : null;
}
function Entities({ ids, game, kind }: { ids: string[]; game: Game; kind: Kind }) {
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 && ", "}
          <EntityLabel entityId={id} game={game} kind={kind} />
        </span>
      ))}
    </>
  );
}

/** Historical qualification rules for the reviewed fact; every state has a symbol and text. */
export function QualificationCheckList({
  check,
  game,
}: {
  check: DTO["QualificationCheck"];
  game: Game;
}) {
  const { t } = useTranslation("trips"),
    rows = checkRows(check);
  return (
    <ReviewSection title={t("check")} note={t("checkBasis")}>
      {rows.length ? (
        <ul className="review-checks">
          {rows.map((row) => (
            <li key={row.key} data-state={row.state}>
              <span className="review-check-symbol" aria-hidden="true">
                {row.symbol}
              </span>
              <span className="review-check-text">
                <span className="review-check-title">
                  <span className="visually-hidden">{t(`state_${row.state}`)}: </span>
                  {row.ruleType ? t(row.ruleType) : t("state_unavailable")}
                  {row.ruleType && (
                    <small className="review-check-state" aria-hidden="true">
                      {" · "}
                      {t(`state_${row.state}`)}
                    </small>
                  )}
                </span>
                <span className="review-check-detail">
                  <RuleDetail row={row} game={game} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="review-muted">{t("noRules")}</p>
      )}
    </ReviewSection>
  );
}

/** Submitted revisions and decisions, newest first, with reviewer and over-limit marker. */
export function ReviewHistory({ items, timezone }: { items: HistoryItem[]; timezone: string }) {
  const { t } = useTranslation("trips"),
    locale = useLocale();
  return (
    <ReviewSection title={t("reviewHistory")}>
      {items.length ? (
        <ol className="review-history">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              data-kind={item.kind}
              data-outcome={item.kind === "decision" ? item.outcome : undefined}
            >
              <span className="review-history-title">
                <strong>
                  {item.kind === "revision"
                    ? t("revisionSubmitted", { number: item.number })
                    : t(`outcome_${item.outcome}`)}
                </strong>
                {item.kind === "decision" && item.overLimits && (
                  <Badge className="review-marker">{t("overLimitsMarker")}</Badge>
                )}
              </span>
              <span className="review-muted">
                {item.kind === "decision" && (
                  <>
                    <span className="review-break">{item.reviewer ?? t("system")}</span>
                    {" · "}
                  </>
                )}
                {formatUtc(item.at, locale, timezone)}
              </span>
              {item.kind === "decision" && item.reason && (
                <p className="review-multiline">
                  {t("reasonQuote")} {item.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="review-muted">{t("noHistory")}</p>
      )}
    </ReviewSection>
  );
}

function LimitList({
  id,
  rules,
  game,
}: {
  id?: string;
  rules: DTO["QualificationRuleCheck"][];
  game: Game;
}) {
  const { t } = useTranslation("trips"),
    locale = useLocale();
  return (
    <ul id={id} className="review-limits">
      {rules.map((rule) => (
        <li key={`${rule.ruleType}-${rule.reasonCode}`}>
          {rule.ruleType === "max_mass" && rule.observedMassKg && rule.limitMassKg ? (
            t("limitMass", {
              observed: formatQuantity(rule.observedMassKg, "t", locale),
              limit: formatQuantity(rule.limitMassKg, "t", locale),
            })
          ) : rule.entityIds.length &&
            ["allowed_trailer_types", "allowed_adr_categories"].includes(rule.ruleType) ? (
            <>
              {t(rule.ruleType === "allowed_adr_categories" ? "limitAdr" : "limitTrailer")}{" "}
              {rule.ruleType === "allowed_adr_categories" ? (
                rule.entityIds.map((value) => t("catalogs:adrClass", { class: value })).join(", ")
              ) : (
                <Entities ids={rule.entityIds} game={game} kind="trailer" />
              )}
            </>
          ) : (
            <CodeLabel code={rule.reasonCode} />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Accept or reject the visible revision. The form mirrors the server's review read: own reports
 * get a note and no controls, unavailable acceptance is explained, and an over-limit acceptance
 * needs an explicit confirmation that resets whenever the review version changes.
 */
export function DecisionForm({
  tripId,
  review,
  etag,
}: {
  tripId: string;
  review: DTO["Review"];
  etag: string | null;
}) {
  const { t } = useTranslation("trips"),
    command = useTripCommand(),
    [choice, setChoice] = useState<Choice | null>(null),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState<{ etag: string | null; value: boolean }>({
      etag: null,
      value: false,
    }),
    [success, setSuccess] = useState(false),
    heading = useRef<HTMLHeadingElement>(null),
    headingId = useId(),
    visibleId = useId(),
    unavailableId = useId(),
    limitsId = useId(),
    blockerId = useId();
  // The checkbox confirms the limits of one review version; a refreshed review needs a new tick.
  const confirmed = confirmation.value && confirmation.etag === etag,
    state = decisionState({ review, choice, reason, confirmed, seconds: command.seconds }),
    game = review.trip.summary.game,
    mode = review.acceptance.mode,
    decided = ["accepted", "rejected"].includes(review.trip.summary.decision);
  // A closing confirmation returns focus to its trigger, which may be disabled by then (for
  // example after a conflict reset the checkbox). Only if focus fell back to the document, move
  // it to the decision heading.
  useEffect(() => {
    if (!success && !command.failure) return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [success, command.failure]);
  const title = (
    <h3 id={headingId} ref={heading} tabIndex={-1}>
      {t(decided ? "newDecision" : "decisionTitle")}
    </h3>
  );
  if (state.blocker === "self")
    return (
      <section className="review-section review-form" aria-labelledby={headingId}>
        {title}
        <p className="review-note" role="note">
          {t("selfReview")}
        </p>
      </section>
    );
  if (state.blocker === "blocked")
    return (
      <section className="review-section review-form" aria-labelledby={headingId}>
        {title}
        <div className="review-note">
          <p>{t("blocked")}</p>
          {review.blockedReasonCodes.length > 0 && (
            <ul>
              {review.blockedReasonCodes.map((code) => (
                <li key={code}>
                  <CodeLabel code={code} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  const unavailable = mode === "unavailable",
    body = choice ? decisionBody({ review, choice, reason, confirmed }) : null,
    overLimits = body?.confirmOverLimits === true;
  function pick(next: Choice) {
    if (next === "accept" && unavailable) return;
    setChoice(next);
    setSuccess(false);
  }
  const blockerText =
    state.blocker && state.blocker !== "wait" ? t(`blocker_${state.blocker}`) : null;
  return (
    <section className="review-section review-form" aria-labelledby={headingId}>
      {title}
      <fieldset className="review-choice" aria-labelledby={headingId}>
        <button
          type="button"
          id="review-choice-accept"
          className="review-choice-item"
          data-choice="accept"
          aria-pressed={choice === "accept"}
          aria-disabled={unavailable || undefined}
          aria-describedby={unavailable ? unavailableId : undefined}
          onClick={() => pick("accept")}
        >
          <span aria-hidden="true">✓</span> {t("chooseAccept")}
        </button>
        <button
          type="button"
          id="review-choice-reject"
          className="review-choice-item"
          data-choice="reject"
          aria-pressed={choice === "reject"}
          onClick={() => pick("reject")}
        >
          <span aria-hidden="true">✕</span> {t("chooseReject")}
        </button>
      </fieldset>
      {unavailable && (
        <div id={unavailableId} className="review-note">
          {state.blockedCodes.length ? (
            <>
              <p>{t("acceptUnavailable")}</p>
              <ul>
                {state.blockedCodes.map((code) => (
                  <li key={code}>
                    <CodeLabel code={code} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("blocker_unavailable")}</p>
          )}
        </div>
      )}
      <div className="review-field">
        <label htmlFor="review-reason">
          {t(state.reasonLabel === "rejection" ? "reasonRejection" : "reasonNote")}
        </label>
        <textarea
          id="review-reason"
          className="input"
          required
          maxLength={2048}
          aria-describedby={visibleId}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setSuccess(false);
          }}
        />
        <small id={visibleId} className="review-muted">
          {t("reasonVisible")}
        </small>
      </div>
      {state.needsConfirmation && (
        <fieldset className="review-over-limits">
          <legend className="review-over-title">
            <span aria-hidden="true">! </span>
            {t("overTitle")}
          </legend>
          <LimitList id={limitsId} rules={state.exceeded} game={game} />
          <p className="review-muted">{t("overHelp")}</p>
          <label className="review-check-option">
            <input
              type="checkbox"
              id="review-confirm-limits"
              aria-describedby={limitsId}
              checked={confirmed}
              onChange={(event) => {
                setConfirmation({ etag, value: event.target.checked });
                setSuccess(false);
              }}
            />
            {t("overConfirm")}
          </label>
        </fieldset>
      )}
      <Failure error={command.failure} seconds={command.seconds} />
      {success && <p role="status">{t("success")}</p>}
      <div className="review-submit">
        <Confirm
          label={t(state.submitLabel === "record" ? "recordDecision" : state.submitLabel)}
          variant="default"
          guard={JSON.stringify([
            etag,
            body?.reviewedRevisionId,
            review.factRevisionId,
            reason,
            choice,
            confirmed,
            overLimits,
          ])}
          disabled={!state.canSubmit}
          pending={command.pending}
          failure={command.failure}
          describedBy={blockerText ? blockerId : undefined}
          onConfirm={async () => {
            if (!choice) return;
            const r = await command.run(
              `/trips/${tripId}/decisions`,
              decisionBody({ review, choice, reason, confirmed }),
              "EnvelopeDecision",
              etag,
            );
            if (r) setSuccess(true);
            return r;
          }}
        >
          <div className="review-confirm">
            <Fields
              values={{
                decision: choice ? t(choice) : null,
                version: review.trip.summary.version,
                reviewedRevisionId: body?.reviewedRevisionId,
                factRevisionId: review.factRevisionId,
              }}
            />
            {overLimits && (
              <>
                <p>
                  <strong>{t("overLimitsMarker")}</strong>
                </p>
                <LimitList rules={state.exceeded} game={game} />
              </>
            )}
            <p className="review-multiline">{reason}</p>
          </div>
        </Confirm>
        {blockerText && (
          <small id={blockerId} className="review-muted">
            {blockerText}
          </small>
        )}
      </div>
      <p className="review-muted">{t("revisionNote")}</p>
    </section>
  );
}
