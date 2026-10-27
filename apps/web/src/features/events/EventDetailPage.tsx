import { useId, useRef, useState } from "react";
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
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { EventFacts, EventFailureView, EventState, useEventStarted } from "./components.js";
import { EventEditor } from "./EventEditor.js";
import { type DTO, responseInput } from "./model.js";
import { useEventCommand, useEventQuery } from "./queries.js";
import "./events.css";

export function EventDetailPage({ publicView = false }: { publicView?: boolean }) {
  const { eventId = "" } = useParams();
  return publicView ? (
    <PublicDetail key={eventId} id={eventId} />
  ) : (
    <MemberDetail key={eventId} id={eventId} />
  );
}
function PublicDetail({ id }: { id: string }) {
  const query = useEventQuery(`/public/events/${encodeURIComponent(id)}`, "EnvelopeEventPublic"),
    { t } = useTranslation("events"),
    event = query.data?.data.data;
  return (
    <div className="event-page stack">
      <Link to="/events">{t("back")}</Link>
      <EventState query={query} />
      {event && (
        <Card className="stack">
          <h1>{event.title}</h1>
          <EventFacts event={event} publicView />
        </Card>
      )}
    </div>
  );
}
function MemberDetail({ id }: { id: string }) {
  const session = useSession(),
    allowed = !!session.self?.capabilities.includes("company.read"),
    manager = !!session.self?.capabilities.includes("events.manage"),
    query = useEventQuery(`/events/${encodeURIComponent(id)}`, "EnvelopeEventMember", allowed),
    { t } = useTranslation("events");
  const member = query.data?.data.data,
    event = member?.event;
  const [editing, setEditing] = useState(false),
    [attendance, setAttendance] = useState(false);
  return (
    <div className="event-page stack">
      <Link to="/account/events">{t("back")}</Link>
      {!allowed ? (
        <p>{t("forbidden")}</p>
      ) : (
        <>
          <EventState query={query} />
          {member && event && (
            <>
              <Card className="stack">
                <h1>{event.title}</h1>
                <EventFacts event={event} />
                <p>
                  {t("visibility")}: {t(member.visibility)}
                </p>
                <dl className="event-facts">
                  <div>
                    <dt>{t("response")}</dt>
                    <dd>{t(member.myResponse.response)}</dd>
                  </div>
                  <div>
                    <dt>{t("ownAttendance")}</dt>
                    <dd>{t(member.myAttendance)}</dd>
                  </div>
                  {(
                    ["prescribedCargoId", "prescribedMassKg", "prescribedTrailerTypeId"] as const
                  ).map(
                    (k) =>
                      member[k] !== null && (
                        <div key={k}>
                          <dt>{t(k)}</dt>
                          <dd>{member[k]}</dd>
                        </div>
                      ),
                  )}
                </dl>
                <p>{t("exceptionHelp")}</p>
                {session.self?.capabilities.includes("trips.submit_own") && (
                  <Link to="/account/reports/new">{t("viewReport")}</Link>
                )}
                {manager && event.status !== "cancelled" && (
                  <div className="event-actions">
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
                    <CancelEvent id={id} etag={query.data?.etag ?? null} title={event.title} />
                  </div>
                )}
              </Card>
              {session.self?.capabilities.includes("events.respond") && <Response event={event} />}
              <Participants key={`${id}:${member.myResponse.version}`} id={id} />
              {manager && (
                <Card className="stack">
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
            </>
          )}
        </>
      )}
    </div>
  );
}
function Response({ event }: { event: DTO["EventPublic"] }) {
  const query = useEventQuery(`/events/${event.id}/my-response`, "EnvelopeRsvp"),
    { t } = useTranslation("events");
  return (
    <Card className="stack">
      <h2>{t("response")}</h2>
      <p>{t("responseHelp")}</p>
      <EventState query={query} />
      {query.data && (
        <ResponseForm event={event} response={query.data.data.data} etag={query.data.etag} />
      )}
    </Card>
  );
}
function ResponseForm({
  event,
  response: initial,
  etag,
}: {
  event: DTO["EventPublic"];
  response: DTO["Rsvp"];
  etag: string | null;
}) {
  const { t } = useTranslation("events"),
    id = useId(),
    command = useEventCommand(),
    [response, setResponse] = useState(initial.response),
    [reason, setReason] = useState(initial.declineReason ?? ""),
    [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const started = useEventStarted(event.startsAt);
  const closed = event.status !== "scheduled" || started;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = responseInput(response, reason);
        setInvalid(!input);
        setSaved(false);
        if (input && !closed && etag) {
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
      <Label htmlFor={`${id}-response`}>{t("response")}</Label>
      <select
        className="input"
        id={`${id}-response`}
        value={response}
        disabled={closed || command.pending}
        onChange={(e) => {
          setResponse(e.target.value as DTO["Rsvp"]["response"]);
          setSaved(false);
        }}
      >
        {["unanswered", "participating", "declined"].map((v) => (
          <option key={v} value={v}>
            {t(v)}
          </option>
        ))}
      </select>
      {response === "declined" && (
        <>
          <Label htmlFor={`${id}-reason`}>{t("declineReason")}</Label>
          <textarea
            className="input"
            id={`${id}-reason`}
            maxLength={2048}
            required
            value={reason}
            disabled={closed || command.pending}
            onChange={(e) => {
              setReason(e.target.value);
              setSaved(false);
            }}
          />
        </>
      )}
      {closed && <p>{t("responseClosed")}</p>}
      {invalid && <p role="alert">{t("invalid")}</p>}
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && <p role="status">{t("savedResponse")}</p>}
      <Button disabled={closed || command.pending || command.seconds > 0 || !etag}>
        {t(command.pending ? "loading" : "respond")}
      </Button>
    </form>
  );
}
function Participants({ id }: { id: string }) {
  const { t } = useTranslation("events"),
    [cursor, setCursor] = useState<string | null>(null),
    query = useEventQuery(
      `/events/${id}/participants?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListParticipant",
    ),
    data = query.data?.data.data;
  return (
    <Card className="stack">
      <h2>{t("participants")}</h2>
      <EventState query={query} reset={cursor ? () => setCursor(null) : undefined} />
      {data && (
        <>
          {data.items.length ? (
            <ul>
              {data.items.map((p) => (
                <li key={p.member.id}>
                  <Link to={`/account/drivers/${p.member.id}`}>{p.member.nickname}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("noParticipants")}</p>
          )}
          <div className="event-actions">
            {cursor && (
              <Button variant="outline" onClick={() => setCursor(null)}>
                {t("first")}
              </Button>
            )}
            {data.nextCursor && (
              <Button variant="outline" onClick={() => setCursor(data.nextCursor)}>
                {t("next")}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
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
  const started = useEventStarted(event.startsAt);
  const { t } = useTranslation("events"),
    [cursor, setCursor] = useState<string | null>(null),
    [changes, setChanges] = useState<Record<string, DTO["AttendanceInput"]["members"][number]>>({}),
    [saved, setSaved] = useState(false),
    command = useEventCommand(),
    query = useEventQuery(
      `/admin/events/${id}/attendance?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListAttendance",
    );
  const data = query.data?.data.data,
    closed = event.status === "cancelled" || !started;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        if (!closed && Object.keys(changes).length && query.data?.etag) {
          const result = await command.run(
            `/admin/events/${id}/attendance`,
            { members: Object.values(changes) },
            "EnvelopeCommandResult",
            query.data.etag,
            "PUT",
          );
          if (result) {
            setChanges({});
            setCursor(null);
            setSaved(true);
          } else setCursor(null);
        }
      }}
    >
      <h2>{t("attendance")}</h2>
      <p>{t("attendanceHelp")}</p>
      <EventState query={query} {...(cursor ? { reset: () => setCursor(null) } : {})} />
      {data?.items.map((row) => (
        <fieldset className="stack event-attendance-row" key={row.member.id}>
          <legend>{row.member.nickname}</legend>
          <p>
            {t("memberResponse")}: {t(row.response.response)} · {t("attendance")}:{" "}
            {t(row.attendance)}
          </p>
          {row.response.declineReason && (
            <p>
              {t("declineReason")}: {row.response.declineReason}
            </p>
          )}
          {row.note && (
            <p>
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
              const value = e.target.value;
              setChanges((previous) => {
                const next = { ...previous };
                if (!value) delete next[row.member.id];
                else
                  next[row.member.id] = {
                    memberId: row.member.id,
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
                onChange={(e) =>
                  setChanges((previous) => ({
                    ...previous,
                    [row.member.id]: {
                      ...(previous[row.member.id] as DTO["AttendanceInput"]["members"][number]),
                      note: e.target.value || null,
                    },
                  }))
                }
              />
            </>
          )}
        </fieldset>
      ))}
      <div className="event-actions">
        {cursor && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCursor(null);
            }}
          >
            {t("first")}
          </Button>
        )}
        {data?.nextCursor && (
          <Button type="button" variant="outline" onClick={() => setCursor(data.nextCursor)}>
            {t("next")}
          </Button>
        )}
      </div>
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && <p role="status">{t("savedAttendance")}</p>}
      <Button
        disabled={
          closed ||
          command.pending ||
          command.seconds > 0 ||
          !Object.keys(changes).length ||
          !query.data?.etag
        }
      >
        {t("recordAttendance")}
      </Button>
    </form>
  );
}
