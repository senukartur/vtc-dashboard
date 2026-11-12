import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { EventFailureView, EventState, KeepFocusButton, useEventStarted } from "./components.js";
import type { DetailEvent } from "./EventDetailContent.js";
import type { DTO } from "./model.js";
import { useEventCommand, useEventQuery } from "./queries.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { eventStage2Reads } from "./stage-2-transport.js";
import { EventFailure } from "./transport.js";
import { responseChoiceKey, responseTone } from "./view-model.js";

type RefreshDetail = () => Promise<unknown>;

export function EventRoster({
  id,
  event,
  panelId,
  visible,
  responseVersion,
  staged,
  refreshDetail,
}: {
  id: string;
  event: DetailEvent;
  panelId: string;
  visible: boolean;
  responseVersion: number;
  staged: boolean;
  refreshDetail: RefreshDetail;
}) {
  return (
    <div className="events-roster stack" id={panelId} hidden={!visible}>
      {visible && (
        <>
          <Card>
            <Attendance id={id} event={event} staged={staged} refreshDetail={refreshDetail} />
          </Card>
          {staged && (
            <Card>
              <Nonresponders id={id} key={responseVersion} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Nonresponders({ id }: { id: string }) {
  const { t } = useTranslation("events");
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const [cursor, setCursor] = useState<string>();
  const query = useEventStage2Query(
    eventStage2Reads.nonresponders(id, { limit: 25, ...(cursor ? { cursor } : {}) }),
  );
  const data = query.data?.data.data;
  const focusHeading = () => heading.current?.focus();
  return (
    <section className="stack" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {t("nonresponders")}
      </h2>
      <EventState
        query={query}
        focusTarget={focusHeading}
        reset={cursor ? () => setCursor(undefined) : undefined}
      />
      {data && (
        <>
          {data.items.length > 0 ? (
            <ul className="events-chips">
              {data.items.map((member) => (
                <li key={member.id}>
                  <Link to={`/account/drivers/${member.id}`}>{member.nickname}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noNonresponders")}</p>
          )}
          <div className="events-pager">
            {cursor && (
              <KeepFocusButton
                variant="outline"
                focusTarget={focusHeading}
                onClick={() => setCursor(undefined)}
              >
                {t("first")}
              </KeepFocusButton>
            )}
            {data.nextCursor && (
              <KeepFocusButton
                variant="outline"
                focusTarget={focusHeading}
                onClick={() => setCursor(data.nextCursor ?? undefined)}
              >
                {t("next")}
              </KeepFocusButton>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Attendance({
  id,
  event,
  staged,
  refreshDetail,
}: {
  id: string;
  event: DetailEvent;
  staged: boolean;
  refreshDetail: RefreshDetail;
}) {
  type Row = DTO["AttendanceInput"]["members"][number];
  type Draft = Row & { nickname: string; reviewedEtag: string | null };
  const started = useEventStarted(event.startsAt);
  const submission = useRef<{
    body: DTO["AttendanceInput"];
    etag: string;
    signature: string;
  } | null>(null);
  const { t } = useTranslation("events"),
    heading = useRef<HTMLHeadingElement>(null),
    headingId = useId(),
    [cursor, setCursor] = useState<string | null>(null),
    [changes, setChanges] = useState<Record<string, Draft>>({}),
    [saved, setSaved] = useState(false),
    command = useEventCommand((failure) => {
      // Keep the original authority only while the command also retains its idempotency key.
      if (!["uncertain", "unavailable", "limited"].includes(failure.kind))
        submission.current = null;
      if (failure instanceof EventFailure && failure.status === 412) recoverCursor();
      if (staged && failure.kind === "conflict") {
        if (!cursor) void query.refetch();
        void refreshDetail();
      }
    }),
    stageQuery = useEventStage2Query(
      eventStage2Reads.attendance(id, { limit: 25, ...(cursor ? { cursor } : {}) }),
      staged,
    ),
    legacyQuery = useEventQuery(
      `/admin/events/${id}/attendance?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListAttendance",
      !staged,
    ),
    query = staged ? stageQuery : legacyQuery;
  const totals = staged ? stageQuery.data?.data.data.totals : undefined;
  const data = query.data?.data.data;
  const closed = event.status === "cancelled" || !started;
  const hintId = useId();
  const etag =
    query.data?.etag && /^"v[1-9][0-9]*"$/.test(query.data.etag) ? query.data.etag : null;
  const drafts = Object.values(changes);
  const body = {
    members: drafts.map(({ memberId, attendance, note }) => ({ memberId, attendance, note })),
  };
  const signature = JSON.stringify(body);
  const retrySubmission = submission.current?.signature === signature ? submission.current : null;
  const needsReview =
    !!etag && !retrySubmission && drafts.some((draft) => draft.reviewedEtag !== etag);
  const locked = closed || command.pending;
  const blocked =
    locked || command.seconds > 0 || !drafts.length || needsReview || (!etag && !retrySubmission);

  useEffect(() => {
    const title = heading.current;
    title?.focus({ preventScroll: true });
    title?.scrollIntoView({ block: "center" });
  }, []);

  function recoverCursor() {
    if (!submission.current) {
      setChanges((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([memberId, draft]) => [
            memberId,
            { ...draft, reviewedEtag: null },
          ]),
        ),
      );
    }
    setCursor(null);
  }

  return (
    <form
      className="stack"
      aria-labelledby={headingId}
      onSubmit={async (e) => {
        e.preventDefault();
        // The unavailable Record button stays focusable (aria-disabled); ignore it here.
        const submitted = retrySubmission ?? (etag ? { body, etag, signature } : null);
        if (blocked || !submitted) return;
        setSaved(false);
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
          setCursor(null);
          setSaved(true);
          if (staged) {
            if (!cursor) void query.refetch();
            await refreshDetail();
          }
        }
      }}
    >
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {t("attendance")}
      </h2>
      <p>{t("attendanceHelp")}</p>
      {drafts.length > 0 && (
        <section className="stack" aria-label={t("attendanceDrafts")}>
          <h3>{t("attendanceDrafts")}</h3>
          {needsReview && <p role="status">{t("reviewAttendance")}</p>}
          {drafts.map((draft) => (
            <div key={draft.memberId}>
              <p>
                {draft.nickname}: {t(draft.attendance)}
                {draft.note ? ` · ${draft.note}` : ""}
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={locked}
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
      {totals && (
        <dl className="events-attendance-totals">
          <div>
            <dt>{t("attendanceTotal")}</dt>
            <dd>{totals.total}</dd>
          </div>
          <div>
            <dt>{t("attended")}</dt>
            <dd>{totals.attended}</dd>
          </div>
          <div>
            <dt>{t("not_attended")}</dt>
            <dd>{totals.notAttended}</dd>
          </div>
          <div>
            <dt>{t("unconfirmed")}</dt>
            <dd>{totals.unconfirmed}</dd>
          </div>
        </dl>
      )}
      {data?.items.map((row) => {
        const draft = changes[row.member.id];
        return (
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
            {staged && "tripId" in row && typeof row.tripId === "string" && (
              <Link className="events-detail-link" to={`/account/trips/${row.tripId}`}>
                {t("attendanceTrip", { name: row.member.nickname })}
              </Link>
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
              disabled={locked || !etag}
              value={draft?.attendance ?? ""}
              onChange={(e) => {
                if (locked || !etag) return;
                setSaved(false);
                const value = e.target.value;
                setChanges((previous) => {
                  const previousDraft = previous[row.member.id];
                  const next = { ...previous };
                  if (!value) delete next[row.member.id];
                  else
                    next[row.member.id] = {
                      memberId: row.member.id,
                      nickname: row.member.nickname,
                      attendance: value as "attended" | "not_attended",
                      note: previousDraft?.note ?? null,
                      reviewedEtag: previousDraft ? previousDraft.reviewedEtag : etag,
                    };
                  return next;
                });
              }}
            >
              <option value="">{t("unchanged")}</option>
              <option value="attended">{t("attended")}</option>
              <option value="not_attended">{t("not_attended")}</option>
            </select>
            {draft && (
              <>
                <Label htmlFor={`note-${row.member.id}`}>
                  {t("note")} · {row.member.nickname}
                </Label>
                <Input
                  id={`note-${row.member.id}`}
                  maxLength={2048}
                  disabled={locked || !etag}
                  value={draft.note ?? ""}
                  onChange={(e) => {
                    if (locked || !etag) return;
                    setSaved(false);
                    const note = e.target.value || null;
                    setChanges((previous) => {
                      const current = previous[row.member.id];
                      return current
                        ? { ...previous, [row.member.id]: { ...current, note } }
                        : previous;
                    });
                  }}
                />
              </>
            )}
            {needsReview && draft && draft.reviewedEtag !== etag && (
              <KeepFocusButton
                variant="outline"
                disabled={locked || !etag}
                focusTarget={() => document.getElementById(`attendance-${row.member.id}`)?.focus()}
                onClick={() => {
                  if (locked || !etag) return;
                  setChanges((previous) => {
                    const draft = previous[row.member.id];
                    return draft
                      ? { ...previous, [row.member.id]: { ...draft, reviewedEtag: etag } }
                      : previous;
                  });
                }}
              >
                {t("keepAttendanceDraft")}
              </KeepFocusButton>
            )}
          </fieldset>
        );
      })}
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
