import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatQuantity } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { useSignOut } from "../account/sign-out.js";
import {
  Confirm,
  Failure,
  QualificationSettingsVisibility,
  Recovery,
  State,
} from "./components.js";
import { LevelEditor } from "./editor.js";
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
type Edit = "add" | "reorder" | "archive";
type EditInput = DTO[
  | "QualificationLadderAddInput"
  | "QualificationLadderOrderInput"
  | "QualificationLadderArchiveInput"];
type Insertion = { etag: string | null; before: string | null };
type AddDraft = { name: string; reason: string; insertion?: Insertion };
const emptyAddDraft: AddDraft = { name: "", reason: "" };
type ArchiveDraft = { levelId: string; target?: string; reason: string };

export function QualificationLevelsSettingsPanel({ visible = true }: { visible?: boolean }) {
  const session = useSession();
  const signOut = useSignOut();
  const { t } = useTranslation("qualifications");
  if (signOut.active || !session.self?.capabilities.includes("qualifications.manage"))
    return <p>{t("ladderPermission")}</p>;
  const scope = JSON.stringify([
    session.generation,
    session.self.member.id,
    session.self.identityEpoch,
    session.self.capabilities,
  ]);
  return <QualificationSettingsGames key={scope} visible={visible} />;
}

function QualificationSettingsGames({ visible }: { visible: boolean }) {
  const { t, i18n } = useTranslation("qualifications");
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const game: Game = params.get("game") === "ats" ? "ats" : "ets2";
  const [opened, setOpened] = useState<readonly Game[]>([]);
  // Keep only game panes actually opened during this authorized Settings visit.
  if (visible && !opened.includes(game)) setOpened([...opened, game]);
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
        onValueChange={(value) => {
          params.set("game", value);
          navigate({ search: params.toString(), hash });
        }}
      />
      {games.map(({ value }) => {
        const active = visible && game === value;
        return (
          (active || opened.includes(value)) && (
            <div key={value} className={active ? "stack" : undefined} hidden={!active}>
              <QualificationSettingsVisibility value={active}>
                <LadderSettings game={value} visible={active} />
              </QualificationSettingsVisibility>
            </div>
          )
        );
      })}
    </section>
  );
}

function LadderSettings({ game, visible }: { game: Game; visible: boolean }) {
  const { t, i18n } = useTranslation("qualifications");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const root = `/admin/qualification-ladders/${game}`;
  const query = useQualificationQuery(root, "EnvelopeQualificationLadder", visible);
  const snapshot = query.data?.data.data;
  const ladder = snapshot?.game === game ? snapshot : undefined;
  const command = useQualificationCommand({ kind: "ladder", game }, undefined, undefined, {
    preserveLimitedRecovery: true,
  });
  const [selectedId, setSelected] = useState<string | null>(null);
  const [openedEditors, setOpenedEditors] = useState<LadderLevel[]>([]);
  const [archiveDraft, setArchiveDraft] = useState<ArchiveDraft>();
  const [success, setSuccess] = useState(false);
  const [reorderDraft, setReorderDraft] = useState<{ etag: string; ids: string[] }>();
  const [reorderReason, setReorderReason] = useState("");
  const [addDraft, setAddDraft] = useState<AddDraft>(emptyAddDraft);
  const attemptedEdit = useRef<Edit | null>(null);
  const reasonId = useId();
  const etag = ladder && query.data?.etag === `"v${ladder.revision}"` ? query.data.etag : null;
  const hold = !etag || command.pending || command.seconds > 0 || command.canRecover;
  const levels = ladder?.levels ?? [];
  const currentIds = levels.map((row) => row.id);
  const staleOrder = reorderDraft !== undefined && reorderDraft.etag !== etag;
  const order = reorderDraft && !staleOrder ? reorderDraft.ids : currentIds;
  const changed = order.some((id, index) => id !== levels[index]?.id);
  const orderInput: DTO["QualificationLadderOrderInput"] = {
    levelIds: order,
    ...(reorderReason.trim() && { reason: reorderReason.trim() }),
  };
  const rows = order.flatMap((id) => {
    const row = levels.find((level) => level.id === id);
    return row ? [row] : [];
  });
  const editsEnabled = ladder?.ladderEditsEnabled === true;
  const archiving = levels.find((row) => row.id === archiveDraft?.levelId);
  function selectEditor(row: LadderLevel) {
    setOpenedEditors((previous) =>
      previous.some(({ id }) => id === row.id) ? previous : [...previous, row],
    );
    setSelected(row.id === selectedId ? null : row.id);
  }
  function move(index: number, delta: number) {
    if (!etag || staleOrder) return;
    const ids = [...order];
    const current = ids[index];
    const neighbor = ids[index + delta];
    if (!current || !neighbor) return;
    ids[index] = neighbor;
    ids[index + delta] = current;
    setReorderDraft({ etag, ids });
    setSuccess(false);
  }
  function committed() {
    if (attemptedEdit.current === "reorder") {
      setReorderDraft(undefined);
      setReorderReason("");
    }
    if (attemptedEdit.current === "archive") setArchiveDraft(undefined);
    if (attemptedEdit.current === "add") setAddDraft(emptyAddDraft);
    attemptedEdit.current = null;
    setSuccess(true);
  }
  async function submit(edit: Edit, path: string, input: EditInput, revision: string) {
    attemptedEdit.current = edit;
    const result = await command.run(
      path,
      input,
      "EnvelopeQualificationLadderRevision",
      revision,
      edit === "reorder" ? "PATCH" : "POST",
    );
    if (result) committed();
    return result;
  }
  const allowlist = (count: number | null) =>
    count === null
      ? t("noRestriction")
      : count === 0
        ? t("noneAllowed")
        : t("allowedCount", { count });
  const columns: DataTableColumn<{ level: LadderLevel; index: number }>[] = [
    {
      id: "level",
      header: t("level"),
      rowHeader: true,
      cardLabel: false,
      className: "qualification-ladder-level",
      cell: ({ level, index }) => (
        <>
          <strong>{level.name}</strong>
          <p className="qualification-ladder-meta">
            <span>
              {t("stage")} {index + 1}
            </span>
            {index === 0 && <Badge size="xs">{t("ladderFirst")}</Badge>}
            {index === rows.length - 1 && <Badge size="xs">{t("topLevel")}</Badge>}
            <Badge
              size="xs"
              className={level.configured ? "badge-accepted" : "qualification-badge-pending"}
            >
              {t(level.configured ? "statusEffective" : "statusUnpublished")}
            </Badge>
          </p>
        </>
      ),
    },
    {
      id: "mass",
      header: t("colMass"),
      cell: ({ level }) => {
        const rule = level.freightRuleSummary;
        if (!rule) return t("unset");
        return rule.maxMassKg === null
          ? t("noRestriction")
          : formatQuantity(rule.maxMassKg, "t", locale);
      },
    },
    {
      id: "trailers",
      header: t("colTrailers"),
      cell: ({ level }) => {
        const rule = level.freightRuleSummary;
        return rule ? allowlist(rule.allowedTrailerTypeCount) : t("unset");
      },
    },
    {
      id: "adr",
      header: t("colAdr"),
      cell: ({ level }) => {
        const rule = level.freightRuleSummary;
        return rule ? allowlist(rule.allowedAdrCategoryCount) : t("unset");
      },
    },
    {
      id: "threshold",
      header: t("colThreshold"),
      cell: ({ level }) => {
        if (level.terminal) return t("topLevel");
        if (!level.promotionConfigured) return t("ladderPromotionUnconfigured");
        return t("thresholdValue", {
          trips: level.requiredTrips ?? t("noMinimum"),
          distance:
            level.requiredDistanceM === null
              ? t("noMinimum")
              : formatQuantity(level.requiredDistanceM, "km", locale),
        });
      },
    },
    {
      id: "drivers",
      header: t("ladderDrivers"),
      cell: ({ level }) => level.currentDriverCount,
    },
    {
      id: "actions",
      header: t("ladderActions"),
      cardLabel: false,
      className: "qualification-ladder-controls",
      cell: ({ level: row, index }) => (
        <div className="qualification-actions qualification-ladder-row-actions">
          {editsEnabled && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={hold || staleOrder || index === 0}
                aria-label={t("ladderMoveUpName", { name: row.name })}
                onClick={() => move(index, -1)}
              >
                {t("ladderMoveUp")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={hold || staleOrder || index === rows.length - 1}
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
            aria-expanded={row.id === selectedId}
            aria-label={t("ladderEditName", { name: row.name })}
            onClick={() => selectEditor(row)}
          >
            {t(row.id === selectedId ? "close" : "edit")}
          </Button>
          {editsEnabled && (
            <Button
              type="button"
              variant="outline"
              aria-label={t("ladderArchiveName", { name: row.name })}
              aria-expanded={row.id === archiving?.id}
              disabled={hold || levels.length === 1 || changed || staleOrder}
              onClick={() =>
                setArchiveDraft(
                  row.id === archiving?.id ? undefined : { levelId: row.id, reason: "" },
                )
              }
            >
              {t("ladderArchive")}
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      {visible && ladder && (
        <>
          {!ladder.ladderEditsEnabled && <p className="muted">{t("ladderEditsUnavailable")}</p>}
          <DataTable
            caption={t("ladderTitle")}
            className="qualification-ladder-table"
            cardsBelow={800}
            columns={columns}
            rows={rows.map((level, index) => ({ level, index }))}
            rowKey={({ level }) => level.id}
          />
          {ladder.ladderEditsEnabled && staleOrder && (
            <div className="stack">
              <p role="status">{t("ladderOrderChanged")}</p>
              <Button
                type="button"
                variant="outline"
                disabled={hold}
                onClick={() => setReorderDraft(undefined)}
              >
                {t("ladderReviewOrder")}
              </Button>
            </div>
          )}
          {ladder.ladderEditsEnabled && changed && (
            <div className="stack">
              <Reason
                id={reasonId}
                value={reorderReason}
                onChange={setReorderReason}
                disabled={hold}
              />
              <div className="qualification-actions">
                <Confirm
                  label={t("ladderSaveOrder")}
                  guard={JSON.stringify([
                    reorderDraft?.etag,
                    orderInput,
                    rows.map((row) => row.name),
                  ])}
                  disabled={hold}
                  pending={command.pending}
                  failure={command.failure}
                  onConfirm={() =>
                    reorderDraft && !staleOrder
                      ? submit("reorder", `${root}/order`, orderInput, reorderDraft.etag)
                      : Promise.resolve(undefined)
                  }
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
          {ladder.ladderEditsEnabled && archiving && archiveDraft && (
            <ArchiveLevel
              key={archiving.id}
              level={archiving}
              ladder={ladder}
              root={root}
              etag={etag}
              command={command}
              hold={hold || changed || staleOrder}
              submit={submit}
              draft={archiveDraft}
              setDraft={setArchiveDraft}
            />
          )}
        </>
      )}
      {visible &&
        !ladder &&
        (query.isError || query.isPending ? (
          <State query={query} />
        ) : (
          <p role="alert">{t("cellUnavailable")}</p>
        ))}
      {openedEditors.map((opened) => {
        const current = levels.find(({ id }) => id === opened.id);
        // An archive or failed read can remove the row while an exact receipt is still recoverable.
        const level = current ?? opened;
        const selected = opened.id === selectedId;
        return (
          <QualificationSettingsVisibility key={level.id} value={visible && (selected || !current)}>
            <LevelEditor
              level={level}
              current={level.effectiveRule ?? undefined}
              allowRenameReason={ladder?.ladderEditsEnabled === true}
              recoveryOnly={!current || !etag}
            />
          </QualificationSettingsVisibility>
        );
      })}
      {visible &&
        ladder?.ladderEditsEnabled &&
        (levels.length < maxLevels ? (
          <AddLevel
            ladder={ladder}
            root={root}
            etag={etag}
            command={command}
            hold={hold || changed || staleOrder}
            submit={submit}
            draft={addDraft}
            setDraft={setAddDraft}
          />
        ) : (
          <p>{t("ladderMaxLevels", { count: maxLevels })}</p>
        ))}
      {visible && (
        <>
          <Failure error={command.failure} seconds={command.seconds} />
          <Recovery command={command} onRecovered={committed} />
          {success && <p role="status">{t("success")}</p>}
        </>
      )}
    </>
  );
}

type StructuralForm = {
  ladder: Ladder;
  root: string;
  etag: string | null;
  command: Command;
  hold: boolean;
  submit: (edit: Edit, path: string, input: EditInput, revision: string) => Promise<unknown>;
};

function AddLevel({
  ladder,
  root,
  etag,
  command,
  hold,
  submit,
  draft,
  setDraft,
}: StructuralForm & { draft: AddDraft; setDraft: (draft: AddDraft) => void }) {
  const { t } = useTranslation("qualifications");
  const id = useId();
  const insertion = draft.insertion ?? { etag, before: null };
  const anchor = ladder.levels.find((row) => row.id === insertion.before);
  const missingAnchor = insertion.before !== null && !anchor;
  const staleInsertion = insertion.etag !== etag;
  const position = anchor?.position ?? ladder.levels.length + 1;
  const placement = anchor
    ? t("ladderBefore", { name: anchor.name, position })
    : t("ladderAtTop", { position });
  const input: DTO["QualificationLadderAddInput"] = {
    name: draft.name.trim(),
    position,
    ...(draft.reason.trim() && { reason: draft.reason.trim() }),
  };
  return (
    <Card className="stack">
      <h3>{t("ladderAdd")}</h3>
      <div className="qualification-ladder-fields">
        <div className="stack">
          <Label htmlFor={`${id}-name`}>{t("name")}</Label>
          <Input
            id={`${id}-name`}
            value={draft.name}
            required
            maxLength={128}
            disabled={hold}
            onChange={(event) => setDraft({ ...draft, name: event.target.value, insertion })}
          />
        </div>
        <div className="stack">
          <Label htmlFor={`${id}-position`}>{t("ladderPosition")}</Label>
          <select
            className="input"
            id={`${id}-position`}
            value={missingAnchor ? "" : (insertion.before ?? "append")}
            disabled={hold}
            onChange={(event) =>
              setDraft({
                ...draft,
                insertion: {
                  etag,
                  before: event.target.value === "append" ? null : event.target.value,
                },
              })
            }
          >
            {missingAnchor && (
              <option value="" disabled>
                {t("ladderChoosePosition")}
              </option>
            )}
            {ladder.levels.map((row) => (
              <option key={row.id} value={row.id}>
                {t("ladderBefore", { name: row.name, position: row.position })}
              </option>
            ))}
            <option value="append">
              {t("ladderAtTop", { position: ladder.levels.length + 1 })}
            </option>
          </select>
        </div>
      </div>
      {missingAnchor ? (
        <p role="status">{t("ladderInsertionMissing")}</p>
      ) : staleInsertion ? (
        <div className="stack">
          <p role="status">{t("ladderInsertionChanged")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={hold}
            onClick={() => setDraft({ ...draft, insertion: { ...insertion, etag } })}
          >
            {t("ladderReviewPosition")}
          </Button>
        </div>
      ) : null}
      <Reason
        id={id}
        value={draft.reason}
        onChange={(reason) => setDraft({ ...draft, reason, insertion })}
        disabled={hold}
      />
      <Confirm
        label={t("ladderAdd")}
        guard={JSON.stringify([etag, insertion, placement, input])}
        disabled={hold || !input.name || missingAnchor || staleInsertion}
        pending={command.pending}
        failure={command.failure}
        onConfirm={() =>
          !missingAnchor && !staleInsertion && insertion.etag
            ? submit("add", `${root}/levels`, input, insertion.etag)
            : Promise.resolve(undefined)
        }
      >
        <p>
          {ladder.game.toUpperCase()} · {input.name}
        </p>
        <p>{placement}</p>
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
  submit,
  draft,
  setDraft,
}: StructuralForm & {
  level: LadderLevel;
  draft: ArchiveDraft;
  setDraft: (draft: ArchiveDraft) => void;
}) {
  const { t } = useTranslation("qualifications");
  const id = useId();
  const available = ladder.levels.filter((row) => row.id !== level.id);
  const defaultTarget = ladder.levels.find(
    (row) => row.position === (level.position === 1 ? 2 : level.position - 1),
  );
  const selected = draft.target ? available.find((row) => row.id === draft.target) : defaultTarget;
  const label = (row: LadderLevel) =>
    t("ladderLevelPosition", { position: row.position, name: row.name });
  if (!defaultTarget) return null;
  const input: DTO["QualificationLadderArchiveInput"] = {
    targetLevelId: selected?.id ?? "",
    observedDriverCount: level.currentDriverCount,
    ...(draft.reason.trim() && { reason: draft.reason.trim() }),
  };
  return (
    <Card className="stack">
      <h3>{t("ladderArchiveName", { name: label(level) })}</h3>
      <p>{t("ladderArchiveWarning")}</p>
      <p>{t("ladderDriverCount", { count: level.currentDriverCount })}</p>
      <Label htmlFor={`${id}-target`}>{t("ladderArchiveTarget")}</Label>
      <select
        className="input"
        id={`${id}-target`}
        value={selected?.id ?? ""}
        disabled={hold}
        onChange={(event) => setDraft({ ...draft, target: event.target.value })}
      >
        {!selected && (
          <option value="" disabled>
            {t("ladderArchiveTarget")}
          </option>
        )}
        {available.map((row) => (
          <option value={row.id} key={row.id}>
            {label(row)}
          </option>
        ))}
      </select>
      <Reason
        id={id}
        value={draft.reason}
        onChange={(reason) => setDraft({ ...draft, reason })}
        disabled={hold}
      />
      <Confirm
        label={t("ladderArchiveReview")}
        guard={JSON.stringify([etag, level.id, label(level), selected && label(selected), input])}
        disabled={hold || !selected}
        pending={command.pending}
        failure={command.failure}
        title={t("ladderArchiveName", { name: label(level) })}
        description={t("ladderArchiveWarning")}
        destructiveLabel={t("ladderArchive")}
        onConfirm={() =>
          selected && etag
            ? submit("archive", `${root}/levels/${level.id}/archive`, input, etag)
            : Promise.resolve(undefined)
        }
      >
        <p>
          {ladder.game.toUpperCase()} · {label(level)} → {selected && label(selected)}
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
