import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AdrClass, adrClasses } from "../../shared/catalog-selectors/contracts.js";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { todayIn } from "../../shared/ui/date-time.js";
import { DateTimeField } from "../../shared/ui/date-time-field.js";
import { Button, Card, FieldError, Input, Label } from "../../shared/ui/primitives.js";
import {
  Confirm,
  DraftEntities,
  Failure,
  LevelContext,
  QualificationSettingsVisibility,
  Recovery,
  RulesView,
  Thresholds,
} from "./components.js";
import { useQualificationCommand } from "./queries.js";
import {
  countInput,
  type DTO,
  distanceForEditor,
  distanceInput,
  exactInput,
  type Game,
  utcInput,
} from "./transport.js";

export function LevelEditor({
  level,
  current,
  allowRenameReason = false,
  recoveryOnly = false,
}: {
  level: DTO["QualificationLevel"];
  current: DTO["QualificationRuleVersion"] | undefined;
  allowRenameReason?: boolean;
  recoveryOnly?: boolean;
}) {
  const settingsVisibility = useContext(QualificationSettingsVisibility);
  const visible = settingsVisibility ?? true;
  const { t, i18n } = useTranslation("qualifications");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const [baseline, setBaseline] = useState({
    version: level.version,
    ruleVersionId: level.ruleVersionId,
  });
  const command = useQualificationCommand(
      { kind: "level", id: level.id, game: level.game },
      undefined,
      (result, operation) =>
        setBaseline((previous) => ({
          version: result.version,
          // Name changes and future publication do not own the currently active rules.
          ruleVersionId: operation === "publish" ? result.ruleVersionId : previous.ruleVersionId,
        })),
      { preserveLimitedRecovery: settingsVisibility !== undefined },
    ),
    previewCommand = useQualificationCommand();
  const [name, setName] = useState(level.name),
    [rules, setRules] = useState<DTO["Rule"][]>(current?.rules ?? []),
    [mass, setMass] = useState(current?.rules.find((r) => r.type === "max_mass")?.maxKg ?? ""),
    [count, setCount] = useState(
      level.promotionConfigured ? (current?.requiredTrips?.toString() ?? "") : "",
    ),
    [initialDistanceM] = useState(
      level.promotionConfigured ? (current?.requiredDistanceM ?? null) : null,
    ),
    [distanceDraft, setDistance] = useState<string>(),
    [reason, setReason] = useState(""),
    [renameReason, setRenameReason] = useState(""),
    [schedule, setSchedule] = useState(false),
    [time, setTime] = useState(""),
    [sample, setSample] = useState<DTO["QualificationPreviewInput"]["sample"]>({
      cargoMassKg: null,
      trailerTypeIds: [],
      trailersComplete: false,
      adr: { status: "unknown", adrClass: null },
    }),
    [sampleMass, setSampleMass] = useState(""),
    [preview, setPreview] = useState<{
      fingerprint: string;
      result: DTO["QualificationPreview"];
    } | null>(null),
    [success, setSuccess] = useState(false),
    [checkingReceipt, setCheckingReceipt] = useState(false);
  const distance = distanceDraft ?? distanceForEditor(initialDistanceM, locale);
  const max = exactInput(mass),
    requiredTrips = level.terminal ? null : countInput(count),
    requiredDistanceM = level.terminal ? null : distanceInput(distance),
    effectiveAt = schedule ? utcInput(time) : undefined;
  const draft = rules.map((r) => (r.type === "max_mass" ? { ...r, maxKg: max ?? mass } : r));
  const nameInvalid = !name.trim();
  const massInvalid = rules.some((r) => r.type === "max_mass") && max === undefined;
  const tripsInvalid = requiredTrips === undefined;
  const distanceInvalid = requiredDistanceM === undefined;
  const timeInvalid = schedule && !effectiveAt;
  const publishInvalid = massInvalid || tripsInvalid || distanceInvalid || timeInvalid;

  const input: DTO["QualificationRulePublicationInput"] = {
    rules: draft,
    requiredTrips: requiredTrips ?? null,
    requiredDistanceM: requiredDistanceM ?? null,
    ...(reason.trim() ? { reason } : {}),
    ...(effectiveAt ? { effectiveAt } : {}),
  };
  const renameInput: DTO["LevelInput"] = {
    name,
    ...(allowRenameReason && renameReason.trim() ? { reason: renameReason } : {}),
  };
  const guard = JSON.stringify([
    level.id,
    level.version,
    level.ruleVersionId,
    baseline,
    input,
    mass,
    count,
    distanceDraft,
    schedule,
    time,
  ]);
  const sampleMassValue = sampleMass.trim() ? exactInput(sampleMass) : null;
  const sampleAdrInvalid = sample.adr.status === "known" && sample.adr.adrClass === null;
  const previewInput: DTO["QualificationPreviewInput"] = {
    game: level.game,
    rules: draft,
    sample: { ...sample, cargoMassKg: sampleMassValue ?? null },
  };
  const fingerprint = JSON.stringify([guard, previewInput, sampleMass]);
  const fresh = preview?.fingerprint === fingerprint;
  const busy = command.pending || previewCommand.pending;
  const stale =
      baseline.version !== level.version || baseline.ruleVersionId !== level.ruleVersionId,
    latestAvailable =
      level.ruleVersionId === null ||
      (current?.id === level.ruleVersionId &&
        current.levelId === level.id &&
        current.game === level.game),
    renamePath = `/admin/qualification-levels/${level.id}`,
    publishPath = `${renamePath}/rule-versions`,
    renameReplay = command.matchesPending(renamePath, renameInput, "PATCH"),
    publishReplay = command.matchesPending(publishPath, input);
  function toggle(type: DTO["Rule"]["type"], enabled: boolean) {
    setRules((old) =>
      enabled
        ? [
            ...old,
            type === "max_mass"
              ? { type, maxKg: mass }
              : type === "allowed_trailer_types"
                ? { type, entityIds: [] }
                : { type, classes: [] },
          ]
        : old.filter((r) => r.type !== type),
    );
    setSuccess(false);
  }
  function checkingPreviousAction() {
    setCheckingReceipt(true);
    setSuccess(false);
  }
  if (!visible) return null;
  if (recoveryOnly) {
    const settled =
      checkingReceipt && !command.pending && !command.canRecover && (success || command.failure);
    return command.canRecover || command.pending || command.seconds > 0 || settled ? (
      <Card className="stack">
        <h3>{level.name}</h3>
        <p>{t("cellUnavailable")}</p>
        {command.pending && <p role="status">{t("trips:loading")}</p>}
        <Failure error={command.failure} seconds={command.seconds} />
        <Recovery
          command={command}
          onAttempt={checkingPreviousAction}
          onRecovered={() => {
            setPreview(null);
            setSuccess(true);
          }}
        />
        {settled && success && <p role="status">{t("success")}</p>}
        {settled && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCheckingReceipt(false);
              setSuccess(false);
              command.reset();
            }}
          >
            {t("dismissReceipt")}
          </Button>
        )}
      </Card>
    ) : null;
  }
  const editor = (
    <section className="stack">
      <h4>{t("rules")}</h4>
      <p>{t("limits")}</p>
      {stale && (
        <div className="stack" role="alert">
          <p>{t("baselineChanged")}</p>
          <LevelContext level={level} />
          <p>
            {t("latestVersion")}: {level.version}
          </p>
          {latestAvailable ? (
            level.ruleVersionId && current ? (
              <>
                <RulesView rules={current.rules} game={level.game} />
                {level.promotionConfigured && (
                  <Thresholds
                    requiredTrips={level.requiredTrips}
                    requiredDistanceM={level.requiredDistanceM}
                  />
                )}
              </>
            ) : (
              <p>{t("noRules")}</p>
            )
          ) : (
            <p>{t("baselineUnavailable")}</p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!latestAvailable || busy || command.canRecover}
            onClick={() => {
              setBaseline({ version: level.version, ruleVersionId: level.ruleVersionId });
              setPreview(null);
              setSuccess(false);
            }}
          >
            {t("reviewBaseline")}
          </Button>
        </div>
      )}
      <fieldset className="stack" disabled={busy}>
        <RequiredLabel id={`level-name-${level.id}`}>{t("name")}</RequiredLabel>
        <Input
          id={`level-name-${level.id}`}
          maxLength={128}
          required
          aria-invalid={nameInvalid}
          aria-describedby={nameInvalid ? `error-level-name-${level.id}` : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldError id={`error-level-name-${level.id}`}>
          {nameInvalid ? t("nameRequired") : undefined}
        </FieldError>
        {allowRenameReason && (
          <>
            <Label htmlFor={`rename-reason-${level.id}`}>{t("ladderOptionalReason")}</Label>
            <Input
              id={`rename-reason-${level.id}`}
              maxLength={2048}
              value={renameReason}
              onChange={(event) => setRenameReason(event.target.value)}
            />
          </>
        )}
        <Confirm
          label={t("saveName")}
          guard={JSON.stringify([
            level.id,
            level.version,
            level.ruleVersionId,
            baseline,
            renameInput,
          ])}
          disabled={
            nameInvalid ||
            (name === level.name && !renameReplay) ||
            ((stale || command.canRecover) && !renameReplay) ||
            command.seconds > 0
          }
          pending={command.pending || command.seconds > 0}
          failure={command.failure}
          onConfirm={async () => {
            const result = await command.run(
              renamePath,
              renameInput,
              "EnvelopeQualificationLevel",
              `"v${baseline.version}"`,
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
          {renameInput.reason && <p>{renameInput.reason}</p>}
        </Confirm>
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
                    <RequiredLabel id={`mass-${level.id}`}>{t(type)}</RequiredLabel>
                    <Input
                      id={`mass-${level.id}`}
                      inputMode="decimal"
                      value={mass}
                      onChange={(e) => setMass(e.target.value)}
                      required
                      aria-invalid={massInvalid}
                      aria-describedby={massInvalid ? `error-mass-${level.id}` : undefined}
                    />
                    <FieldError id={`error-mass-${level.id}`}>
                      {massInvalid ? t("massInvalid") : undefined}
                    </FieldError>
                  </>
                ) : type === "allowed_adr_categories" ? (
                  <AdrClassAllowlist
                    classes={"classes" in rule ? rule.classes : []}
                    onChange={(classes) =>
                      setRules((old) => old.map((r) => (r.type === type ? { type, classes } : r)))
                    }
                  />
                ) : (
                  <Allowlist
                    game={level.game}
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
        {level.terminal ? (
          <p>{t("terminal")}</p>
        ) : (
          <>
            <Label htmlFor={`count-${level.id}`}>{t("requiredTrips")}</Label>
            <Input
              id={`count-${level.id}`}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-invalid={tripsInvalid}
              aria-describedby={tripsInvalid ? `error-count-${level.id}` : undefined}
            />
            <FieldError id={`error-count-${level.id}`}>
              {tripsInvalid ? t("tripsInvalid") : undefined}
            </FieldError>
            <Label htmlFor={`distance-${level.id}`}>{t("requiredDistance")}</Label>
            <Input
              id={`distance-${level.id}`}
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              aria-invalid={distanceInvalid}
              aria-describedby={distanceInvalid ? `error-distance-${level.id}` : undefined}
            />
            <FieldError id={`error-distance-${level.id}`}>
              {distanceInvalid ? t("distanceInvalid") : undefined}
            </FieldError>
          </>
        )}
        <Label htmlFor={`reason-${level.id}`}>{t("publicationReason")}</Label>
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
            <RequiredLabel id={`effective-${level.id}`}>{t("effectiveAt")}</RequiredLabel>
            <DateTimeField
              id={`effective-${level.id}`}
              fieldName={t("effectiveAt")}
              timeZone="UTC"
              min={todayIn("UTC", Date.now())}
              required
              invalid={timeInvalid}
              aria-describedby={timeInvalid ? `error-effective-${level.id}` : undefined}
              value={time}
              onChange={setTime}
            />
            <FieldError id={`error-effective-${level.id}`}>
              {timeInvalid ? t("timeInvalid") : undefined}
            </FieldError>
            {effectiveAt && <p>{effectiveAt}</p>}
          </>
        )}
        <p>{t("effectiveHelp")}</p>
      </fieldset>
      <Confirm
        label={t("publish")}
        guard={guard}
        disabled={
          publishInvalid ||
          ((stale || command.canRecover) && !publishReplay) ||
          busy ||
          command.seconds > 0
        }
        pending={command.pending || command.seconds > 0}
        failure={command.failure}
        onConfirm={async () => {
          const result = await command.run(
            publishPath,
            input,
            "EnvelopeQualificationLevel",
            `"v${baseline.version}"`,
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
        {!level.terminal && (
          <Thresholds
            requiredTrips={input.requiredTrips}
            requiredDistanceM={input.requiredDistanceM}
          />
        )}
        {input.reason && <p>{input.reason}</p>}
        <p>{t("effectiveHelp")}</p>
      </Confirm>
      <Failure error={command.failure} seconds={command.seconds} />
      <Recovery
        command={command}
        onAttempt={settingsVisibility === undefined ? undefined : checkingPreviousAction}
        onRecovered={() => {
          setSuccess(true);
          setPreview(null);
        }}
      />
      {success && <p role="status">{t("success")}</p>}
      <fieldset className="stack" disabled={busy}>
        <legend>{t("sample")}</legend>
        <p>{t("sampleHelp")}</p>
        <Label htmlFor={`sample-mass-${level.id}`}>{t("sampleMass")}</Label>
        <Input
          id={`sample-mass-${level.id}`}
          inputMode="decimal"
          value={sampleMass}
          onChange={(e) => setSampleMass(e.target.value)}
          aria-invalid={sampleMassValue === undefined}
          aria-describedby={
            sampleMassValue === undefined ? `error-sample-mass-${level.id}` : undefined
          }
        />
        <FieldError id={`error-sample-mass-${level.id}`}>
          {sampleMassValue === undefined ? t("sampleMassInvalid") : undefined}
        </FieldError>
        <h5>{t("chain")}</h5>
        <SampleTrailers game={level.game} sample={sample} onChange={setSample} />
        <Label htmlFor={`adr-status-${level.id}`}>{t("adrStatus")}</Label>
        <select
          className="input"
          id={`adr-status-${level.id}`}
          value={sample.adr.status}
          onChange={(e) =>
            setSample((old) => ({
              ...old,
              adr: { status: e.target.value as typeof sample.adr.status, adrClass: null },
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
          <>
            <RequiredLabel id={`adr-class-${level.id}`}>{t("sampleAdr")}</RequiredLabel>
            <select
              className="input"
              id={`adr-class-${level.id}`}
              required
              aria-invalid={sampleAdrInvalid}
              aria-describedby={sampleAdrInvalid ? `error-adr-class-${level.id}` : undefined}
              value={sample.adr.adrClass ?? ""}
              onChange={(e) =>
                setSample((old) => ({
                  ...old,
                  adr: { status: "known", adrClass: (e.target.value || null) as AdrClass | null },
                }))
              }
            >
              <option value="">{t("sampleAdrSelect")}</option>
              {adrClasses.map((value) => (
                <option key={value} value={value}>
                  {t("catalogs:adrClass", { class: value })}
                </option>
              ))}
            </select>
            <FieldError id={`error-adr-class-${level.id}`}>
              {sampleAdrInvalid ? t("sampleAdrRequired") : undefined}
            </FieldError>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={
            massInvalid ||
            sampleMassValue === undefined ||
            sampleAdrInvalid ||
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
        ) : preview ? (
          <p>{t("previewStale")}</p>
        ) : null}
      </fieldset>
    </section>
  );
  return settingsVisibility !== undefined ? (
    <Card className="stack">
      <h3>{level.name}</h3>
      {current && <RulesView rules={current.rules} game={level.game} />}
      {editor}
    </Card>
  ) : (
    editor
  );
}

function RequiredLabel({ id, children }: { id: string; children: string }) {
  const { t } = useTranslation("qualifications");
  return (
    <Label htmlFor={id}>
      {children}
      <span aria-hidden="true"> ({t("required")})</span>
    </Label>
  );
}

function AdrClassAllowlist({
  classes,
  onChange,
}: {
  classes: AdrClass[];
  onChange: (classes: AdrClass[]) => void;
}) {
  const { t } = useTranslation("qualifications");
  return (
    <div className="qualification-adr-classes">
      {adrClasses.map((value) => (
        <label className="qualification-check" key={value}>
          <input
            type="checkbox"
            checked={classes.includes(value)}
            onChange={(e) =>
              onChange(e.target.checked ? [...classes, value] : classes.filter((c) => c !== value))
            }
          />
          {t("catalogs:adrClass", { class: value })}
        </label>
      ))}
      {!classes.length && <p>{t("emptyAllowlist")}</p>}
    </div>
  );
}
function Allowlist({
  game,
  ids,
  onChange,
}: {
  game: Game;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation("qualifications"),
    [selected, setSelected] = useState<string | null>(null),
    [rowPage, setRowPage] = useState(0);
  return (
    <div className="stack">
      <CatalogSelector
        label={t("allowed_trailer_types")}
        game={game}
        kind="trailer"
        value={selected}
        onChange={setSelected}
      />
      <Button
        type="button"
        variant="outline"
        disabled={!selected || ids.length >= 1000 || ids.includes(selected)}
        onClick={() => {
          if (selected) {
            setRowPage(Math.floor(ids.length / 25));
            onChange([...ids, selected]);
            setSelected(null);
          }
        }}
      >
        {t("add")}
      </Button>
      {!ids.length && <p>{t("emptyAllowlist")}</p>}
      <DraftEntities
        ids={ids}
        game={game}
        page={rowPage}
        onPage={setRowPage}
        onRemove={(index) => onChange(ids.filter((_, i) => i !== index))}
      />
    </div>
  );
}
function SampleTrailers({
  game,
  sample,
  onChange,
}: {
  game: Game;
  sample: DTO["QualificationPreviewInput"]["sample"];
  onChange: (value: DTO["QualificationPreviewInput"]["sample"]) => void;
}) {
  const { t } = useTranslation("qualifications"),
    [selected, setSelected] = useState<string | null>(null),
    [rowPage, setRowPage] = useState(0);
  return (
    <>
      <CatalogSelector
        label={t("sampleTrailer")}
        game={game}
        kind="trailer"
        value={selected}
        onChange={setSelected}
      />
      <div className="qualification-actions">
        <Button
          type="button"
          variant="outline"
          disabled={!selected || sample.trailerTypeIds.length >= 1}
          onClick={() => {
            if (selected) {
              setRowPage(Math.floor(sample.trailerTypeIds.length / 25));
              onChange({
                ...sample,
                trailerTypeIds: [...sample.trailerTypeIds, selected],
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
          disabled={sample.trailerTypeIds.length >= 1}
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
        game={game}
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
