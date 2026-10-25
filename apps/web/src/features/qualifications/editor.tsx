import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Selection } from "../../shared/catalog-selectors/contracts.js";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import {
  Confirm,
  DraftEntities,
  Failure,
  LevelContext,
  Recovery,
  RulesView,
  State,
} from "./components.js";
import { useQualificationCommand } from "./queries.js";
import { countInput, type DTO, exactInput, type Game, utcInput } from "./transport.js";

export function LevelEditor({
  level,
  current,
}: {
  level: DTO["QualificationLevel"];
  current: DTO["QualificationRuleVersion"] | undefined;
}) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand({ kind: "level", id: level.id, game: level.game }),
    previewCommand = useQualificationCommand();
  const [name, setName] = useState(level.name),
    [rules, setRules] = useState<DTO["Rule"][]>(current?.rules ?? []),
    [mass, setMass] = useState(current?.rules.find((r) => r.type === "max_mass")?.maxKg ?? ""),
    [count, setCount] = useState(current?.requiredTrips?.toString() ?? ""),
    [distance, setDistance] = useState(current?.requiredDistanceM ?? ""),
    [reason, setReason] = useState(""),
    [schedule, setSchedule] = useState(false),
    [time, setTime] = useState(""),
    [sample, setSample] = useState<DTO["QualificationPreviewInput"]["sample"]>({
      cargoMassKg: null,
      trailerTypeIds: [],
      trailersComplete: false,
      adr: { status: "unknown", entityId: null },
    }),
    [sampleMass, setSampleMass] = useState(""),
    [preview, setPreview] = useState<{
      fingerprint: string;
      result: DTO["QualificationPreview"];
    } | null>(null),
    [success, setSuccess] = useState(false);
  const catalog = usePublishedRevisions(level.game),
    revisions = catalog.data?.pages.flatMap((p) => p.data.data.items) ?? [],
    [revision, setRevision] = useState("");
  const revisionId = revision || revisions[0]?.id || "",
    max = exactInput(mass),
    requiredTrips = countInput(count),
    requiredDistanceM = distance.trim() ? exactInput(distance) : null,
    effectiveAt = schedule ? utcInput(time) : undefined;
  const draft = rules.map((r) => (r.type === "max_mass" ? { ...r, maxKg: max ?? mass } : r));
  const massValid = !rules.some((r) => r.type === "max_mass") || max !== undefined;
  const valid =
    massValid &&
    requiredTrips !== undefined &&
    requiredDistanceM !== undefined &&
    (!schedule || !!effectiveAt);
  const sampleMassValue = sampleMass.trim() ? exactInput(sampleMass) : null;
  const actualSample = { ...sample, cargoMassKg: sampleMassValue ?? null };
  const previewInput: DTO["QualificationPreviewInput"] = {
      game: level.game,
      rules: draft,
      sample: actualSample,
    },
    fingerprint = JSON.stringify([
      previewInput,
      sampleMass,
      mass,
      count,
      distance,
      reason,
      schedule,
      time,
      name,
      revisionId,
    ]),
    fresh = preview?.fingerprint === fingerprint;
  const input: DTO["RulesInput"] = {
    rules: draft,
    requiredTrips: requiredTrips ?? null,
    requiredDistanceM: requiredDistanceM ?? null,
    reason,
    ...(schedule && effectiveAt ? { effectiveAt } : {}),
  };
  const guard = JSON.stringify([level.id, level.version, input, fingerprint, fresh]);
  const busy = command.pending || previewCommand.pending;
  function toggle(type: DTO["Rule"]["type"], enabled: boolean) {
    setRules((old) =>
      enabled
        ? [...old, type === "max_mass" ? { type, maxKg: mass } : { type, entityIds: [] }]
        : old.filter((r) => r.type !== type),
    );
    setSuccess(false);
  }
  return (
    <section className="stack">
      <h4>{t("rules")}</h4>
      <p>{t("limits")}</p>
      <fieldset className="stack" disabled={busy}>
        <Label htmlFor={`level-name-${level.id}`}>{t("name")}</Label>
        <Input
          id={`level-name-${level.id}`}
          maxLength={128}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Confirm
          label={t("saveName")}
          guard={JSON.stringify([level.id, level.version, name])}
          disabled={!name.trim() || name === level.name || command.seconds > 0}
          pending={command.pending || command.seconds > 0}
          failure={command.failure}
          onConfirm={async () => {
            const result = await command.run(
              `/admin/qualification-levels/${level.id}`,
              { name },
              "EnvelopeQualificationLevel",
              `"v${level.version}"`,
              "PATCH",
            );
            if (result) setSuccess(true);
            return result;
          }}
        >
          <LevelContext level={level} />
          <p>
            {level.name} → {name}
          </p>
        </Confirm>
        <State query={catalog} />
        <Label htmlFor={`catalog-${level.id}`}>{t("catalog")}</Label>
        <select
          className="input"
          id={`catalog-${level.id}`}
          value={revisionId}
          onChange={(e) => setRevision(e.target.value)}
        >
          <option value="">—</option>
          {revisions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.game.toUpperCase()} · {r.id}
            </option>
          ))}
        </select>
        {catalog.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void catalog.fetchNextPage()}
            disabled={catalog.isFetchingNextPage}
          >
            {t("trips:next")}
          </Button>
        )}
        {!revisionId && <p>{t("catalogMissing")}</p>}
        {(["max_mass", "allowed_trailer_types", "allowed_adr_categories"] as const).map((type) => {
          const rule = rules.find((r) => r.type === type);
          return (
            <fieldset className="stack" key={type}>
              <legend>{t(type)}</legend>
              <label className="qualification-check">
                <input
                  type="checkbox"
                  checked={!!rule}
                  onChange={(e) => toggle(type, e.target.checked)}
                />
                {t("enable")}
              </label>
              {rule &&
                (type === "max_mass" ? (
                  <>
                    <Label htmlFor={`mass-${level.id}`}>{t(type)}</Label>
                    <Input
                      id={`mass-${level.id}`}
                      inputMode="decimal"
                      value={mass}
                      onChange={(e) => setMass(e.target.value)}
                      aria-invalid={!massValid}
                    />
                  </>
                ) : (
                  <Allowlist
                    game={level.game}
                    revision={revisionId}
                    type={type}
                    ids={"entityIds" in rule ? rule.entityIds : []}
                    onChange={(ids) =>
                      setRules((old) =>
                        old.map((r) => (r.type === type ? { type, entityIds: ids } : r)),
                      )
                    }
                  />
                ))}
            </fieldset>
          );
        })}
        <Label htmlFor={`count-${level.id}`}>{t("requiredTrips")}</Label>
        <Input
          id={`count-${level.id}`}
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          aria-invalid={requiredTrips === undefined}
        />
        <Label htmlFor={`distance-${level.id}`}>{t("requiredDistance")}</Label>
        <Input
          id={`distance-${level.id}`}
          inputMode="decimal"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          aria-invalid={requiredDistanceM === undefined}
        />
        <Label htmlFor={`reason-${level.id}`}>{t("reason")}</Label>
        <Input
          id={`reason-${level.id}`}
          maxLength={2048}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Label htmlFor={`mode-${level.id}`}>{t("effectiveMode")}</Label>
        <select
          className="input"
          id={`mode-${level.id}`}
          value={schedule ? "schedule" : "immediate"}
          onChange={(e) => setSchedule(e.target.value === "schedule")}
        >
          <option value="immediate">{t("immediate")}</option>
          <option value="schedule">{t("schedule")}</option>
        </select>
        {schedule && (
          <>
            <Label htmlFor={`effective-${level.id}`}>{t("effectiveAt")}</Label>
            <Input
              id={`effective-${level.id}`}
              type="datetime-local"
              step="0.001"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <p>{effectiveAt ?? t("invalid")}</p>
          </>
        )}
        <p>{t("effectiveHelp")}</p>
        <fieldset className="stack">
          <legend>{t("sample")}</legend>
          <p>{t("sampleHelp")}</p>
          <Label htmlFor={`sample-mass-${level.id}`}>{t("sampleMass")}</Label>
          <Input
            id={`sample-mass-${level.id}`}
            inputMode="decimal"
            value={sampleMass}
            onChange={(e) => setSampleMass(e.target.value)}
            aria-invalid={sampleMassValue === undefined}
          />
          <h5>{t("chain")}</h5>
          <SampleTrailers
            game={level.game}
            revision={revisionId}
            sample={sample}
            onChange={setSample}
          />
          <Label htmlFor={`adr-status-${level.id}`}>{t("adrStatus")}</Label>
          <select
            className="input"
            id={`adr-status-${level.id}`}
            value={sample.adr.status}
            onChange={(e) =>
              setSample((old) => ({
                ...old,
                adr: { status: e.target.value as typeof sample.adr.status, entityId: null },
              }))
            }
          >
            {(["unknown", "non_hazardous", "known"] as const).map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
          {sample.adr.status === "known" && (
            <CatalogSelector
              label={t("sampleAdr")}
              game={level.game}
              revisionId={revisionId}
              kind="adr_category"
              value={sample.adr.entityId ? { entityId: sample.adr.entityId, revisionId } : null}
              onChange={(v) =>
                setSample((old) => ({
                  ...old,
                  adr: { status: "known", entityId: v?.entityId ?? null },
                }))
              }
            />
          )}
        </fieldset>
      </fieldset>
      {!valid && <p role="alert">{t("invalid")}</p>}
      <Button
        type="button"
        variant="outline"
        disabled={
          !valid ||
          sampleMassValue === undefined ||
          (sample.adr.status === "known" && !sample.adr.entityId) ||
          busy ||
          previewCommand.seconds > 0
        }
        onClick={async () => {
          const result = await previewCommand.run(
            "/admin/qualification-rule-previews",
            previewInput,
            "EnvelopeQualificationPreview",
          );
          if (result) setPreview({ fingerprint, result: result.data.data });
        }}
      >
        {t("preview")}
      </Button>
      <Failure error={previewCommand.failure} seconds={previewCommand.seconds} />
      {fresh && preview ? (
        <div role="status">
          <h4>
            {t("outcome")}: {t(preview.result.outcome)}
          </h4>
          {preview.result.ruleResults.map((r) => (
            <p key={r.ruleType}>
              {t(r.ruleType)} · {t(r.outcome)} · {t(r.reasonCode)}
            </p>
          ))}
        </div>
      ) : (
        <p>{t("previewRequired")}</p>
      )}
      <Confirm
        label={t("publish")}
        guard={guard}
        disabled={!valid || !reason.trim() || !fresh || busy || command.seconds > 0}
        pending={command.pending || command.seconds > 0}
        failure={command.failure}
        onConfirm={async () => {
          const result = await command.run(
            `/admin/qualification-levels/${level.id}/rule-versions`,
            input,
            "EnvelopeQualificationLevel",
            `"v${level.version}"`,
          );
          if (result) {
            setSuccess(true);
            setPreview(null);
          }
          return result;
        }}
      >
        <LevelContext level={level} />
        <p>
          {t("effective")}: {schedule ? effectiveAt : t("immediate")}
        </p>
        <RulesView rules={draft} game={level.game} />
        <p>
          {t("thresholds")}: {input.requiredTrips ?? t("unset")} /{" "}
          {input.requiredDistanceM ?? t("unset")} m
        </p>
        <p>{reason}</p>
        <p>{t("effectiveHelp")}</p>
      </Confirm>
      <Failure error={command.failure} seconds={command.seconds} />
      <Recovery
        command={command}
        onRecovered={() => {
          setSuccess(true);
          setPreview(null);
        }}
      />
      {success && <p role="status">{t("success")}</p>}
    </section>
  );
}

function Allowlist({
  game,
  revision,
  type,
  ids,
  onChange,
}: {
  game: Game;
  revision: string;
  type: "allowed_trailer_types" | "allowed_adr_categories";
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation("qualifications"),
    [selected, setSelected] = useState<Selection | null>(null),
    [rowPage, setRowPage] = useState(0);
  return (
    <div className="stack">
      <CatalogSelector
        label={t(type)}
        game={game}
        revisionId={revision}
        kind={type === "allowed_trailer_types" ? "trailer_type" : "adr_category"}
        value={selected}
        onChange={setSelected}
      />
      <Button
        type="button"
        variant="outline"
        disabled={
          !selected ||
          selected.revisionId !== revision ||
          ids.length >= 1000 ||
          ids.includes(selected.entityId)
        }
        onClick={() => {
          if (selected) {
            setRowPage(Math.floor(ids.length / 25));
            onChange([...ids, selected.entityId]);
            setSelected(null);
          }
        }}
      >
        {t("add")}
      </Button>
      {!ids.length && <p>{t("emptyAllowlist")}</p>}
      <DraftEntities
        ids={ids}
        revision={revision}
        game={game}
        kind={type === "allowed_trailer_types" ? "trailer_type" : "adr_category"}
        page={rowPage}
        onPage={setRowPage}
        onRemove={(index) => onChange(ids.filter((_, i) => i !== index))}
      />
    </div>
  );
}
function SampleTrailers({
  game,
  revision,
  sample,
  onChange,
}: {
  game: Game;
  revision: string;
  sample: DTO["QualificationPreviewInput"]["sample"];
  onChange: (value: DTO["QualificationPreviewInput"]["sample"]) => void;
}) {
  const { t } = useTranslation("qualifications"),
    [selected, setSelected] = useState<Selection | null>(null),
    [rowPage, setRowPage] = useState(0);
  return (
    <>
      <CatalogSelector
        label={t("sampleTrailer")}
        game={game}
        revisionId={revision}
        kind="trailer_type"
        value={selected}
        onChange={setSelected}
      />
      <div className="qualification-actions">
        <Button
          type="button"
          variant="outline"
          disabled={
            !selected || selected.revisionId !== revision || sample.trailerTypeIds.length >= 32
          }
          onClick={() => {
            if (selected) {
              setRowPage(Math.floor(sample.trailerTypeIds.length / 25));
              onChange({
                ...sample,
                trailerTypeIds: [...sample.trailerTypeIds, selected.entityId],
              });
              setSelected(null);
            }
          }}
        >
          {t("add")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={sample.trailerTypeIds.length >= 32}
          onClick={() => {
            setRowPage(Math.floor(sample.trailerTypeIds.length / 25));
            onChange({ ...sample, trailerTypeIds: [...sample.trailerTypeIds, null] });
          }}
        >
          {t("addUnknown")}
        </Button>
      </div>
      {!sample.trailerTypeIds.length && <p>{t("noTrailers")}</p>}
      <DraftEntities
        ids={sample.trailerTypeIds}
        revision={revision}
        game={game}
        kind="trailer_type"
        page={rowPage}
        onPage={setRowPage}
        onRemove={(index) =>
          onChange({
            ...sample,
            trailerTypeIds: sample.trailerTypeIds.filter((_, i) => i !== index),
          })
        }
      />
      <label className="qualification-check">
        <input
          type="checkbox"
          checked={sample.trailersComplete}
          onChange={(e) => onChange({ ...sample, trailersComplete: e.target.checked })}
        />
        {t("complete")}
      </label>
    </>
  );
}
