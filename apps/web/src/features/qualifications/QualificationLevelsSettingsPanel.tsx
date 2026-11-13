// Explicit roles preserve the table semantics when narrow layouts switch cells to block display.
// biome-ignore-all lint/a11y/noRedundantRoles: mobile WebKit may drop implicit table roles.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity } from "../../shared/formatting.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { Confirm, Failure, Recovery, RulesView, State } from "./components.js";
import { LevelEditor } from "./editor.js";
import { type AllowlistSummary, ruleSummary } from "./model.js";
import { useQualificationCommand, useQualificationQuery } from "./queries.js";
import type { DTO, Game } from "./transport.js";
import "./qualifications.css";

const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;
const maxLevels = 25;
type Ladder = DTO["QualificationLadder"];
type LadderLevel = DTO["QualificationLadderLevel"];
type Command = ReturnType<typeof useQualificationCommand>;

export function QualificationLevelsSettingsPanel() {
  const session = useSession();
  const { t, i18n } = useTranslation("qualifications");
  const [params, setParams] = useSearchParams();
  const game: Game = params.get("game") === "ats" ? "ats" : "ets2";
  if (!session.self?.capabilities.includes("qualifications.manage"))
    return <p>{t("ladderPermission")}</p>;
  return (
    <section
      className="qualification-ladder stack"
      aria-label={t("ladderTitle")}
      lang={i18n.resolvedLanguage}
    >
      <SegmentedControl
        aria-label={t("game")}
        value={game}
        options={games}
        onValueChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("game", value);
            return next;
          })
        }
      />
      <LadderSettings
        key={`${session.generation}:${session.self.member.id}:${session.self.identityEpoch}:${game}`}
        game={game}
      />
    </section>
  );
}

function LadderSettings({ game }: { game: Game }) {
  const { t, i18n } = useTranslation("qualifications");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const root = `/admin/qualification-ladders/${game}`;
  const query = useQualificationQuery(root, "EnvelopeQualificationLadder");
  const ladder = query.data?.data.data;
  const command = useQualificationCommand({ kind: "ladder", game });
  const [selectedId, setSelected] = useState<string | null>(null);
  const [archiveId, setArchive] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [reorderDraft, setReorderDraft] = useState<string[]>();
  const [reorderReason, setReorderReason] = useState("");
  const reasonId = useId();
  if (!ladder || ladder.game !== game)
    return query.isError || query.isPending ? (
      <State query={query} />
    ) : (
      <p role="alert">{t("cellUnavailable")}</p>
    );
  const etag = query.data?.etag === `"v${ladder.revision}"` ? query.data.etag : null;
  const hold = !etag || command.pending || command.seconds > 0 || command.canRecover;
  const levels = ladder.levels;
  const currentIds = levels.map((row) => row.id);
  const draftMatches =
    reorderDraft?.length === currentIds.length &&
    reorderDraft.every((id) => currentIds.includes(id));
  const order = draftMatches ? reorderDraft : currentIds;
  const changed = order.some((id, index) => id !== levels[index]?.id);
  const orderInput: DTO["QualificationLadderOrderInput"] = {
    levelIds: order,
    ...(reorderReason.trim() && { reason: reorderReason.trim() }),
  };
  const rows = order.flatMap((id) => {
    const row = levels.find((level) => level.id === id);
    return row ? [row] : [];
  });
  const selected = levels.find((row) => row.id === selectedId);
  const archiving = levels.find((row) => row.id === archiveId);
  function move(index: number, delta: number) {
    const ids = [...order];
    const current = ids[index];
    const neighbor = ids[index + delta];
    if (!current || !neighbor) return;
    ids[index] = neighbor;
    ids[index + delta] = current;
    setReorderDraft(ids);
    setSuccess(false);
  }
  function committed() {
    setReorderDraft(undefined);
    setReorderReason("");
    setArchive(null);
    setSuccess(true);
  }
  return (
    <>
      {!ladder.ladderEditsEnabled && <p className="muted">{t("ladderEditsUnavailable")}</p>}
      <table className="qualification-ladder-table" role="table" aria-label={t("ladderTitle")}>
        <thead role="rowgroup">
          <tr role="row">
            {[
              "level",
              "colMass",
              "colTrailers",
              "colAdr",
              "colThreshold",
              "ladderDrivers",
              "ladderActions",
            ].map((key) => (
              <th key={key} scope="col" role="columnheader">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row, index) => {
            const rules = row.effectiveRule ? ruleSummary(row.effectiveRule.rules) : null;
            const allowlist = (value: AllowlistSummary) =>
              value.kind === "none"
                ? t("noRestriction")
                : value.kind === "empty"
                  ? t("noneAllowed")
                  : t("allowedCount", { count: value.count });
            return (
              <tr key={row.id} role="row">
                <th scope="row" role="rowheader" className="qualification-ladder-level">
                  <strong>{row.name}</strong>
                  <p className="qualification-ladder-meta">
                    <span>
                      {t("stage")} {index + 1}
                    </span>
                    {index === 0 && <Badge size="xs">{t("ladderFirst")}</Badge>}
                    {index === rows.length - 1 && <Badge size="xs">{t("topLevel")}</Badge>}
                    <Badge
                      size="xs"
                      className={row.configured ? "badge-accepted" : "qualification-badge-pending"}
                    >
                      {t(row.configured ? "statusEffective" : "statusUnpublished")}
                    </Badge>
                  </p>
                </th>
                <LadderCell label={t("colMass")}>
                  {!rules
                    ? t("unset")
                    : rules.mass.kind === "none"
                      ? t("noRestriction")
                      : formatQuantity(rules.mass.maxKg, "t", locale)}
                </LadderCell>
                <LadderCell label={t("colTrailers")}>
                  {rules ? allowlist(rules.trailers) : t("unset")}
                </LadderCell>
                <LadderCell label={t("colAdr")}>
                  {rules ? allowlist(rules.adr) : t("unset")}
                </LadderCell>
                <LadderCell label={t("colThreshold")}>
                  {row.terminal
                    ? t("topLevel")
                    : row.promotionConfigured
                      ? t("thresholdValue", {
                          trips: row.requiredTrips ?? t("noMinimum"),
                          distance:
                            row.requiredDistanceM === null
                              ? t("noMinimum")
                              : formatQuantity(row.requiredDistanceM, "km", locale),
                        })
                      : t("ladderPromotionUnconfigured")}
                </LadderCell>
                <LadderCell label={t("ladderDrivers")}>{row.currentDriverCount}</LadderCell>
                <td className="qualification-ladder-controls" role="cell">
                  <div className="qualification-actions qualification-ladder-row-actions">
                    {ladder.ladderEditsEnabled && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={hold || index === 0}
                          aria-label={t("ladderMoveUpName", { name: row.name })}
                          onClick={() => move(index, -1)}
                        >
                          {t("ladderMoveUp")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={hold || index === rows.length - 1}
                          aria-label={t("ladderMoveDownName", { name: row.name })}
                          onClick={() => move(index, 1)}
                        >
                          {t("ladderMoveDown")}
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={row.id === selected?.id}
                      aria-label={t("ladderEditName", { name: row.name })}
                      onClick={() => setSelected(row.id === selected?.id ? null : row.id)}
                    >
                      {t(row.id === selected?.id ? "close" : "edit")}
                    </Button>
                    {ladder.ladderEditsEnabled && (
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t("ladderArchiveName", { name: row.name })}
                        aria-expanded={row.id === archiving?.id}
                        disabled={hold || levels.length === 1 || changed}
                        onClick={() => setArchive(row.id === archiving?.id ? null : row.id)}
                      >
                        {t("ladderArchive")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ladder.ladderEditsEnabled && reorderDraft && !draftMatches && (
        <p role="status">{t("ladderOrderChanged")}</p>
      )}
      {ladder.ladderEditsEnabled && changed && (
        <div className="stack">
          <Reason id={reasonId} value={reorderReason} onChange={setReorderReason} disabled={hold} />
          <div className="qualification-actions">
            <Confirm
              label={t("ladderSaveOrder")}
              guard={JSON.stringify([etag, orderInput])}
              disabled={hold}
              pending={command.pending}
              failure={command.failure}
              onConfirm={async () => {
                const result = await command.run(
                  `${root}/order`,
                  orderInput,
                  "EnvelopeQualificationLadderRevision",
                  etag,
                  "PATCH",
                );
                if (result) committed();
                return result;
              }}
            >
              <p>{t("ladderOrderWarning")}</p>
              <ol>
                {rows.map((row) => (
                  <li key={row.id}>{row.name}</li>
                ))}
              </ol>
              {orderInput.reason && <p>{orderInput.reason}</p>}
            </Confirm>
            <Button
              type="button"
              variant="ghost"
              disabled={hold}
              onClick={() => {
                setReorderDraft(undefined);
                setReorderReason("");
              }}
            >
              {t("trips:cancel")}
            </Button>
          </div>
        </div>
      )}
      {ladder.ladderEditsEnabled && archiving && (
        <ArchiveLevel
          key={archiving.id}
          level={archiving}
          ladder={ladder}
          root={root}
          etag={etag}
          command={command}
          hold={hold}
          onCommit={committed}
        />
      )}
      {selected && (
        <Card className="stack">
          <h3>{selected.name}</h3>
          {selected.effectiveRule && <RulesView rules={selected.effectiveRule.rules} game={game} />}
          <LevelEditor
            key={selected.id}
            level={selected}
            current={selected.effectiveRule ?? undefined}
            allowRenameReason={ladder.ladderEditsEnabled}
          />
        </Card>
      )}
      {ladder.ladderEditsEnabled &&
        (levels.length < maxLevels ? (
          <AddLevel
            ladder={ladder}
            root={root}
            etag={etag}
            command={command}
            hold={hold || changed}
            onCommit={committed}
          />
        ) : (
          <p>{t("ladderMaxLevels", { count: maxLevels })}</p>
        ))}
      <Failure error={command.failure} seconds={command.seconds} />
      <Recovery command={command} onRecovered={committed} />
      {success && <p role="status">{t("success")}</p>}
    </>
  );
}

function LadderCell({ label, children }: { label: string; children: string | number }) {
  return (
    <td role="cell">
      <span className="qualification-ladder-cell-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </td>
  );
}

type StructuralForm = {
  ladder: Ladder;
  root: string;
  etag: string | null;
  command: Command;
  hold: boolean;
  onCommit: () => void;
};

function AddLevel({ ladder, root, etag, command, hold, onCommit }: StructuralForm) {
  const { t } = useTranslation("qualifications");
  const id = useId();
  const [name, setName] = useState("");
  const [position, setPosition] = useState<number>();
  const [reason, setReason] = useState("");
  const max = ladder.levels.length + 1;
  const selectedPosition = Math.min(position ?? max, max);
  const input: DTO["QualificationLadderAddInput"] = {
    name: name.trim(),
    position: selectedPosition,
    ...(reason.trim() && { reason: reason.trim() }),
  };
  return (
    <Card className="stack">
      <h3>{t("ladderAdd")}</h3>
      <div className="qualification-ladder-fields">
        <div className="stack">
          <Label htmlFor={`${id}-name`}>{t("name")}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            required
            maxLength={128}
            disabled={hold}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="stack">
          <Label htmlFor={`${id}-position`}>{t("ladderPosition")}</Label>
          <select
            className="input"
            id={`${id}-position`}
            value={selectedPosition}
            disabled={hold}
            onChange={(event) => setPosition(Number(event.target.value))}
          >
            {ladder.levels.map((row) => (
              <option key={row.id} value={row.position}>
                {t("ladderBefore", { name: row.name, position: row.position })}
              </option>
            ))}
            <option value={max}>{t("ladderAtTop", { position: max })}</option>
          </select>
        </div>
      </div>
      <Reason id={id} value={reason} onChange={setReason} disabled={hold} />
      <Confirm
        label={t("ladderAdd")}
        guard={JSON.stringify([etag, input])}
        disabled={hold || !input.name}
        pending={command.pending}
        failure={command.failure}
        onConfirm={async () => {
          const result = await command.run(
            `${root}/levels`,
            input,
            "EnvelopeQualificationLadderRevision",
            etag,
          );
          if (result) {
            setName("");
            setPosition(undefined);
            setReason("");
            onCommit();
          }
          return result;
        }}
      >
        <p>
          {ladder.game.toUpperCase()} · {t("stage")} {input.position} · {input.name}
        </p>
        {input.reason && <p>{input.reason}</p>}
      </Confirm>
    </Card>
  );
}

function ArchiveLevel({
  level,
  ladder,
  root,
  etag,
  command,
  hold,
  onCommit,
}: StructuralForm & { level: LadderLevel }) {
  const { t } = useTranslation("qualifications");
  const id = useId();
  const [target, setTarget] = useState<string>();
  const [reason, setReason] = useState("");
  const available = ladder.levels.filter((row) => row.id !== level.id);
  const defaultTarget = ladder.levels.find(
    (row) => row.position === (level.position === 1 ? 2 : level.position - 1),
  );
  const selected = available.find((row) => row.id === target) ?? defaultTarget;
  if (!selected) return null;
  const input: DTO["QualificationLadderArchiveInput"] = {
    targetLevelId: selected.id,
    observedDriverCount: level.currentDriverCount,
    ...(reason.trim() && { reason: reason.trim() }),
  };
  return (
    <Card className="stack">
      <h3>{t("ladderArchiveName", { name: level.name })}</h3>
      <p>{t("ladderArchiveWarning")}</p>
      <p>{t("ladderDriverCount", { count: level.currentDriverCount })}</p>
      <Label htmlFor={`${id}-target`}>{t("ladderArchiveTarget")}</Label>
      <select
        className="input"
        id={`${id}-target`}
        value={selected.id}
        disabled={hold}
        onChange={(event) => setTarget(event.target.value)}
      >
        {available.map((row) => (
          <option value={row.id} key={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      <Reason id={id} value={reason} onChange={setReason} disabled={hold} />
      <Confirm
        label={t("ladderArchiveReview")}
        guard={JSON.stringify([etag, level.id, input])}
        disabled={hold}
        pending={command.pending}
        failure={command.failure}
        title={t("ladderArchiveName", { name: level.name })}
        description={t("ladderArchiveWarning")}
        destructiveLabel={t("ladderArchive")}
        onConfirm={async () => {
          const result = await command.run(
            `${root}/levels/${level.id}/archive`,
            input,
            "EnvelopeQualificationLadderRevision",
            etag,
          );
          if (result) onCommit();
          return result;
        }}
      >
        <p>
          {ladder.game.toUpperCase()} · {level.name} → {selected.name}
        </p>
        <p>{t("ladderDriverCount", { count: level.currentDriverCount })}</p>
        {input.reason && <p>{input.reason}</p>}
      </Confirm>
    </Card>
  );
}

function Reason({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("qualifications");
  return (
    <div className="stack">
      <Label htmlFor={`${id}-reason`}>{t("ladderOptionalReason")}</Label>
      <Input
        id={`${id}-reason`}
        maxLength={2048}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
