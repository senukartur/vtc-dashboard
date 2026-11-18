import { Flame, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { adrClasses, itemSchema } from "../../shared/catalog-selectors/contracts.js";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button, Card, Input, Label, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { failureText, LimitList, needText, useLocale } from "./limits.js";
import { baseUnits, compareDecimal, displayUnits, promotionPreview, tripCount } from "./model.js";
import { levelPath } from "./QualificationsPage.js";
import { useQualificationCommand, useQualificationQuery } from "./queries.js";
import type { Conditions, DTO, Game, Level, LevelDetail, Limits } from "./transport.js";
import "./qualifications.css";

type AdrClass = (typeof adrClasses)[number];
type Trailer = { id: string; label: string | null };
interface Draft {
  name: string;
  position: number;
  massMin: string;
  massMax: string;
  distanceMin: string;
  distanceMax: string;
  trailerMode: "any" | "selected";
  trailerBasis: "variant" | "type";
  trailers: Trailer[];
  adrMode: "forbidden" | "selected" | "any";
  adrClasses: AdrClass[];
  hardMode: boolean;
  requiredDistance: string;
  requiredTrips: string;
}
type Command = ReturnType<typeof useQualificationCommand>;

/** Q5: create (`/new?game=`) or edit (`/:levelId/edit`) one level; leadership only. */
export function LevelEditor({ mode }: { mode: "new" | "edit" }) {
  const { t } = useTranslation("qualifications"),
    session = useSession(),
    { levelId = "" } = useParams(),
    [params] = useSearchParams();
  if (!session.self?.capabilities.includes("qualifications.manage"))
    return (
      <Card className="stack">
        <p>{t("notAllowed")}</p>
        <Button asChild variant="outline">
          <Link to="/account/qualifications">{t("back")}</Link>
        </Button>
      </Card>
    );
  return mode === "new" ? (
    <CreateLevel game={params.get("game") === "ats" ? "ats" : "ets2"} />
  ) : (
    <EditLevel key={levelId} levelId={levelId} />
  );
}
function CreateLevel({ game }: { game: Game }) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand(),
    query = useQualificationQuery(
      `/qualification-levels?game=${game}`,
      "EnvelopeQualificationLevelList",
    ),
    ladder = query.data?.data.data.levels,
    // A level added at the top gives the current top a next level; its preview needs its drivers.
    topId = ladder?.at(-1)?.id,
    topQuery = useQualificationQuery(
      `/qualification-levels/${encodeURIComponent(topId ?? "")}`,
      "EnvelopeQualificationLevelDetail",
      !!topId,
    ),
    formerTop = topQuery.data?.data.data ?? null;
  if (!ladder) return <Loading query={query} />;
  if (topId && !formerTop) return <Loading query={topQuery} />;
  return (
    <Editor
      key={ladder.map((level) => `${level.id}:${level.version}`).join(",")}
      game={game}
      ladder={ladder}
      detail={null}
      formerTop={formerTop}
      command={command}
      title={t("newTitle")}
    />
  );
}
function EditLevel({ levelId }: { levelId: string }) {
  const { t } = useTranslation("qualifications"),
    command = useQualificationCommand(),
    query = useQualificationQuery(
      `/qualification-levels/${encodeURIComponent(levelId)}`,
      "EnvelopeQualificationLevelDetail",
    ),
    detail = query.data?.data.data,
    ladderQuery = useQualificationQuery(
      `/qualification-levels?game=${detail?.game ?? "ets2"}`,
      "EnvelopeQualificationLevelList",
      !!detail,
    ),
    ladder = ladderQuery.data?.data.data.levels;
  if (!detail) return <Loading query={query} />;
  if (!ladder) return <Loading query={ladderQuery} />;
  return (
    <Editor
      key={`${detail.id}:${detail.version}`}
      game={detail.game}
      ladder={ladder}
      detail={detail}
      formerTop={null}
      command={command}
      title={t("editTitle", { name: detail.name })}
    />
  );
}
function Loading({ query }: { query: { isError: boolean; refetch: () => unknown } }) {
  const { t } = useTranslation("qualifications");
  return query.isError ? (
    <Card className="stack">
      <p role="alert">{t("loadFailed")}</p>
      <Button type="button" variant="outline" onClick={() => void query.refetch()}>
        {t("refresh")}
      </Button>
    </Card>
  ) : (
    <Card role="status">{t("loading")}</Card>
  );
}
function initial(detail: LevelDetail | null, ladder: Level[], locale: "ru" | "en"): Draft {
  const limits = detail?.limits;
  return {
    name: detail?.name ?? "",
    position: detail?.position ?? ladder.length + 1,
    massMin: displayUnits(limits?.massMinKg ?? null, locale),
    massMax: displayUnits(limits?.massMaxKg ?? null, locale),
    distanceMin: displayUnits(limits?.distanceMinM ?? null, locale),
    distanceMax: displayUnits(limits?.distanceMaxM ?? null, locale),
    trailerMode: limits?.trailers.mode ?? "any",
    trailerBasis: detail ? (limits?.trailers.basis ?? "variant") : "type",
    trailers:
      limits?.trailers.types.map((type) => ({ id: type.entityId, label: type.label })) ?? [],
    adrMode: limits?.adr.mode ?? "any",
    adrClasses: [...(limits?.adr.classes ?? [])],
    hardMode: limits?.hardModeRequired ?? false,
    requiredDistance: displayUnits(detail?.conditions.requiredDistanceM ?? null, locale),
    requiredTrips:
      detail?.conditions.requiredTrips === null || detail?.conditions.requiredTrips === undefined
        ? ""
        : String(detail.conditions.requiredTrips),
  };
}
/** Client checks mirror the server so most mistakes show next to their field. */
function validate(draft: Draft, top: boolean) {
  const amounts = {
    massMin: baseUnits(draft.massMin),
    massMax: baseUnits(draft.massMax),
    distanceMin: baseUnits(draft.distanceMin),
    distanceMax: baseUnits(draft.distanceMax),
    requiredDistance: baseUnits(draft.requiredDistance),
  };
  const trips = tripCount(draft.requiredTrips);
  const errors: Partial<Record<keyof Draft | "conditions", string>> = {};
  if (!draft.name.trim()) errors.name = "nameRequired";
  for (const key of ["massMin", "massMax", "distanceMin", "distanceMax"] as const)
    if (amounts[key] === undefined) errors[key] = "invalidNumber";
  if (amounts.massMin && amounts.massMax && compareDecimal(amounts.massMin, amounts.massMax) > 0)
    errors.massMax = "minAboveMax";
  if (
    amounts.distanceMin &&
    amounts.distanceMax &&
    compareDecimal(amounts.distanceMin, amounts.distanceMax) > 0
  )
    errors.distanceMax = "minAboveMax";
  if (amounts.massMax === "0") errors.massMax = "invalidNumber";
  if (amounts.distanceMax === "0") errors.distanceMax = "invalidNumber";
  if (draft.trailerMode === "selected" && !draft.trailers.length)
    errors.trailers = "trailersNeedOne";
  if (draft.adrMode === "selected" && !draft.adrClasses.length) errors.adrClasses = "adrNeedOne";
  if (amounts.requiredDistance === undefined || amounts.requiredDistance === "0")
    errors.requiredDistance = "invalidNumber";
  if (trips === undefined) errors.requiredTrips = "invalidTrips";
  if (
    !top &&
    !errors.requiredDistance &&
    !errors.requiredTrips &&
    amounts.requiredDistance === null &&
    trips === null
  )
    errors.conditions = "conditionsRequired";
  const conditions: Conditions = {
    requiredTrips: trips ?? null,
    requiredDistanceM: amounts.requiredDistance ?? null,
  };
  return { errors, amounts, conditions };
}
function Editor({
  game,
  ladder,
  detail,
  formerTop,
  command,
  title,
}: {
  game: Game;
  ladder: Level[];
  detail: LevelDetail | null;
  /** On create, the current top level, whose drivers a new top level could promote. */
  formerTop: LevelDetail | null;
  command: Command;
  title: string;
}) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    navigate = useNavigate(),
    [draft, setDraft] = useState(() => initial(detail, ladder, locale)),
    [touched, setTouched] = useState(false),
    [picking, setPicking] = useState<string | null>(null),
    base = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const top = detail ? detail.nextLevel === null : draft.position === ladder.length + 1;
  const { errors, amounts, conditions } = validate(draft, top);
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined);
  const nextName = detail?.nextLevel?.name ?? null;
  const preview =
    detail && nextName && !errors.conditions
      ? promotionPreview(detail.drivers, conditions, true)
      : 0;
  // Creating at the top: the former top's drivers who meet its conditions move up at once.
  const createdTop = !detail && top && formerTop ? formerTop : null;
  const createPreview = createdTop
    ? promotionPreview(createdTop.drivers, createdTop.conditions, true)
    : 0;
  const previewLimits: Limits = {
    massMinKg: amounts.massMin ?? null,
    massMaxKg: amounts.massMax ?? null,
    distanceMinM: amounts.distanceMin ?? null,
    distanceMaxM: amounts.distanceMax ?? null,
    trailers: {
      basis: draft.trailerBasis,
      mode: draft.trailerMode,
      types:
        draft.trailerMode === "selected"
          ? draft.trailers.map((trailer) => label(trailer, locale))
          : [],
    },
    adr: {
      mode: draft.adrMode,
      classes: draft.adrMode === "selected" ? [...draft.adrClasses].sort() : [],
    },
    hardModeRequired: draft.hardMode,
  };
  const others = ladder.filter((level) => level.id !== detail?.id);
  const field = (key: string) => `${base}-${key}`;
  async function submit() {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const limits: DTO["QualificationLimitsInput"] = {
      massMinKg: amounts.massMin ?? null,
      massMaxKg: amounts.massMax ?? null,
      distanceMinM: amounts.distanceMin ?? null,
      distanceMaxM: amounts.distanceMax ?? null,
      trailers: {
        basis: draft.trailerBasis,
        mode: draft.trailerMode,
        typeIds:
          draft.trailerMode === "selected" ? draft.trailers.map((trailer) => trailer.id) : [],
      },
      adr: {
        mode: draft.adrMode,
        classes: draft.adrMode === "selected" ? [...draft.adrClasses].sort() : [],
      },
      hardModeRequired: draft.hardMode,
    };
    const result = detail
      ? await command.run(
          "PUT",
          `/admin/qualification-levels/${detail.id}`,
          { expectedVersion: detail.version, name: draft.name.trim(), limits, conditions },
          "EnvelopeQualificationLevelCommandResult",
          (saved) => saved.data.promotedCount > 0,
        )
      : await command.run(
          "POST",
          "/admin/qualification-levels",
          { game, position: draft.position, name: draft.name.trim(), limits, conditions },
          "EnvelopeQualificationLevelCommandResult",
          (saved) => saved.data.promotedCount > 0,
        );
    if (result)
      navigate(levelPath(result.data.level.id), {
        state: { promotedCount: result.data.promotedCount },
      });
  }
  return (
    <div className="qualification-workspace stack">
      <nav aria-label={t("breadcrumb")} className="qualification-breadcrumb">
        <Link to={`/account/qualifications?game=${game}`}>{t("title")}</Link>
        {detail && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={levelPath(detail.id)}>{detail.name}</Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{detail ? t("edit") : t("newTitle")}</span>
      </nav>
      <header className="qualification-title-row">
        <Badge tone={game}>{game.toUpperCase()}</Badge>
        <h1>{title}</h1>
      </header>
      <form
        className="qualification-editor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="stack">
          <Card className="stack">
            <FormField id={field("name")} label={t("name")} error={shown("name")}>
              <Input
                id={field("name")}
                value={draft.name}
                maxLength={128}
                required
                aria-invalid={!!shown("name")}
                onChange={(e) => set("name", e.target.value)}
              />
            </FormField>
            {!detail && (
              <FormField id={field("position")} label={t("place")}>
                <Select
                  id={field("position")}
                  value={String(draft.position)}
                  onChange={(e) => set("position", Number(e.target.value))}
                >
                  <option value="1">{t("placeFirst")}</option>
                  {others.map((level, index) => (
                    <option key={level.id} value={String(level.position + 1)}>
                      {t(index === others.length - 1 ? "placeAfterTop" : "placeAfter", {
                        name: level.name,
                      })}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
          </Card>
          <Card className="stack">
            <div className="qualification-card-head">
              <h2>{t("limitsTitle")}</h2>
              <InfoTip label={t("limitsTipLabel")} title={t("limitsTitle")}>
                <p>{t("limitsHint1")}</p>
                <p>{t("limitsHint2")}</p>
                <p>{t("limitsHint3")}</p>
              </InfoTip>
            </div>
            <RangeField
              label={t("massLabel")}
              unit={t("tonnes")}
              min={draft.massMin}
              max={draft.massMax}
              onMin={(value) => set("massMin", value)}
              onMax={(value) => set("massMax", value)}
              error={shown("massMin") ?? shown("massMax")}
            />
            <RangeField
              label={t("distanceLabel")}
              unit={t("km")}
              tip={
                <InfoTip label={t("distanceTipLabel")}>
                  <p>{t("distanceTip")}</p>
                </InfoTip>
              }
              min={draft.distanceMin}
              max={draft.distanceMax}
              onMin={(value) => set("distanceMin", value)}
              onMax={(value) => set("distanceMax", value)}
              error={shown("distanceMin") ?? shown("distanceMax")}
            />
            <fieldset className="qualification-fieldset">
              <legend>{t("trailersLabel")}</legend>
              <SegmentedControl
                aria-label={t("trailersLabel")}
                value={draft.trailerMode}
                options={[
                  { value: "any", label: t("trailersAny") },
                  { value: "selected", label: t("trailersSelected") },
                ]}
                onValueChange={(value) => set("trailerMode", value)}
              />
              <p className="qualification-muted">
                {t(draft.trailerMode === "any" ? "trailersHintAny" : "trailersHintSelected")}
              </p>
              {draft.trailerBasis === "variant" && (
                <div className="stack">
                  <p>{t("legacyTrailers")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDraft((previous) => ({ ...previous, trailerBasis: "type", trailers: [] }));
                      setPicking(null);
                    }}
                  >
                    {t("useTrailerTypes")}
                  </Button>
                </div>
              )}
              {draft.trailerMode === "selected" && (
                <div className="stack">
                  <div className="qualification-picker">
                    <CatalogSelector
                      label={t("trailerPick")}
                      game={game}
                      kind="trailer-type"
                      disabled={draft.trailerBasis === "variant"}
                      value={picking}
                      onChange={setPicking}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !picking ||
                        draft.trailers.length >= 100 ||
                        draft.trailers.some((trailer) => trailer.id === picking)
                      }
                      onClick={() => {
                        if (!picking) return;
                        set("trailers", [...draft.trailers, { id: picking, label: null }]);
                        setPicking(null);
                      }}
                    >
                      {t("trailerAdd")}
                    </Button>
                  </div>
                  <ul className="qualification-chips qualification-chip-list">
                    {draft.trailers.map((trailer) => (
                      <TrailerChip
                        key={trailer.id}
                        trailer={trailer}
                        onLabel={(name) =>
                          setDraft((previous) => ({
                            ...previous,
                            trailers: previous.trailers.map((item) =>
                              item.id === trailer.id ? { ...item, label: name } : item,
                            ),
                          }))
                        }
                        onRemove={() =>
                          set(
                            "trailers",
                            draft.trailers.filter((item) => item.id !== trailer.id),
                          )
                        }
                      />
                    ))}
                  </ul>
                  {shown("trailers") && (
                    <p className="field-error">{t(shown("trailers") as string)}</p>
                  )}
                </div>
              )}
            </fieldset>
            <fieldset className="qualification-fieldset">
              <legend>{t("adrLabel")}</legend>
              <SegmentedControl
                aria-label={t("adrLabel")}
                value={draft.adrMode}
                options={[
                  { value: "forbidden", label: t("adrForbidden") },
                  { value: "selected", label: t("adrSelected") },
                  { value: "any", label: t("adrAny") },
                ]}
                onValueChange={(value) => set("adrMode", value)}
              />
              <p className="qualification-muted">
                {t(
                  draft.adrMode === "forbidden"
                    ? "adrHintForbidden"
                    : draft.adrMode === "selected"
                      ? "adrHintSelected"
                      : "adrHintAny",
                )}
              </p>
              {draft.adrMode === "selected" && (
                <div className="qualification-chips">
                  {adrClasses.map((value) => {
                    const on = draft.adrClasses.includes(value);
                    return (
                      <Button
                        key={value}
                        type="button"
                        size="xs"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() =>
                          set(
                            "adrClasses",
                            on
                              ? draft.adrClasses.filter((item) => item !== value)
                              : [...draft.adrClasses, value],
                          )
                        }
                      >
                        {t(`adr${value}`)}
                      </Button>
                    );
                  })}
                </div>
              )}
              {shown("adrClasses") && (
                <p className="field-error">{t(shown("adrClasses") as string)}</p>
              )}
            </fieldset>
            <fieldset className="qualification-fieldset">
              <legend className="qualification-hard-mode">
                <Flame size={13} strokeWidth={1.8} aria-hidden="true" />
                {t("hardMode")}
                <InfoTip label={t("hardModeTipLabel")} title={t("hardMode")}>
                  <p>{t("hardModeTip1")}</p>
                  <p>{t("hardModeTip2")}</p>
                </InfoTip>
              </legend>
              <SegmentedControl
                aria-label={t("hardMode")}
                value={draft.hardMode ? "required" : "optional"}
                options={[
                  { value: "optional", label: t("hardModeOptional") },
                  { value: "required", label: t("hardModeRequired") },
                ]}
                onValueChange={(value) => set("hardMode", value === "required")}
              />
            </fieldset>
          </Card>
          <Card className="stack">
            <div className="qualification-card-head">
              <h2>{t(top ? "conditionsTopTitle" : "conditionsTitle")}</h2>
              <InfoTip label={t("conditionsTipLabel")} title={t("conditionsTitle")}>
                <p>{t("conditionsTip1")}</p>
                <p>{t("conditionsTip2")}</p>
                <p>{t("conditionsTip3")}</p>
                <p>{t("conditionsTip4")}</p>
              </InfoTip>
            </div>
            <div className="qualification-condition-fields">
              <FormField
                id={field("distance")}
                label={t("distanceField")}
                error={shown("requiredDistance")}
              >
                <Input
                  id={field("distance")}
                  inputMode="decimal"
                  value={draft.requiredDistance}
                  aria-invalid={!!shown("requiredDistance") || !!shown("conditions")}
                  onChange={(e) => set("requiredDistance", e.target.value)}
                />
              </FormField>
              <FormField id={field("trips")} label={t("tripsField")} error={shown("requiredTrips")}>
                <Input
                  id={field("trips")}
                  inputMode="numeric"
                  value={draft.requiredTrips}
                  aria-invalid={!!shown("requiredTrips") || !!shown("conditions")}
                  onChange={(e) => set("requiredTrips", e.target.value)}
                />
              </FormField>
            </div>
            {shown("conditions") && (
              <p role="alert" className="field-error">
                {t("conditionsRequired")}
              </p>
            )}
            {preview > 0 && nextName && (
              <p role="status" className="qualification-warning">
                {t("warn", { count: preview, name: nextName })}
              </p>
            )}
            {createPreview > 0 && createdTop && (
              <p role="status" className="qualification-warning">
                {t("warnCreate", {
                  count: createPreview,
                  from: createdTop.name,
                  name: draft.name.trim() || t("newLevelName"),
                })}
              </p>
            )}
          </Card>
          {command.failure && (
            <p role="alert" className="field-error">
              {failureText(t, command.failure, ladder)}
            </p>
          )}
          <div className="qualification-card-actions">
            <InfoTip label={t("immediateLabel")} title={t("immediateTitle")}>
              <p>{t("immediate1")}</p>
              <p>{t("immediate2")}</p>
              <p>{t("immediate3")}</p>
              <p>{t("immediate4")}</p>
            </InfoTip>
            <span className="qualification-muted">{t("immediateTitle")}</span>
            <Button asChild variant="outline">
              <Link to={detail ? levelPath(detail.id) : `/account/qualifications?game=${game}`}>
                {t("cancel")}
              </Link>
            </Button>
            <Button type="submit" disabled={command.pending}>
              {command.pending ? t("saving") : t(detail ? "save" : "create")}
            </Button>
          </div>
        </div>
        <aside className="qualification-summary">
          <Card className="stack">
            <h2>{t("summaryTitle")}</h2>
            <LimitList limits={previewLimits} />
            <dl className="qualification-limit-list">
              <div>
                <dt>{t("summaryNext")}</dt>
                <dd>{top ? t("top") : needText(t, conditions, locale)}</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </form>
    </div>
  );
}
function label(trailer: Trailer, locale: "ru" | "en"): DTO["CatalogLabel"] {
  return {
    entityId: trailer.id,
    label: trailer.label ?? "…",
    requestedLocale: locale,
    renderedLocale: locale,
    englishFallback: false,
    hidden: false,
  };
}
function TrailerChip({
  trailer,
  onLabel,
  onRemove,
}: {
  trailer: Trailer;
  onLabel: (label: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("qualifications"),
    locale = useLocale(),
    query = useCatalogQuery(
      ["qualification-trailer", trailer.id, locale],
      `/catalogs/trailer-types/${trailer.id}?locale=${locale}`,
      itemSchema,
      trailer.label === null,
    ),
    fetched = query.data?.data.data.display.label ?? null,
    name = trailer.label ?? fetched ?? "…";
  useEffect(() => {
    if (trailer.label === null && fetched) onLabel(fetched);
  }, [trailer.label, fetched, onLabel]);
  return (
    <li className="qualification-selected-chip">
      <Badge>{name}</Badge>
      <button
        type="button"
        className="qualification-chip-remove"
        aria-label={t("trailerRemove", { name })}
        onClick={onRemove}
      >
        <X size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </li>
  );
}
function FormField({
  id,
  label: text,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation("qualifications");
  return (
    <div className="stack qualification-field">
      <Label htmlFor={id}>{text}</Label>
      {children}
      {error && <p className="field-error">{t(error)}</p>}
    </div>
  );
}
function RangeField({
  label: text,
  unit,
  tip,
  min,
  max,
  onMin,
  onMax,
  error,
}: {
  label: string;
  unit: string;
  tip?: ReactNode;
  min: string;
  max: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
  error: string | undefined;
}) {
  const { t } = useTranslation("qualifications"),
    id = useId();
  return (
    <fieldset className="qualification-fieldset">
      <legend>
        {text}
        {tip}
      </legend>
      <div className="qualification-range">
        <Label htmlFor={`${id}-min`}>{t("from")}</Label>
        <Input
          id={`${id}-min`}
          inputMode="decimal"
          value={min}
          aria-invalid={!!error}
          onChange={(e) => onMin(e.target.value)}
        />
        <Label htmlFor={`${id}-max`}>{t("to")}</Label>
        <Input
          id={`${id}-max`}
          inputMode="decimal"
          value={max}
          aria-invalid={!!error}
          onChange={(e) => onMax(e.target.value)}
        />
        <span className="qualification-muted">{unit}</span>
      </div>
      {error && <p className="field-error">{t(error)}</p>}
    </fieldset>
  );
}
