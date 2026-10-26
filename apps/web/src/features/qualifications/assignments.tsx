import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Input, Label } from "../../shared/ui/primitives.js";
import { Confirm, Failure, LevelContext, MemberContext, Recovery } from "./components.js";
import { useQualificationCommand } from "./queries.js";
import { type DTO, type Game, levelOrder, utcInput } from "./transport.js";

export function AssignmentEditor({
  game,
  memberId,
  memberName,
  levels,
  progress,
  etag,
  former,
  onRefresh,
}: {
  game: Game;
  memberId: string;
  memberName: string;
  levels: DTO["QualificationLevel"][];
  progress: DTO["Progress"] | undefined;
  etag: string | null;
  former: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand(
      {
        kind: "member",
        id: memberId,
        game,
        rolePromotionLevelId: levels.find((level) => level.code === "driver_iii")?.id ?? null,
      },
      onRefresh,
    );
  const [levelId, setLevel] = useState(""),
    [purpose, setPurpose] = useState<DTO["AssignmentInput"]["purpose"]>("initial"),
    [reason, setReason] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [success, setSuccess] = useState(false);
  const historical = purpose === "historical_resolution",
    assignedAt = utcInput(start),
    endedAt = utcInput(end),
    current = levels.find((l) => l.id === progress?.assignment.levelId),
    next = levels.find(
      (l) => levelOrder.indexOf(l.code) === levelOrder.indexOf(current?.code ?? "driver_i") + 1,
    );
  const ready =
    !!etag &&
    !!levelId &&
    !!reason.trim() &&
    (!historical ||
      (!!assignedAt && !!endedAt && assignedAt < endedAt && Date.parse(endedAt) < Date.now())) &&
    (!former || historical);
  const input: DTO["AssignmentInput"] = {
    game,
    levelId,
    purpose,
    reason,
    ...(historical && assignedAt && endedAt ? { assignedAt, endedAt } : {}),
  };
  const guard = JSON.stringify([memberId, etag, input, progress?.assignment.id, next?.id]);
  async function confirm(promote: boolean) {
    const result = await command.run(
      `/admin/members/${memberId}/${promote ? "promotions" : "qualification-assignments"}`,
      promote
        ? { game, assignmentId: progress?.assignment.id, targetLevelId: next?.id, reason }
        : input,
      "EnvelopeAssignment",
      etag,
    );
    if (result) {
      setSuccess(true);
    }
    return result;
  }
  return (
    <Card className="stack">
      <h2>{t("assign")}</h2>
      <p>{t("historicalHelp")}</p>
      <fieldset className="stack" disabled={command.pending}>
        <Label htmlFor="assignment-purpose">{t("purpose")}</Label>
        <select
          className="input"
          id="assignment-purpose"
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value as typeof purpose);
            setSuccess(false);
          }}
        >
          {(
            [
              "initial",
              "reinstatement",
              "administrative_correction",
              "historical_resolution",
            ] as const
          ).map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
        <Label htmlFor="assignment-level">{t("level")}</Label>
        <select
          className="input"
          id="assignment-level"
          value={levelId}
          onChange={(e) => {
            setLevel(e.target.value);
            setSuccess(false);
          }}
        >
          <option value="">—</option>
          {[...levels]
            .sort((a, b) => levelOrder.indexOf(a.code) - levelOrder.indexOf(b.code))
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name === t(l.code) ? l.name : `${t(l.code)} · ${l.name}`}
              </option>
            ))}
        </select>
        {historical && (
          <>
            <Label htmlFor="assignment-start">{t("assignedAt")}</Label>
            <Input
              id="assignment-start"
              type="datetime-local"
              step="0.001"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <Label htmlFor="assignment-end">{t("endedAt")}</Label>
            <Input
              id="assignment-end"
              type="datetime-local"
              step="0.001"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <p>
              UTC · [ {assignedAt ?? "—"}, {endedAt ?? "—"} )
            </p>
          </>
        )}
        <Label htmlFor="assignment-reason">{t("reason")}</Label>
        <Input
          id="assignment-reason"
          value={reason}
          maxLength={2048}
          onChange={(e) => {
            setReason(e.target.value);
            setSuccess(false);
          }}
        />
      </fieldset>
      <div className="qualification-actions">
        <Confirm
          label={t("assign")}
          guard={guard}
          disabled={!ready || command.seconds > 0}
          pending={command.pending || command.seconds > 0}
          failure={command.failure}
          onConfirm={() => confirm(false)}
        >
          <MemberContext name={memberName} id={memberId} />
          <LevelContext level={levels.find((l) => l.id === levelId)} />
          <p>{t(purpose)}</p>
          <p>{reason}</p>
          {historical && (
            <p>
              UTC · [{assignedAt}, {endedAt})
            </p>
          )}
        </Confirm>
        <Confirm
          label={t("promote")}
          guard={guard}
          disabled={
            !progress?.eligibleForConfirmation ||
            !next ||
            former ||
            !etag ||
            !reason.trim() ||
            command.seconds > 0
          }
          pending={command.pending || command.seconds > 0}
          failure={command.failure}
          onConfirm={() => confirm(true)}
        >
          <MemberContext name={memberName} id={memberId} />
          <LevelContext level={next} />
          <p>
            {current ? t(current.code) : t("unknown")} ({current?.name}) →{" "}
            {next ? t(next.code) : t("unknown")} ({next?.name})
          </p>
          <p>{t("promoteHelp")}</p>
          <p>{reason}</p>
        </Confirm>
      </div>
      <Failure error={command.failure} seconds={command.seconds} />
      <Recovery
        command={command}
        onRecovered={() => {
          setSuccess(true);
        }}
      />
      {success && <p role="status">{t("success")}</p>}
    </Card>
  );
}
