import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import {
  EventFailureView,
  EventState,
  KeepFocusButton,
  useEventClock,
  useEventStarted,
  useEventTimezone,
} from "./components.js";
import { EventEditor } from "./EventEditor.js";
import { type DTO, eventTime, responseInput } from "./model.js";
import { useEventCommand, useEventQuery } from "./queries.js";
import { EventFailure } from "./transport.js";
import {
  countsView,
  type EventPhase,
  eventPhase,
  hasPrescribedLoad,
  memberLabel,
  type ResponseValue,
  responseChoiceKey,
  responseTone,
  showException,
} from "./view-model.js";
import "./events.css";
import "./events-workspace.css";

export function EventDetailPage({ publicView = false }: { publicView?: boolean }) {
  const { eventId = "" } = useParams();
  return publicView ? (
    <PublicDetail key={eventId} id={eventId} />
  ) : (
    <MemberDetail key={eventId} id={eventId} />
  );
}
function BackLink({ to }: { to: string }) {
  const { t } = useTranslation("events");
  return (
    <Link className="events-back" to={to}>
      <span aria-hidden="true">←</span> {t("back")}
    </Link>
  );
}
/** Public detail reads only the public event: no lists, counts, responses or attendance. */
function PublicDetail({ id }: { id: string }) {
  const query = useEventQuery(`/public/events/${encodeURIComponent(id)}`, "EnvelopeEventPublic"),
    event = query.data?.data.data,
    root = useRef<HTMLDivElement>(null);
  return (
    <div className="events-page events-detail stack" ref={root} tabIndex={-1}>
      <BackLink to="/events" />
      <EventState query={query} focusTarget={() => root.current?.focus()} />
      {event && (
        <Card className="events-header">
          <EventHeading event={event} />
          <EventFacts event={event} publicView />
        </Card>
      )}
    </div>
  );
}
function EventHeading({
  event,
  visibility,
  actions,
}: {
  event: DTO["EventPublic"];
  visibility?: DTO["EventMember"]["visibility"];
  actions?: ReactNode;
}) {
  const { t } = useTranslation("events");
  return (
    <div className="events-header-top">
      <div className="events-header-text">
        <p className="events-header-meta">
          <span className="events-game">{event.game.toUpperCase()}</span>
          <Badge className={`events-status events-status-${event.status}`}>{t(event.status)}</Badge>
        </p>
        <h1>{event.title}</h1>
        {visibility && (
          <p className="muted">
            {t("visibility")}: {t(visibility)}
          </p>
        )}
        {visibility === "public" && <p className="muted">{t("publicNoLists")}</p>}
      </div>
      {actions}
    </div>
  );
}
function EventFacts({
  event,
  publicView = false,
  phase,
}: {
  event: DTO["EventPublic"];
  publicView?: boolean;
  phase?: EventPhase;
}) {
  const { t, i18n } = useTranslation("events"),
    timezone = useEventTimezone(publicView),
    locale = i18n.resolvedLanguage ?? "en";
  const time = (value: string) => (
    <time dateTime={value}>{eventTime(value, locale, timezone)}</time>
  );
  return (
    <>
      <dl className="events-facts">
        <div>
          <dt>{t("startsAt")}</dt>
          <dd>
            {time(event.startsAt)}
            {phase === "open" && <span className="events-fact-note">{t("responseClosed")}</span>}
          </dd>
        </div>
        <div>
          <dt>{t("meetingAt")}</dt>
          <dd>{time(event.meetingAt)}</dd>
        </div>
        <div>
          <dt>{t("meetingLocation")}</dt>
          <dd>{event.meetingLocation}</dd>
        </div>
        <div>
          <dt>{t("route")}</dt>
          <dd>{event.route}</dd>
        </div>
        <div>
          <dt>{t("server")}</dt>
          <dd>{event.server}</dd>
        </div>
        <div>
          <dt>{t("organizer")}</dt>
          <dd>{event.organizer}</dd>
        </div>
        {event.endsAt && (
          <div>
            <dt>{t("endsAt")}</dt>
            <dd>{time(event.endsAt)}</dd>
          </div>
        )}
      </dl>
      <p className="events-description">{event.description}</p>
    </>
  );
}
function MemberDetail({ id }: { id: string }) {
  const session = useSession(),
    capabilities = session.self?.capabilities ?? [],
    allowed = capabilities.includes("company.read"),
    manager = capabilities.includes("events.manage"),
    respond = capabilities.includes("events.respond"),
    query = useEventQuery(`/events/${encodeURIComponent(id)}`, "EnvelopeEventMember", allowed),
    { t } = useTranslation("events");
  const member = query.data?.data.data,
    event = member?.event;
  const now = useEventClock(event?.startsAt ?? null),
    phase = event ? eventPhase(event, now) : "open";
  const [editing, setEditing] = useState(false),
    [attendance, setAttendance] = useState(false),
    root = useRef<HTMLDivElement>(null);
  return (
    <div className="events-page events-detail stack" ref={root} tabIndex={-1}>
      <BackLink to="/account/events" />
      {!allowed ? (
        <p>{t("forbidden")}</p>
      ) : (
        <>
          <EventState query={query} focusTarget={() => root.current?.focus()} />
          {member && event && (
            <div className="events-detail-layout">
              <div className="events-main stack">
                <Card className="events-header">
                  <EventHeading
                    event={event}
                    visibility={member.visibility}
                    actions={
                      manager &&
                      event.status !== "cancelled" && (
                        <div className="events-actions">
                          <Dialog open={editing} onOpenChange={setEditing}>
                            <DialogTrigger asChild>
                              <Button variant="outline">{t("edit")}</Button>
                            </DialogTrigger>
                            <DialogContent className="event-dialog">
                              <DialogTitle>{t("edit")}</DialogTitle>
                              <DialogDescription>{event.title}</DialogDescription>
                              <EventEditor member={member} etag={query.data?.etag ?? null} />
                              <DialogClose asChild>
                                <Button variant="outline">{t("close")}</Button>
                              </DialogClose>
                            </DialogContent>
                          </Dialog>
                          <CancelEvent
                            id={id}
                            etag={query.data?.etag ?? null}
                            title={event.title}
                          />
                        </div>
                      )
                    }
                  />
                  <EventFacts event={event} phase={phase} />
                  {hasPrescribedLoad(member) && <PrescribedLoad member={member} />}
                  {capabilities.includes("trips.submit_own") && (
                    <Link className="events-report-link" to="/account/reports/new">
                      {t("viewReport")}
                    </Link>
                  )}
                </Card>
                {respond && <ResponseSection member={member} phase={phase} />}
              </div>
              <div className="events-side stack">
                <Participants
                  id={id}
                  version={member.myResponse.version}
                  selfId={session.self?.member.id}
                />
              </div>
              {manager && (
                <Card className="events-roster">
                  <Button
                    variant="outline"
                    aria-expanded={attendance}
                    onClick={() => setAttendance(!attendance)}
                  >
                    {t("showAttendance")}
                  </Button>
                  {attendance && <Attendance id={id} event={event} />}
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function PrescribedLoad({ member }: { member: DTO["EventMember"] }) {
  const { t } = useTranslation("events"),
    headingId = useId();
  return (
    <section className="events-load" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("load")}</h2>
      <dl className="events-facts">
        {member.prescribedMassKg !== null && (
          <div>
            <dt>{t("prescribedMassKg")}</dt>
            <dd className="events-break">{member.prescribedMassKg}</dd>
          </div>
        )}
        {member.prescribedCargoId !== null && (
          <div>
            <dt>{t("prescribedCargoId")}</dt>
            <dd className="events-break">{member.prescribedCargoId}</dd>
          </div>
        )}
        {member.prescribedTrailerTypeId !== null && (
          <div>
            <dt>{t("prescribedTrailerTypeId")}</dt>
            <dd className="events-break">{member.prescribedTrailerTypeId}</dd>
          </div>
        )}
      </dl>
      {showException(member) && <p className="events-exception">{t("exceptionHelp")}</p>}
    </section>
  );
}
/** Own response for members with events.respond: the form while open, a summary afterwards. */
function ResponseSection({ member, phase }: { member: DTO["EventMember"]; phase: EventPhase }) {
  const { t } = useTranslation("events"),
    headingId = useId(),
    heading = useRef<HTMLHeadingElement>(null);
  return (
    <Card className="events-response" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {t("response")}
      </h2>
      {phase === "open" ? (
        <OpenResponse event={member.event} heading={heading} />
      ) : (
        <ClosedResponse member={member} phase={phase} />
      )}
    </Card>
  );
}
/** Own response while open. my-response is read only here, so never after the start. */
function OpenResponse({
  event,
  heading,
}: {
  event: DTO["EventPublic"];
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const query = useEventQuery(`/events/${event.id}/my-response`, "EnvelopeRsvp"),
    body = useRef<HTMLDivElement>(null);
  // At the start or a cancellation the form is replaced by the summary. If focus was inside it,
  // move focus to the section heading instead of losing it to the document body.
  useLayoutEffect(() => {
    const node = body.current;
    return () => {
      if (node?.contains(document.activeElement)) queueMicrotask(() => heading.current?.focus());
    };
  }, [heading]);
  return (
    <div className="stack events-response-body" ref={body}>
      <EventState query={query} focusTarget={() => heading.current?.focus()} />
      {query.data && (
        <ResponseForm event={event} response={query.data.data.data} etag={query.data.etag} />
      )}
    </div>
  );
}
function ResponseForm({
  event,
  response: current,
  etag,
}: {
  event: DTO["EventPublic"];
  response: DTO["Rsvp"];
  etag: string | null;
}) {
  const { t, i18n } = useTranslation("events"),
    timezone = useEventTimezone(),
    id = useId(),
    command = useEventCommand(),
    [response, setResponse] = useState(current.response),
    [reason, setReason] = useState(current.declineReason ?? ""),
    [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const started = useEventStarted(event.startsAt);
  const closed = event.status !== "scheduled" || started,
    // Unavailable Save stays focusable (aria-disabled); the submit handler ignores it.
    blocked = closed || command.pending || command.seconds > 0 || !etag,
    state = responseTone(current.response);
  return (
    <form
      className="stack events-response-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (blocked) return;
        const input = responseInput(response, reason);
        setInvalid(!input);
        setSaved(false);
        if (input && etag) {
          const result = await command.run(
            `/events/${event.id}/my-response`,
            input,
            "EnvelopeRsvp",
            etag,
            "PUT",
          );
          if (result) setSaved(true);
        }
      }}
    >
      <p className="muted">
        {t("responseDeadline", {
          start: eventTime(event.startsAt, i18n.resolvedLanguage ?? "en", timezone),
        })}
      </p>
      <p className={`events-state events-tone-${state.tone}`}>
        <span aria-hidden="true">{state.symbol}</span>{" "}
        {t(
          current.response === "participating"
            ? "stateParticipating"
            : current.response === "declined"
              ? "stateDeclined"
              : "stateUnanswered",
        )}
      </p>
      <SegmentedControl<ResponseValue>
        aria-label={t("response")}
        size="sm"
        className="events-choice"
        value={response}
        onValueChange={(value) => {
          // A pending command keeps its body; changes are ignored until it settles.
          if (command.pending) return;
          setResponse(value);
          setSaved(false);
        }}
        options={(["participating", "declined", "unanswered"] as const).map((value) => ({
          value,
          label: t(responseChoiceKey(value)),
        }))}
      />
      {response === "declined" && (
        <div className="field">
          <Label htmlFor={`${id}-reason`}>{t("declineReason")}</Label>
          <textarea
            className="input"
            id={`${id}-reason`}
            maxLength={2048}
            required
            aria-describedby={`${id}-hint`}
            value={reason}
            readOnly={command.pending}
            onChange={(e) => {
              setReason(e.target.value);
              setSaved(false);
            }}
          />
          <p className="muted" id={`${id}-hint`}>
            {t("declineHint")}
          </p>
        </div>
      )}
      {invalid && <p role="alert">{t("invalid")}</p>}
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && (
        <p role="status" className="confirmation">
          {t("savedResponse")}
        </p>
      )}
      <div className="events-form-actions">
        <Button aria-disabled={blocked || undefined}>
          {t(command.pending ? "savingResponse" : "respond")}
        </Button>
      </div>
    </form>
  );
}
/** After the start or a cancellation: the last own response and actual attendance, read-only. */
function ClosedResponse({ member, phase }: { member: DTO["EventMember"]; phase: EventPhase }) {
  const { t } = useTranslation("events"),
    own = member.myResponse,
    tone = responseTone(own.response);
  return (
    <>
      <dl className="events-summary">
        <div>
          <dt>{t("responseBeforeStart")}</dt>
          <dd className={`events-tone-${tone.tone}`}>
            <span aria-hidden="true">{tone.symbol}</span> {t(responseChoiceKey(own.response))}
          </dd>
          {own.response === "declined" && own.declineReason && (
            <dd className="events-reason">
              {t("declineReason")}: {own.declineReason}
            </dd>
          )}
        </div>
        <div>
          <dt>{t("attendance")}</dt>
          <dd>{t(member.myAttendance)}</dd>
        </div>
      </dl>
      {phase === "cancelled" ? (
        <p>{t("cancelledClosed")}</p>
      ) : (
        <p className="muted">{t("attendanceSeparate")}</p>
      )}
    </>
  );
}
/** Safe names and counts for members; reasons and unanswered members never appear here. */
function Participants({
  id,
  version,
  selfId,
}: {
  id: string;
  version: number;
  selfId: string | undefined;
}) {
  const { t } = useTranslation("events"),
    headingId = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    counts = useEventQuery(`/events/${id}/response-counts`, "EnvelopeEventResponseCounts"),
    view = countsView({
      isPending: counts.isPending,
      isError: counts.isError,
      data: counts.data?.data.data,
    });
  return (
    <Card className="events-participants" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {t("participantsTitle")}
      </h2>
      {view.state === "ready" ? (
        <p className="events-counts">
          <span className="events-tone-participating">
            <span aria-hidden="true">✓</span>{" "}
            {t("countParticipating", { count: view.participating })}
          </span>
          <span className="events-tone-declined">
            <span aria-hidden="true">✕</span> {t("countDeclined", { count: view.declined })}
          </span>
        </p>
      ) : (
        <div className="events-counts-row">
          <p className="muted events-counts">
            {t(view.state === "loading" ? "countsLoading" : "countsUnavailable")}
          </p>
          {view.state === "unavailable" && (
            // Without cached counts the refetch replaces this button; focus then moves to the heading.
            <KeepFocusButton
              variant="outline"
              focusTarget={() => heading.current?.focus()}
              onClick={() => void counts.refetch()}
            >
              {t("retryCounts")}
            </KeepFocusButton>
          )}
        </div>
      )}
      {/* A committed own response re-keys the lists so they restart from the current first page. */}
      <MemberList key={`participants:${version}`} id={id} kind="participants" selfId={selfId} />
      <MemberList key={`decliners:${version}`} id={id} kind="decliners" selfId={selfId} />
      <p className="muted">{t("listPrivacy")}</p>
    </Card>
  );
}
function MemberList({
  id,
  kind,
  selfId,
}: {
  id: string;
  kind: "participants" | "decliners";
  selfId: string | undefined;
}) {
  const { t } = useTranslation("events"),
    headingId = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    [cursor, setCursor] = useState<string | null>(null),
    query = useEventQuery(
      `/events/${id}/${kind}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListParticipant",
    ),
    data = query.data?.data.data;
  /** The page (and its pager) is replaced while it loads, so focus moves to the list heading. */
  function page(next: string | null) {
    setCursor(next);
  }
  /** Paging replaces the page and its pager while loading; focus then moves to the list heading. */
  const focusHeading = () => heading.current?.focus();
  return (
    <section className="events-members" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>
        {t(kind === "participants" ? "signedUp" : "cantAttend")}
      </h3>
      <EventState
        query={query}
        reset={cursor ? () => page(null) : undefined}
        focusTarget={focusHeading}
      />
      {data && (
        <>
          {data.items.length ? (
            <ul className="events-chips">
              {data.items.map((p) => {
                const label = memberLabel(p.member, selfId);
                return (
                  <li key={p.member.id}>
                    <Link to={`/account/drivers/${p.member.id}`}>{p.member.nickname}</Link>
                    {label.self && <span className="muted"> {t("you")}</span>}
                    {label.former && <span className="muted"> · {t("formerMember")}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">{t(kind === "participants" ? "noParticipants" : "noDecliners")}</p>
          )}
          {(cursor || data.nextCursor) && (
            <div className="events-pager">
              {cursor && (
                <KeepFocusButton
                  variant="outline"
                  focusTarget={focusHeading}
                  onClick={() => page(null)}
                >
                  {t("first")}
                </KeepFocusButton>
              )}
              {data.nextCursor && (
                <KeepFocusButton
                  variant="outline"
                  focusTarget={focusHeading}
                  onClick={() => page(data.nextCursor)}
                >
                  {t("next")}
                </KeepFocusButton>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
function CancelEvent({ id, etag, title }: { id: string; etag: string | null; title: string }) {
  const { t } = useTranslation("events"),
    inputId = useId(),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    command = useEventCommand();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" ref={trigger}>
          {t("cancel")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="event-dialog"
        onCloseAutoFocus={(e) => {
          if (!trigger.current?.isConnected) {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }
        }}
      >
        <DialogTitle>
          {t("cancel")}: {title}
        </DialogTitle>
        <DialogDescription>{t("cancelHelp")}</DialogDescription>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason.trim() || !etag) return;
            if (
              await command.run(
                `/admin/events/${id}/cancellation`,
                { reason: reason.trim() },
                "EnvelopeEventMember",
                etag,
              )
            )
              setOpen(false);
          }}
        >
          <Label htmlFor={inputId}>{t("reason")}</Label>
          <Input
            id={inputId}
            required
            maxLength={2048}
            value={reason}
            disabled={command.pending}
            onChange={(e) => setReason(e.target.value)}
          />
          <EventFailureView error={command.failure} seconds={command.seconds} />
          <Button disabled={command.pending || command.seconds > 0 || !reason.trim() || !etag}>
            {t("confirm")}
          </Button>
        </form>
        <DialogClose asChild>
          <Button variant="outline">{t("close")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
function Attendance({ id, event }: { id: string; event: DTO["EventPublic"] }) {
  type Row = DTO["AttendanceInput"]["members"][number];
  type Draft = Row & { nickname: string };
  const started = useEventStarted(event.startsAt);
  const submission = useRef<{
    body: DTO["AttendanceInput"];
    etag: string;
    signature: string;
  } | null>(null);
  const { t } = useTranslation("events"),
    heading = useRef<HTMLHeadingElement>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [changes, setChanges] = useState<Record<string, Draft>>({}),
    [needsReview, setNeedsReview] = useState(false),
    [reviewed, setReviewed] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false),
    command = useEventCommand((failure) => {
      if (failure instanceof EventFailure && failure.status === 412) recoverCursor(true);
    }),
    query = useEventQuery(
      `/admin/events/${id}/attendance?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListAttendance",
    );
  const data = query.data?.data.data,
    closed = event.status === "cancelled" || !started,
    hintId = useId(),
    etag = query.data?.etag,
    body = {
      members: Object.values(changes).map(({ memberId, attendance, note }) => ({
        memberId,
        attendance,
        note,
      })),
    },
    signature = JSON.stringify(body),
    retrySubmission = submission.current?.signature === signature ? submission.current : null,
    reviewComplete =
      !!retrySubmission ||
      !needsReview ||
      Object.keys(changes).every((memberId) => reviewed[memberId] === etag),
    blocked =
      closed ||
      command.pending ||
      command.seconds > 0 ||
      !Object.keys(changes).length ||
      !reviewComplete ||
      (!etag && !retrySubmission);
  function recoverCursor(rejected = false) {
    if (rejected) submission.current = null;
    if (Object.keys(changes).length && !submission.current) {
      setNeedsReview(true);
      setReviewed({});
    }
    setCursor(null);
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        // The unavailable Record button stays focusable (aria-disabled); ignore it here.
        if (blocked) return;
        setSaved(false);
        if (!closed && Object.keys(changes).length && (retrySubmission || etag) && reviewComplete) {
          const submitted = retrySubmission ?? { body, etag: etag as string, signature };
          submission.current = submitted;
          const result = await command.run(
            `/admin/events/${id}/attendance`,
            submitted.body,
            "EnvelopeCommandResult",
            submitted.etag,
            "PUT",
          );
          if (result) {
            setChanges({});
            submission.current = null;
            setNeedsReview(false);
            setReviewed({});
            setCursor(null);
            setSaved(true);
          }
        }
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        {t("attendance")}
      </h2>
      <p>{t("attendanceHelp")}</p>
      {Object.keys(changes).length > 0 && (
        <section className="stack" aria-label={t("attendanceDrafts")}>
          <h3>{t("attendanceDrafts")}</h3>
          {needsReview && <p role="status">{t("reviewAttendance")}</p>}
          {Object.values(changes).map((draft) => (
            <div key={draft.memberId}>
              <p>
                {draft.nickname}: {t(draft.attendance)}
                {draft.note ? ` · ${draft.note}` : ""}
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={command.pending}
                onClick={() => {
                  setSaved(false);
                  setChanges((previous) => {
                    const next = { ...previous };
                    delete next[draft.memberId];
                    return next;
                  });
                }}
              >
                {t("removeDraft")}
              </Button>
            </div>
          ))}
        </section>
      )}
      <EventState
        query={query}
        focusTarget={() => heading.current?.focus()}
        {...(cursor ? { reset: () => recoverCursor() } : {})}
      />
      {data?.items.map((row) => (
        <fieldset className="stack event-attendance-row" key={row.member.id}>
          <legend>{row.member.nickname}</legend>
          <p className="events-roster-line">
            <span>
              {t("memberResponse")}:{" "}
              <span className={`events-tone-${row.response.response}`}>
                <span aria-hidden="true">{responseTone(row.response.response).symbol}</span>{" "}
                {t(responseChoiceKey(row.response.response))}
              </span>
            </span>
            <span>
              {t("attendance")}: {t(row.attendance)}
            </span>
          </p>
          {row.response.declineReason && (
            <p className="events-reason">
              {t("declineReason")}: {row.response.declineReason}
            </p>
          )}
          {row.note && (
            <p className="events-reason">
              {t("note")}: {row.note}
            </p>
          )}
          <Label htmlFor={`attendance-${row.member.id}`}>
            {t("attendance")} · {row.member.nickname}
          </Label>
          <select
            className="input"
            id={`attendance-${row.member.id}`}
            disabled={closed || command.pending}
            value={changes[row.member.id]?.attendance ?? ""}
            onChange={(e) => {
              setSaved(false);
              const value = e.target.value;
              setChanges((previous) => {
                const next = { ...previous };
                if (!value) delete next[row.member.id];
                else
                  next[row.member.id] = {
                    memberId: row.member.id,
                    nickname: row.member.nickname,
                    attendance: value as "attended" | "not_attended",
                    note: previous[row.member.id]?.note ?? null,
                  };
                return next;
              });
            }}
          >
            <option value="">{t("unchanged")}</option>
            <option value="attended">{t("attended")}</option>
            <option value="not_attended">{t("not_attended")}</option>
          </select>
          {changes[row.member.id] && (
            <>
              <Label htmlFor={`note-${row.member.id}`}>
                {t("note")} · {row.member.nickname}
              </Label>
              <Input
                id={`note-${row.member.id}`}
                maxLength={2048}
                disabled={command.pending}
                value={changes[row.member.id]?.note ?? ""}
                onChange={(e) => {
                  setSaved(false);
                  setChanges((previous) => ({
                    ...previous,
                    [row.member.id]: {
                      ...(previous[row.member.id] as Draft),
                      note: e.target.value || null,
                    },
                  }));
                }}
              />
            </>
          )}
          {needsReview && changes[row.member.id] && (
            <Button
              type="button"
              variant="outline"
              disabled={!etag || command.pending || reviewed[row.member.id] === etag}
              onClick={() => {
                if (etag) setReviewed((previous) => ({ ...previous, [row.member.id]: etag }));
              }}
            >
              {t(reviewed[row.member.id] === etag ? "draftReviewed" : "keepAttendanceDraft")}
            </Button>
          )}
        </fieldset>
      ))}
      <div className="events-pager">
        {cursor && (
          <KeepFocusButton
            type="button"
            variant="outline"
            focusTarget={() => heading.current?.focus()}
            onClick={() => {
              setCursor(null);
            }}
          >
            {t("first")}
          </KeepFocusButton>
        )}
        {data?.nextCursor && (
          <KeepFocusButton
            type="button"
            variant="outline"
            focusTarget={() => heading.current?.focus()}
            onClick={() => setCursor(data.nextCursor)}
          >
            {t("next")}
          </KeepFocusButton>
        )}
      </div>
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && <p role="status">{t("savedAttendance")}</p>}
      {!started && event.status !== "cancelled" && (
        <p className="muted" id={hintId}>
          {t("attendanceAfterStart")}
        </p>
      )}
      <div className="events-form-actions">
        <Button
          aria-disabled={blocked || undefined}
          aria-describedby={!started && event.status !== "cancelled" ? hintId : undefined}
        >
          {t("recordAttendance")}
        </Button>
      </div>
    </form>
  );
}
