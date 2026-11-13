import { useId, useState } from "react";
import { flushSync } from "react-dom";
import { useSession } from "../../../app/Session.js";
import { Button } from "../../../shared/ui/primitives.js";
import { useMemberProfile } from "../../drivers/queries.js";
import { EventFailureView } from "../components.js";
import type { DTO } from "../model.js";
import {
  DepotField,
  DlcField,
  EditorCatalogSelector,
  useEditorCatalogItem,
  useEditorDlcs,
  useRetainedDepot,
} from "./catalog.js";
import {
  DefinitionFeedback,
  definitionFields,
  type EditorDefinition,
  type EditorSource,
  useDefinitionActions,
} from "./definition.js";
import { EditorAccess, EventDraftRead } from "./draft.js";
import {
  BasicsFields,
  EditorDecimal,
  EditorField,
  focusEditorField,
  OrganizerField,
  Required,
  RouteBasics,
  shiftMass,
  TimeFields,
} from "./fields.js";
import { EditorGallery, useEditorGallery } from "./gallery.js";
import {
  changeEditorCity,
  changeEditorDepot,
  changeEditorGame,
  type EditorErrors,
  type EditorForm,
  type FieldName,
  initialEventEditor,
  type RouteEnd,
  validateEventEditor,
} from "./model.js";
import { EditorPreview } from "./preview.js";
import { rebaseEventEditor } from "./rebase.js";
import { useEditorText } from "./text.js";
import "./editor.css";

export type Stage2EventEditorProps = {
  source: EditorSource;
  onCancel: () => void;
  onPublished?: ((member: DTO["EventStage2Member"], etag: string) => void) | undefined;
};

export function Stage2EventEditor({ source, ...props }: Stage2EventEditorProps) {
  return (
    <EditorAccess>
      {(scope) => {
        if (source.kind === "draft") {
          return (
            <DraftEditor
              key={JSON.stringify([scope, source.kind, source.id])}
              id={source.id}
              {...props}
            />
          );
        }
        const id = source.kind === "published" ? source.member.event.id : null;
        return (
          <EventEditorForm
            key={JSON.stringify([scope, source.kind, id])}
            source={source}
            {...props}
          />
        );
      }}
    </EditorAccess>
  );
}

type EditorCallbacks = Omit<Stage2EventEditorProps, "source">;

function DraftEditor({ id, ...props }: EditorCallbacks & { id: string }) {
  const [publishing, setPublishing] = useState(false);
  return (
    <EventDraftRead id={id} observeAfterOpening={!publishing}>
      {(draft) => (
        <EventEditorForm
          source={draft}
          onDraftPublication={(active) => {
            // The next command can complete before a batched state update reaches the observer.
            if (active) flushSync(() => setPublishing(true));
            else setPublishing(false);
          }}
          {...props}
        />
      )}
    </EventDraftRead>
  );
}

const fieldOrder: readonly FieldName[] = [
  "title",
  "game",
  "visibility",
  "description",
  "meetingAt",
  "startsAt",
  "endsAt",
  "platform",
  "server",
  "originCityId",
  "originDepotId",
  "destinationCityId",
  "destinationDepotId",
  "distanceKm",
  "requiredDlcIds",
  "prescribedCargoId",
  "prescribedTrailerTypeId",
  "prescribedMassKg",
  "organizerMemberId",
];
const ends = ["origin", "destination"] as const;
const clearDepots = { origin: false, destination: false };

function ErrorSummary({ id, errors }: { id: string; errors: EditorErrors }) {
  const { text } = useEditorText();
  const fields = fieldOrder.filter((field) => errors[field]);
  if (!fields.length) return null;
  return (
    <div role="alert" className="event-editor-errors">
      <strong>{text.errorSummary}</strong>
      <ul>
        {fields.map((field) => (
          <li key={field}>
            <a
              href={`#${id}-${field}-field`}
              onClick={(event) => {
                event.preventDefault();
                focusEditorField(id, field);
              }}
            >
              {text[field]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventEditorForm({
  source,
  onCancel,
  onPublished,
  onDraftPublication,
}: EditorCallbacks & { source: EditorDefinition; onDraftPublication?: (active: boolean) => void }) {
  const { text, locale } = useEditorText();
  const draftsEnabled = useSession().eventsDraftsEnabled;
  const id = useId();
  const [form, setForm] = useState(() =>
    initialEventEditor(definitionFields(source), source.kind !== "new"),
  );
  const [attempt, setAttempt] = useState<"draft" | "publish" | null>(null);
  const [blockedDepots, setBlockedDepots] = useState(clearDepots);
  const [organizer, setOrganizer] = useState<DTO["MemberSummary"] | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [showLoad, setShowLoad] = useState(
    () => !!(form.prescribedCargoId || form.prescribedTrailerTypeId || form.prescribedMassKg),
  );
  const actions = useDefinitionActions(source, onPublished, onDraftPublication);
  const { definition, eventId } = actions;
  const member = definition.kind === "published" ? definition.member : null;
  const event = member?.event;
  const latestMember = actions.latest?.kind === "published" ? actions.latest.member : undefined;
  const latestEvent = latestMember?.event;
  const latestForm = actions.latest && initialEventEditor(definitionFields(actions.latest), true);
  const rebase =
    latestForm &&
    rebaseEventEditor(
      initialEventEditor(definitionFields(definition), definition.kind !== "new"),
      form,
      latestForm,
    );

  const origin = useEditorCatalogItem("cities", form.origin.cityId, locale);
  const destination = useEditorCatalogItem("cities", form.destination.cityId, locale);
  const originDepot = useRetainedDepot(form.game, form.origin, locale);
  const destinationDepot = useRetainedDepot(form.game, form.destination, locale);
  const cargo = useEditorCatalogItem("cargoes", form.prescribedCargoId, locale);
  const trailer = useEditorCatalogItem("trailers", form.prescribedTrailerTypeId, locale);
  const originHint = event?.origin?.entityId === form.origin.cityId ? event?.origin : null;
  const destinationHint =
    event?.destination?.entityId === form.destination.cityId ? event?.destination : null;
  const originDepotHint =
    event?.originDepot?.id === form.origin.depotId ? event?.originDepot : null;
  const destinationDepotHint =
    event?.destinationDepot?.id === form.destination.depotId ? event?.destinationDepot : null;
  const sameRoute =
    !!event &&
    event.game === form.game &&
    (event.origin?.entityId ?? null) === form.origin.cityId &&
    (event.destination?.entityId ?? null) === form.destination.cityId &&
    (event.originDepot?.id ?? null) === form.origin.depotId &&
    (event.destinationDepot?.id ?? null) === form.destination.depotId;
  const retainedDlcs = event?.requiredDlcs ?? [];
  const derived = [
    origin?.game === form.game ? origin.dlcId : null,
    destination?.game === form.game ? destination.dlcId : null,
    originDepot?.dlcId,
    destinationDepot?.dlcId,
    ...(sameRoute
      ? retainedDlcs.filter(({ sources }) => sources.includes("from_city")).map(({ id }) => id)
      : []),
  ];
  const dlcs = useEditorDlcs(form.requiredDlcIds, derived, retainedDlcs);
  const overlapping = (field: FieldName) => rebase?.overlaps.find((entry) => entry.field === field);
  const savedOrigin = useEditorCatalogItem(
    "cities",
    overlapping("originCityId")?.saved ?? null,
    locale,
  );
  const savedDestination = useEditorCatalogItem(
    "cities",
    overlapping("destinationCityId")?.saved ?? null,
    locale,
  );
  const savedCargo = useEditorCatalogItem(
    "cargoes",
    overlapping("prescribedCargoId")?.saved ?? null,
    locale,
  );
  const savedTrailer = useEditorCatalogItem(
    "trailers",
    overlapping("prescribedTrailerTypeId")?.saved ?? null,
    locale,
  );
  const savedOriginDepot = useRetainedDepot(
    latestForm?.game ?? "",
    {
      cityId: latestForm?.origin.cityId ?? null,
      depotId: overlapping("originDepotId")?.saved ?? null,
    },
    locale,
  );
  const savedDestinationDepot = useRetainedDepot(
    latestForm?.game ?? "",
    {
      cityId: latestForm?.destination.cityId ?? null,
      depotId: overlapping("destinationDepotId")?.saved ?? null,
    },
    locale,
  );
  const savedDlcs = useEditorDlcs(
    overlapping("requiredDlcIds") && latestForm ? latestForm.requiredDlcIds : [],
    [],
    latestEvent?.requiredDlcs ?? [],
  );
  const organizerOverlap = overlapping("organizerMemberId");
  const savedOrganizer = useMemberProfile(organizerOverlap?.saved ?? "");
  const localOrganizer = useMemberProfile(organizerOverlap?.local ?? "");
  const catalogErrors: EditorErrors = {};
  if (form.game) {
    for (const [field, item] of [
      ["originCityId", origin],
      ["destinationCityId", destination],
      ["prescribedCargoId", cargo],
      ["prescribedTrailerTypeId", trailer],
    ] as const) {
      if (item && item.game !== form.game) catalogErrors[field] = "wrongGame";
    }
    if (
      dlcs.some(({ game, sources }) => game && game !== form.game && sources.includes("manual"))
    ) {
      catalogErrors.requiredDlcIds = "wrongGame";
    }
  }
  const validation = validateEventEditor(
    form,
    ends.filter((end) => blockedDepots[end]),
    catalogErrors,
  );
  const errors =
    attempt === "publish"
      ? validation.publishErrors
      : attempt === "draft"
        ? validation.draftErrors
        : {};
  const galleryEnabled = draftsEnabled || definition.kind === "published";
  const gallery = useEditorGallery(
    actions.accessFailure ? null : eventId,
    ensureDraft,
    galleryEnabled && !actions.accessFailure,
    definition.kind === "published",
  );
  const disableForm = actions.locked || gallery.busy;
  const saving = actions.pending || gallery.busy;

  function change<K extends keyof EditorForm>(key: K, value: EditorForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    actions.clearStatus();
  }

  function changeGame(game: EditorForm["game"]) {
    setForm((previous) => changeEditorGame(previous, game));
    setBlockedDepots(clearDepots);
    actions.clearStatus();
  }

  function changeCity(end: RouteEnd, cityId: string | null) {
    setForm((previous) => changeEditorCity(previous, end, cityId));
    setBlockedDepots((previous) => ({ ...previous, [end]: false }));
    actions.clearStatus();
  }

  function changeDepot(end: RouteEnd, depot: DTO["CatalogDepot"] | null) {
    setForm((previous) => changeEditorDepot(previous, end, depot));
    actions.clearStatus();
  }

  function showErrors(kind: "draft" | "publish", next: EditorErrors) {
    setAttempt(kind);
    const first = fieldOrder.find((field) => next[field]);
    if (first) focusEditorField(id, first);
  }

  async function ensureDraft() {
    if (!draftsEnabled) return null;
    if (eventId) return eventId;
    if (!validation.draft) {
      showErrors("draft", validation.draftErrors);
      return null;
    }
    return actions.saveDraft(validation.draft);
  }

  function saveDraft() {
    if (!draftsEnabled || disableForm) return;
    if (!validation.draft) {
      showErrors("draft", validation.draftErrors);
      return;
    }
    setAttempt(null);
    void actions.saveDraft(validation.draft);
  }

  function publish() {
    if (disableForm) return;
    if (!validation.complete) {
      showErrors("publish", validation.publishErrors);
      return;
    }
    setAttempt(null);
    void actions.publish(validation.complete);
  }

  function resolveLatest(keepEdits: boolean) {
    if (!actions.latest || !latestForm || !rebase) return;
    const next = keepEdits ? rebase.form : latestForm;
    setForm(next);
    setShowLoad(
      !!(next.prescribedCargoId || next.prescribedTrailerTypeId || next.prescribedMassKg),
    );
    if (organizer?.id !== next.organizerMemberId) setOrganizer(null);
    setAttempt(keepEdits ? (actions.latest.kind === "published" ? "publish" : "draft") : null);
    setBlockedDepots(clearDepots);
    setFormVersion((previous) => previous + 1);
    actions.acceptLatest();
  }

  const cityNames = [
    origin?.display.label ?? originHint?.label,
    destination?.display.label ?? destinationHint?.label,
  ];
  const depotNames = [
    originDepot?.company.label.label ?? originDepotHint?.name,
    destinationDepot?.company.label.label ?? destinationDepotHint?.name,
  ];
  const retainedOrganizer =
    organizer && organizer.id === form.organizerMemberId
      ? organizer.nickname
      : member?.organizerMemberId && member.organizerMemberId === form.organizerMemberId
        ? event?.organizer
        : undefined;

  const cargoName =
    cargo?.display.label ??
    (member?.prescribedCargoId === form.prescribedCargoId
      ? member?.prescribedCargo?.label
      : undefined);
  const trailerName =
    trailer?.display.label ??
    (member?.prescribedTrailerTypeId === form.prescribedTrailerTypeId
      ? member?.prescribedTrailerType?.label
      : undefined);
  const depotName = (
    depot: DTO["CatalogDepot"] | undefined,
    hint?: DTO["EventStage2CanonicalCatalogOption"] | null,
  ) =>
    depot
      ? `${depot.company.label.label} · ${depot.company.code}`
      : hint
        ? `${hint.name} · ${hint.code}`
        : undefined;
  const localLabels: Partial<Record<FieldName, string | undefined>> = {
    originCityId: cityNames[0],
    destinationCityId: cityNames[1],
    originDepotId: depotName(originDepot, originDepotHint),
    destinationDepotId: depotName(destinationDepot, destinationDepotHint),
    prescribedCargoId: cargoName,
    prescribedTrailerTypeId: trailerName,
    organizerMemberId:
      retainedOrganizer ??
      (!localOrganizer.isError && localOrganizer.data?.member.id === organizerOverlap?.local
        ? localOrganizer.data?.member.nickname
        : undefined),
  };
  const savedLabels: typeof localLabels = {
    originCityId: savedOrigin?.display.label ?? latestEvent?.origin?.label,
    destinationCityId: savedDestination?.display.label ?? latestEvent?.destination?.label,
    originDepotId: depotName(savedOriginDepot, latestEvent?.originDepot),
    destinationDepotId: depotName(savedDestinationDepot, latestEvent?.destinationDepot),
    prescribedCargoId: savedCargo?.display.label ?? latestMember?.prescribedCargo?.label,
    prescribedTrailerTypeId:
      savedTrailer?.display.label ?? latestMember?.prescribedTrailerType?.label,
    organizerMemberId:
      latestEvent?.organizer ??
      (!savedOrganizer.isError && savedOrganizer.data?.member.id === organizerOverlap?.saved
        ? savedOrganizer.data?.member.nickname
        : undefined),
  };

  function overlapLabel(field: FieldName, value: string | null, side: "local" | "saved") {
    if (value === null) return text.noValue;
    if (field === "prescribedMassKg") return `${shiftMass(value, -3)} ${text.tonnes}`;
    if (field === "requiredDlcIds") {
      const entries = side === "local" ? dlcs : savedDlcs;
      return value
        .split(", ")
        .map((id) => {
          const entry = entries.find((dlc) => dlc.id === id);
          return entry?.label
            ? [entry.label, entry.code].filter(Boolean).join(" · ")
            : text.conflictSelectionUnavailable;
        })
        .join(", ");
    }
    const labels = side === "local" ? localLabels : savedLabels;
    return field in labels ? (labels[field] ?? text.conflictSelectionUnavailable) : value;
  }

  if (actions.accessFailure)
    return (
      <div className="stack">
        <EventFailureView error={actions.accessFailure} />
        <Button type="button" variant="ghost" onClick={onCancel}>
          {text.cancel}
        </Button>
      </div>
    );

  return (
    <div className="event-stage2-editor">
      <div className="event-editor-layout">
        <form className="event-editor-form" onSubmit={(event) => event.preventDefault()} noValidate>
          <ErrorSummary id={id} errors={errors} />
          <fieldset className="event-editor-controls" disabled={disableForm}>
            <BasicsFields
              base={id}
              form={form}
              errors={errors}
              onChange={change}
              onGame={changeGame}
            />
            <TimeFields
              key={formVersion}
              base={id}
              form={form}
              errors={errors}
              onScheduleChange={(fields) => {
                setForm((previous) => ({ ...previous, ...fields }));
                actions.clearStatus();
              }}
            />
            <fieldset className="event-editor-section">
              <legend>{text.route}</legend>
              <RouteBasics base={id} form={form} errors={errors} onChange={change} />
              <div className="event-editor-grid event-editor-route">
                {ends.map((end, index) => {
                  const city = index === 0 ? origin : destination;
                  const depot = index === 0 ? originDepot : destinationDepot;
                  const hint = index === 0 ? originDepotHint : destinationDepotHint;
                  const cityField = `${end}CityId` as const;
                  const depotField = `${end}DepotId` as const;
                  return (
                    <fieldset key={end} className="event-editor-route-end">
                      <legend>{text[end]}</legend>
                      <EditorField base={id} name={cityField} error={errors[cityField]}>
                        {() => (
                          <EditorCatalogSelector
                            label={text[cityField]}
                            caption={text.city}
                            required
                            game={form.game}
                            kind="city"
                            value={form[end].cityId}
                            item={city}
                            onChange={(value) => changeCity(end, value)}
                          />
                        )}
                      </EditorField>
                      <EditorField base={id} name={depotField} error={errors[depotField]}>
                        {(fieldId, errorId) => (
                          <DepotField
                            key={JSON.stringify([formVersion, form.game, form[end].cityId])}
                            id={fieldId}
                            label={text[depotField]}
                            caption={text.depot}
                            game={form.game}
                            endpoint={form[end]}
                            resolved={depot}
                            hint={hint}
                            errorId={errorId}
                            onChange={(value) => changeDepot(end, value)}
                            onBlocked={(value) =>
                              setBlockedDepots((previous) => ({ ...previous, [end]: value }))
                            }
                          />
                        )}
                      </EditorField>
                    </fieldset>
                  );
                })}
              </div>
              <EditorDecimal
                base={id}
                name="distanceKm"
                value={form.distanceKm}
                error={errors.distanceKm}
                onChange={(value) => change("distanceKm", value)}
              />
              <EditorField base={id} name="requiredDlcIds" error={errors.requiredDlcIds}>
                {(fieldId, errorId) => (
                  <DlcField
                    key={form.game}
                    id={fieldId}
                    game={form.game}
                    entries={dlcs}
                    onChange={(values) => change("requiredDlcIds", values)}
                    errorId={errorId}
                  />
                )}
              </EditorField>
            </fieldset>
            <fieldset className="event-editor-section event-editor-load-section">
              <legend>
                {text.load} <span className="muted">{text.optional}</span>
              </legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="event-editor-disclosure event-editor-load-toggle"
                aria-expanded={showLoad}
                onClick={() => {
                  setShowLoad(!showLoad);
                  if (showLoad) {
                    setForm((previous) => ({
                      ...previous,
                      prescribedCargoId: null,
                      prescribedTrailerTypeId: null,
                      prescribedMassKg: "",
                    }));
                    actions.clearStatus();
                  }
                }}
              >
                {showLoad ? text.removeLoad : `+ ${text.addLoad}`}
              </Button>
              {showLoad && (
                <>
                  <div className="event-editor-grid event-editor-load">
                    {(
                      [
                        ["prescribedCargoId", "cargo", cargo],
                        ["prescribedTrailerTypeId", "trailer", trailer],
                      ] as const
                    ).map(([key, kind, item]) => (
                      <EditorField base={id} key={key} name={key} error={errors[key]}>
                        {() => (
                          <EditorCatalogSelector
                            label={text[key]}
                            game={form.game}
                            kind={kind}
                            value={form[key]}
                            item={item}
                            onChange={(value) => change(key, value)}
                          />
                        )}
                      </EditorField>
                    ))}
                    <EditorDecimal
                      key={`${formVersion}-${form.game}`}
                      base={id}
                      name="prescribedMassKg"
                      value={form.prescribedMassKg}
                      error={errors.prescribedMassKg}
                      onChange={(value) => change("prescribedMassKg", value)}
                    />
                  </div>
                  <p className="muted">{text.loadHelp}</p>
                </>
              )}
            </fieldset>
          </fieldset>
          {galleryEnabled && (
            <EditorGallery eventId={eventId} gallery={gallery} disabled={actions.locked} />
          )}
          <fieldset className="event-editor-controls" disabled={disableForm}>
            <OrganizerField
              base={id}
              value={form.organizerMemberId}
              hint={retainedOrganizer}
              legacyName={member && !member.organizerMemberId ? event?.organizer : undefined}
              error={errors.organizerMemberId}
              onChange={(value) => {
                setOrganizer(value);
                change("organizerMemberId", value?.id ?? null);
              }}
            />
          </fieldset>
          <div className="event-editor-actions">
            <DefinitionFeedback
              actions={actions}
              blocked={gallery.busy}
              rebase={rebase}
              overlapLabel={overlapLabel}
              onResolveLatest={resolveLatest}
            />
            <div className="event-editor-inline">
              <Button type="button" disabled={disableForm} onClick={publish}>
                {text[definition.kind === "published" ? "save" : "publish"]}
              </Button>
              {draftsEnabled && definition.kind !== "published" && (
                <Button type="button" variant="outline" disabled={disableForm} onClick={saveDraft}>
                  {text.draft}
                </Button>
              )}
              <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
                {text.cancel}
              </Button>
              <small className="event-editor-required-note muted">
                <Required /> {text.requiredNote}
              </small>
            </div>
          </div>
        </form>
        <EditorPreview
          form={form}
          cityNames={cityNames}
          depotNames={depotNames}
          dlcs={dlcs}
          cargo={cargoName}
          trailer={trailerName}
          eventId={eventId}
          cover={gallery.cover}
          coverState={
            !galleryEnabled
              ? null
              : gallery.loading
                ? "loading"
                : gallery.readError
                  ? "unavailable"
                  : "empty"
          }
        />
      </div>
    </div>
  );
}
