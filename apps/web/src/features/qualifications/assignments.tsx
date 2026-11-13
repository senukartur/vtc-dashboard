import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Input, Label } from "../../shared/ui/primitives.js";
import {
  Confirm,
  Failure,
  LevelContext,
  MemberContext,
  PageNav,
  Recovery,
  State,
} from "./components.js";
import { useQualificationCommand, useQualificationQuery } from "./queries.js";
import { type DTO, type Game, utcInput } from "./transport.js";

type ArchivedLevel = DTO["QualificationArchivedLevel"];

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
        rolePromotionLevelId: levels.find((level) => level.position === 2)?.id ?? null,
      },
      onRefresh,
    );
  const [levelId, setLevel] = useState(""),
    [purpose, setPurpose] = useState<DTO["AssignmentInput"]["purpose"]>("initial"),
    [reason, setReason] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [archived, setArchived] = useState<ArchivedLevel>(),
    [success, setSuccess] = useState(false);
  const historical = purpose === "historical_resolution",
    assignedAt = utcInput(start),
    endedAt = utcInput(end),
    current = levels.find((l) => l.id === progress?.assignment.levelId),
    next = current && levels.find((l) => l.position === current.position + 1);
  const active = levels.find((level) => level.id === levelId && level.game === game);
  const archivedTarget = historical && archived?.game === game ? archived : undefined;
  const ready =
    !!etag &&
    !!(active || archivedTarget) &&
    !!reason.trim() &&
    (!historical ||
      (!!assignedAt && !!endedAt && assignedAt < endedAt && Date.parse(endedAt) < Date.now())) &&
    (!former || historical);
  const input: DTO["AssignmentInput"] = {
    game,
    levelId: archivedTarget?.id ?? levelId,
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
            const nextPurpose = e.target.value as typeof purpose;
            setPurpose(nextPurpose);
            if (historical !== (nextPurpose === "historical_resolution")) setArchived(undefined);
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
          value={archivedTarget ? "" : levelId}
          onChange={(e) => {
            setLevel(e.target.value);
            setArchived(undefined);
            setSuccess(false);
          }}
        >
          <option value="">—</option>
          {[...levels]
            .sort((a, b) => a.position - b.position)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        {historical && (
          <>
            <ArchivedLevelPicker
              key={game}
              game={game}
              selected={archivedTarget}
              onSelect={(level) => {
                setArchived(level);
                if (level) setLevel("");
                setSuccess(false);
              }}
            />
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
          {archivedTarget ? (
            <p className="qualification-command-context">
              <strong>
                {archivedTarget.game.toUpperCase()} · {t("archivedLevel")}
              </strong>
              <span>{archivedTarget.name}</span>
              <code>{archivedTarget.id}</code>
            </p>
          ) : (
            <LevelContext level={active} />
          )}
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
            {current?.name ?? t("unknown")} → {next?.name ?? t("unknown")}
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

function ArchivedLevelPicker({
  game,
  selected,
  onSelect,
}: {
  game: Game;
  selected: ArchivedLevel | undefined;
  onSelect: (level: ArchivedLevel | undefined) => void;
}) {
  const { t } = useTranslation("qualifications");
  const [cursors, setCursors] = useState<string[]>([]);
  const params = new URLSearchParams({ game, limit: "25" });
  const cursor = cursors.at(-1);
  if (cursor) params.set("cursor", cursor);
  const query = useQualificationQuery(
    `/admin/qualification-levels/archived?${params}`,
    "EnvelopeListQualificationArchivedLevel",
  );
  const page = query.data?.data.data;
  const items = page?.items.filter((row) => row.game === game) ?? [];
  const options =
    selected && !items.some((row) => row.id === selected.id) ? [selected, ...items] : items;
  const nameCounts = new Map<string, number>();
  for (const row of options) nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  return (
    <>
      <Label htmlFor="assignment-archived-level">{t("archivedLevels")}</Label>
      <select
        id="assignment-archived-level"
        className="input"
        value={selected?.id ?? ""}
        disabled={options.length === 0}
        onChange={(event) => onSelect(options.find((row) => row.id === event.target.value))}
      >
        <option value="">—</option>
        {options.map((row) => (
          <option key={row.id} value={row.id}>
            {(nameCounts.get(row.name) ?? 0) > 1 ? `${row.name} · ${row.id}` : row.name}
          </option>
        ))}
      </select>
      <State query={query} />
      {page && items.length === 0 && <p>{t("noArchivedLevels")}</p>}
      {(cursors.length > 0 || page?.nextCursor) && (
        <PageNav
          hasPrevious={cursors.length > 0}
          next={page?.nextCursor}
          onPrevious={() => setCursors((previous) => previous.slice(0, -1))}
          onNext={(next) => setCursors((previous) => [...previous, next])}
        />
      )}
    </>
  );
}
