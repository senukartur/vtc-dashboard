import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { refreshWorkspaceSummary } from "../../app/workspace-summary.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { AccountFailure } from "../account/transport.js";
import {
  EventFailureView,
  EventState,
  KeepFocusButton,
  useEventClock,
  useEventStarted,
  useEventTimezone,
} from "./components.js";
import {
  type DetailEvent,
  type DetailMember,
  DetailTime,
  EventLoad,
  EventOrganizer,
  EventRoute,
  EventSchedule,
  useDetailLocale,
} from "./EventDetailContent.js";
import { EventGallery, EventPublicCover } from "./EventDetailGallery.js";
import { useMemberDetailRead, usePublicDetailRead } from "./EventDetailReads.js";
import { EventRoster } from "./EventDetailRoster.js";
import { EventEditor } from "./EventEditor.js";
import { type DTO, eventTime, responseInput } from "./model.js";
import { useEventCommand, useEventQuery } from "./queries.js";
import { useEventStage2Command } from "./stage-2-queries.js";
import {
  type EventStage2Command,
  eventStage2Commands,
  eventStage2Content,
  eventStage2Reads,
} from "./stage-2-transport.js";
import {
  countsView,
  type EventPhase,
  eventPhase,
  hasPrescribedLoad,
  memberLabel,
  type ResponseValue,
  responseChoiceKey,
  responseTone,
} from "./view-model.js";
import "./events.css";
import "./events-workspace.css";
import "./events-detail.css";

type RefreshDetail = () => Promise<unknown>;

function stagedReadsAt(...paths: string[]) {
  const targets = paths.map((path) => path.split("?")[0]);
  return ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === "events-stage-2" && targets.includes(String(queryKey.at(-2)).split("?")[0]);
}

function refreshPublicDetail(client: QueryClient, id: string) {
  return client.invalidateQueries({
    predicate: stagedReadsAt(
      eventStage2Reads.publicDetail(id).path,
      eventStage2Content.publicCover(id).path,
    ),
  });
}

export function EventDetailPage({ publicView = false }: { publicView?: boolean }) {
  const { eventId = "" } = useParams();
  const session = useSession();
  const stage2Enabled = "eventsStage2Enabled" in session && session.eventsStage2Enabled === true;
  return publicView ? (
    <PublicDetail key={eventId} id={eventId} />
  ) : (
    <MemberDetail
      key={JSON.stringify([
        eventId,
        session.generation,
        session.self?.member.id,
        session.self?.identityEpoch,
        session.self?.capabilities,
        stage2Enabled,
      ])}
      id={eventId}
      stage2Enabled={stage2Enabled}
    />
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

function PublicDetail({ id }: { id: string }) {
  const locale = useDetailLocale();
  const { query, event } = usePublicDetailRead(id, locale);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="events-page events-detail stack" ref={root} tabIndex={-1}>
      <BackLink to="/events" />
      <EventState query={query} focusTarget={() => root.current?.focus()} />
      {event && (
        <>
          <EventHeading event={event} publicView />
          <div className="events-detail-layout">
            <div className="events-main stack">
              {event.hasCover && <EventPublicCover id={event.id} />}
              <EventDetails event={event} publicView />
            </div>
            <div className="events-side stack">
              <EventOrganizer name={event.organizer} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EventHeading({
  event,
  publicView = false,
  visibility,
  actions,
}: {
  event: DetailEvent;
  publicView?: boolean;
  visibility?: DetailMember["visibility"];
  actions?: ReactNode;
}) {
  const { t } = useTranslation("events");
  return (
    <Card className="events-header">
      <div className="events-header-top">
        <div className="events-header-text">
          <p className="events-header-meta">
            <span className="events-game">{event.game.toUpperCase()}</span>
            <Badge className={`events-status events-status-${event.status}`}>
              {t(event.status)}
            </Badge>
            {visibility && <span>{t(visibility)}</span>}
          </p>
          <h1>{event.title}</h1>
          <p className="events-header-time">
            <DetailTime value={event.startsAt} publicView={publicView} />
          </p>
          {visibility === "public" && <p className="muted">{t("publicNoLists")}</p>}
        </div>
        {actions}
      </div>
    </Card>
  );
}

function EventDetails({
  event,
  publicView = false,
  responsesOpen = false,
}: {
  event: DetailEvent;
  publicView?: boolean;
  responsesOpen?: boolean;
}) {
  const { t } = useTranslation("events");
  return (
    <>
      {event.description && (
        <Card>
          <h2>{t("description")}</h2>
          <p className="events-description">{event.description}</p>
        </Card>
      )}
      <Card>
        <EventSchedule event={event} publicView={publicView} responsesOpen={responsesOpen} />
      </Card>
      <Card>
        <EventRoute event={event} publicView={publicView} />
      </Card>
    </>
  );
}

function MemberDetail({ id, stage2Enabled: staged }: { id: string; stage2Enabled: boolean }) {
  const session = useSession();
  const capabilities = session.self?.capabilities ?? [];
  const allowed = capabilities.includes("company.read");
  const manager = capabilities.includes("events.manage");
  const respond = capabilities.includes("events.respond");
  const locale = useDetailLocale();
  const { query, snapshot: current } = useMemberDetailRead(id, locale, allowed, staged);
  const cancel = useEventStage2Command<"EventStage2EnvelopeMember">();
  const client = useQueryClient();
  const { t } = useTranslation("events");
  // Keep open forms mounted while the same session requests translated labels.
  const previousLocale = useRef<typeof current>(undefined);
  useEffect(() => {
    if (!query.isPending) previousLocale.current = current;
  }, [current, query.isPending]);
  const snapshot = current ?? (query.isPending ? previousLocale.current : undefined);
  const member = snapshot?.member;
  const event = member?.event;
  const etag = event && snapshot?.etag === `"v${event.version}"` ? snapshot.etag : null;
  const now = useEventClock(event?.startsAt ?? null);
  const phase = event ? eventPhase(event, now) : "open";
  const [attendance, setAttendance] = useState(false);
  const rosterId = useId();
  const root = useRef<HTMLDivElement>(null);

  async function refreshResponseDetail() {
    if (!staged) return;
    await Promise.all([
      query.refetch(),
      manager &&
        client.invalidateQueries({
          predicate: stagedReadsAt(
            eventStage2Reads.attendance(id).path,
            eventStage2Reads.nonresponders(id).path,
          ),
        }),
    ]);
  }

  async function cancelDefinition(attempt: Cancellation) {
    await cancel.run(attempt);
    void refreshWorkspaceSummary(client, session).catch(() => undefined);
    await client.invalidateQueries({
      predicate: ({ queryKey: key }) =>
        key[0] === "dashboard-upcoming-event" ||
        (key[0] === "events" &&
          key[1] === session.self?.member.id &&
          key[2] === session.generation &&
          /^\/events(?:\?|$)/.test(String(key.at(-2)))) ||
        (key[0] === "public-events" && /^\/public\/events(?:\?|$)/.test(String(key.at(-2)))),
    });
  }

  return (
    <div className="events-page events-detail stack" ref={root} tabIndex={-1}>
      <BackLink to="/account/events" />
      {!allowed ? (
        <p>{t("forbidden")}</p>
      ) : (
        <>
          {!member && <EventState query={query} focusTarget={() => root.current?.focus()} />}
          {member && event && (
            <>
              <EventHeading
                event={event}
                visibility={member.visibility}
                actions={
                  manager && (
                    <div className="events-actions">
                      {event.status !== "cancelled" && (
                        <>
                          {legacyEditable(member) && (
                            <LegacyEdit
                              member={member}
                              etag={etag}
                              staged={staged}
                              refreshDetail={query.refetch}
                            />
                          )}
                          <CancelEvent
                            id={id}
                            etag={etag}
                            title={event.title}
                            run={cancelDefinition}
                            pending={cancel.pending}
                            staged={staged}
                          />
                        </>
                      )}
                      <Button
                        variant="outline"
                        aria-controls={rosterId}
                        aria-expanded={attendance}
                        onClick={() => setAttendance(!attendance)}
                      >
                        {t("showAttendance")}
                      </Button>
                    </div>
                  )
                }
              />
              <div
                className={`events-detail-layout${respond ? " events-detail-with-response" : ""}`}
              >
                {respond && (
                  <ResponseSection
                    member={member}
                    phase={phase}
                    refreshDetail={refreshResponseDetail}
                  />
                )}
                <div className="events-main stack">
                  <EventGallery id={id} enabled={staged} />
                  <EventDetails event={event} responsesOpen={phase === "open" && respond} />
                  {(hasPrescribedLoad(member) ||
                    member.prescribedCargo ||
                    member.prescribedTrailerType) && (
                    <Card>
                      <EventLoad member={member} legacy={!staged} />
                    </Card>
                  )}
                  {capabilities.includes("trips.submit_own") && (
                    <Link className="events-report-link" to="/account/reports/new">
                      {t("viewReport")}
                    </Link>
                  )}
                </div>
                <div className="events-side stack">
                  <Participants
                    id={id}
                    counts={member.responseCounts}
                    version={member.myResponse.version}
                    selfId={session.self?.member.id}
                  />
                  <EventOrganizer name={event.organizer} memberId={member.organizerMemberId} />
                </div>
                {manager && (
                  <EventRoster
                    id={id}
                    event={event}
                    panelId={rosterId}
                    visible={attendance}
                    responseVersion={member.myResponse.version}
                    staged={staged}
                    refreshDetail={query.refetch}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function legacyEditable({ event, organizerMemberId }: DetailMember) {
  return (
    organizerMemberId === null &&
    event.platform === null &&
    event.originDepot === null &&
    event.destinationDepot === null &&
    event.distanceKm === null &&
    !event.requiredDlcs?.length &&
    !!event.description &&
    !!event.route &&
    !!event.meetingLocation
  );
}

function LegacyEdit({
  member,
  etag,
  staged,
  refreshDetail,
}: {
  member: DetailMember;
  etag: string | null;
  staged: boolean;
  refreshDetail: RefreshDetail;
}) {
  const { t } = useTranslation("events");
  const session = useSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  // Bridge the legacy command's invalidation to the Stage 2 cache after edits
  // and conflicts, without a second read when the editor opens.
  useQuery({
    queryKey: [
      "events",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      eventStage2Reads.publicDetail(member.event.id).path,
      "legacy-editor-refresh",
    ],
    meta: { private: true },
    enabled: open,
    initialData: true,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      await Promise.all([staged && refreshDetail(), refreshPublicDetail(client, member.event.id)]);
      return true;
    },
  });

  const { event } = member;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!etag}>
          {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="event-dialog">
        <DialogTitle>{t("edit")}</DialogTitle>
        <DialogDescription>{event.title}</DialogDescription>
        <EventEditor
          member={{
            ...member,
            event: {
              ...event,
              description: event.description ?? "",
              route: event.route ?? "",
              meetingLocation: event.meetingLocation ?? "",
            },
          }}
          etag={etag}
        />
        <DialogClose asChild>
          <Button variant="outline">{t("close")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
/** Own response for members with events.respond: the form while open, a summary afterwards. */
function ResponseSection({
  member,
  phase,
  refreshDetail,
}: {
  member: DetailMember;
  phase: EventPhase;
  refreshDetail: RefreshDetail;
}) {
  const { t } = useTranslation("events");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Card className="events-response" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {t("response")}
      </h2>
      {phase === "open" ? (
        <OpenResponse event={member.event} heading={heading} refreshDetail={refreshDetail} />
      ) : (
        <ClosedResponse member={member} phase={phase} />
      )}
    </Card>
  );
}
/** The response ETag is independent of the definition ETag. */
function OpenResponse({
  event,
  heading,
  refreshDetail,
}: {
  event: DetailEvent;
  heading: RefObject<HTMLHeadingElement | null>;
  refreshDetail: RefreshDetail;
}) {
  const query = useEventQuery(`/events/${event.id}/my-response`, "EnvelopeRsvp");
  const body = useRef<HTMLDivElement>(null);
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
        <ResponseForm
          event={event}
          response={query.data.data.data}
          etag={query.data.etag}
          refreshDetail={refreshDetail}
        />
      )}
    </div>
  );
}
function ResponseForm({
  event,
  response: current,
  etag,
  refreshDetail,
}: {
  event: DetailEvent;
  response: DTO["Rsvp"];
  etag: string | null;
  refreshDetail: RefreshDetail;
}) {
  const { t } = useTranslation("events");
  const locale = useDetailLocale();
  const timezone = useEventTimezone();
  const id = useId();
  const command = useEventCommand((failure) => {
    if (failure.kind === "conflict") void refreshDetail();
  });
  const [declineEditor, setDeclineEditor] = useState(current.response === "declined");
  const [reason, setReason] = useState(current.declineReason ?? "");
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const started = useEventStarted(event.startsAt);
  const blocked =
    event.status !== "scheduled" || started || command.pending || command.seconds > 0 || !etag;
  const state = responseTone(current.response);

  async function saveResponse(value: ResponseValue) {
    if (blocked || !etag) return;
    const input = responseInput(value, reason);
    setInvalid(!input);
    setSaved(false);
    if (!input) return;
    const result = await command.run(
      `/events/${event.id}/my-response`,
      input,
      "EnvelopeRsvp",
      etag,
      "PUT",
    );
    if (result) {
      setSaved(true);
      await refreshDetail();
    }
  }

  return (
    <form
      className="stack events-response-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (declineEditor) void saveResponse("declined");
      }}
    >
      <p className="muted">
        {t("responseDeadline", { start: eventTime(event.startsAt, locale, timezone) })}
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
        value={declineEditor ? "declined" : current.response}
        onValueChange={(value) => {
          if (blocked) return;
          setDeclineEditor(value === "declined");
          setSaved(false);
          setInvalid(false);
          if (value !== "declined" && value !== current.response) void saveResponse(value);
        }}
        options={(["participating", "declined", "unanswered"] as const).map((value) => ({
          value,
          label: t(responseChoiceKey(value)),
        }))}
      />
      {declineEditor && (
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
            onChange={(event) => {
              setReason(event.target.value);
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
      {command.pending && !declineEditor && <p role="status">{t("savingResponse")}</p>}
      {declineEditor && (
        <div className="events-form-actions">
          <Button aria-disabled={blocked || undefined}>
            {t(command.pending ? "savingResponse" : "respond")}
          </Button>
        </div>
      )}
    </form>
  );
}
/** After the start or a cancellation: the last own response and actual attendance, read-only. */
function ClosedResponse({ member, phase }: { member: DetailMember; phase: EventPhase }) {
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
  counts,
  selfId,
}: {
  id: string;
  version: number;
  counts: DetailMember["responseCounts"];
  selfId: string | undefined;
}) {
  const { t } = useTranslation("events");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const legacy = useEventQuery(
    `/events/${id}/response-counts`,
    "EnvelopeEventResponseCounts",
    counts === null,
  );
  const view = counts
    ? { state: "ready" as const, ...counts }
    : countsView({
        isPending: legacy.isPending,
        isError: legacy.isError,
        data: legacy.data?.data.data,
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
            <KeepFocusButton
              variant="outline"
              focusTarget={() => heading.current?.focus()}
              onClick={() => void legacy.refetch()}
            >
              {t("retryCounts")}
            </KeepFocusButton>
          )}
        </div>
      )}
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
type Cancellation = EventStage2Command<"EventStage2EnvelopeMember">;

function CancelEvent({
  id,
  etag,
  title,
  run,
  pending: stagedPending,
  staged,
}: {
  id: string;
  etag: string | null;
  title: string;
  run: (attempt: Cancellation) => Promise<void>;
  pending: boolean;
  staged: boolean;
}) {
  const { t } = useTranslation("events");
  const locale = useDetailLocale();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const trigger = useRef<HTMLButtonElement>(null);
  const prepared = useRef<{ reason: string; locale: string; attempt: Cancellation } | null>(null);
  const client = useQueryClient();
  const legacy = useEventCommand((error) => {
    if (error.kind === "conflict") void refreshPublicDetail(client, id);
  });
  const pending = staged ? stagedPending : legacy.pending;
  const seconds = staged ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : legacy.seconds;
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= waitUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" ref={trigger} disabled={!etag}>
          {t("cancel")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="event-dialog"
        onCloseAutoFocus={(event) => {
          if (!trigger.current?.isConnected) {
            event.preventDefault();
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
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (!trimmed || !etag || pending || seconds > 0) return;
            if (!staged) {
              const result = await legacy.run(
                `/admin/events/${id}/cancellation`,
                { reason: trimmed },
                "EnvelopeEventMember",
                etag,
              );
              if (result) {
                setOpen(false);
                await refreshPublicDetail(client, id);
              }
              return;
            }
            setFailure(null);
            try {
              const previous = prepared.current;
              const attempt =
                previous?.reason === trimmed && previous.locale === locale
                  ? previous.attempt
                  : eventStage2Commands.cancel(id, { reason: trimmed }, etag, locale);
              prepared.current = { reason: trimmed, locale, attempt };
              await run(attempt);
              prepared.current = null;
              setOpen(false);
            } catch (error) {
              const safe =
                error instanceof AccountFailure ? error : new AccountFailure("uncertain");
              if (!["uncertain", "unavailable", "limited"].includes(safe.kind))
                prepared.current = null;
              setFailure(safe);
              if (safe.retryAfter) {
                setWaitUntil(Date.now() + safe.retryAfter * 1000);
                setNow(Date.now());
              }
            }
          }}
        >
          <Label htmlFor={inputId}>{t("reason")}</Label>
          <Input
            id={inputId}
            required
            maxLength={2048}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
          <EventFailureView error={staged ? failure : legacy.failure} seconds={seconds} />
          <Button disabled={pending || seconds > 0 || !reason.trim() || !etag}>
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
