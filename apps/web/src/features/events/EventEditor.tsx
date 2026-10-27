import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { Button, Input, Label } from "../../shared/ui/primitives.js";
import { EventFailureView, useEventTimezone } from "./components.js";
import { type DTO, eventTime, utcInput } from "./model.js";
import { useEventCommand } from "./queries.js";
import { schema } from "./transport.js";

function initial(member?: DTO["EventMember"]): DTO["EventInput"] {
  const e = member?.event;
  return {
    title: e?.title ?? "",
    game: e?.game ?? "ets2",
    server: e?.server ?? "",
    organizer: e?.organizer ?? "",
    description: e?.description ?? "",
    route: e?.route ?? "",
    meetingLocation: e?.meetingLocation ?? "",
    meetingAt: e?.meetingAt ?? "",
    startsAt: e?.startsAt ?? "",
    endsAt: e?.endsAt ?? null,
    visibility: member?.visibility ?? "members",
    originCityId: e?.origin?.entityId ?? null,
    destinationCityId: e?.destination?.entityId ?? null,
    prescribedCargoId: member?.prescribedCargoId ?? null,
    prescribedMassKg: member?.prescribedMassKg ?? null,
    prescribedTrailerTypeId: member?.prescribedTrailerTypeId ?? null,
  };
}
export function EventEditor({
  member,
  etag,
  onSaved,
}: {
  member?: DTO["EventMember"];
  etag?: string | null;
  onSaved?: () => void;
}) {
  const { t, i18n } = useTranslation("events"),
    id = useId(),
    timezone = useEventTimezone(),
    navigate = useNavigate(),
    command = useEventCommand();
  const [form, setForm] = useState(() => initial(member)),
    [times, setTimes] = useState(() => ({
      meetingAt: member?.event.meetingAt.replace(/Z$/, "") ?? "",
      startsAt: member?.event.startsAt.replace(/Z$/, "") ?? "",
      endsAt: member?.event.endsAt?.replace(/Z$/, "") ?? "",
    })),
    [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false),
    [catalogOpen, setCatalogOpen] = useState(false);
  function field(key: keyof DTO["EventInput"], value: string | null) {
    setForm((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }
  const catalogFields = [
    "originCityId",
    "destinationCityId",
    "prescribedCargoId",
    "prescribedTrailerTypeId",
  ] as const;
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setInvalid(false);
        setSaved(false);
        const meetingAt = utcInput(times.meetingAt),
          startsAt = utcInput(times.startsAt),
          endsAt = times.endsAt ? utcInput(times.endsAt) : null;
        const input = { ...form, meetingAt, startsAt, endsAt };
        if (
          !meetingAt ||
          !startsAt ||
          endsAt === undefined ||
          meetingAt > startsAt ||
          (endsAt && endsAt < startsAt) ||
          !schema("EventInput").safeParse(input).success
        ) {
          setInvalid(true);
          return;
        }
        const result = await command.run(
          member ? `/admin/events/${member.event.id}` : "/admin/events",
          input,
          "EnvelopeEventMember",
          etag ?? null,
          member ? "PATCH" : "POST",
        );
        if (result) {
          setSaved(true);
          if (!member) navigate(`/account/events/${result.data.data.event.id}`, { replace: true });
          else onSaved?.();
        }
      }}
    >
      <fieldset className="event-form event-editor-fields" disabled={command.pending}>
        <p className="event-wide">{t("utcHelp")}</p>
        {(["title", "server", "organizer", "route", "meetingLocation", "description"] as const).map(
          (key) => (
            <div className={`event-field ${key === "description" ? "event-wide" : ""}`} key={key}>
              <Label htmlFor={`${id}-${key}`}>{t(key === "title" ? "eventTitle" : key)}</Label>
              {key === "description" ? (
                <textarea
                  className="input"
                  id={`${id}-${key}`}
                  maxLength={8000}
                  value={form[key]}
                  onChange={(e) => field(key, e.target.value)}
                />
              ) : (
                <Input
                  id={`${id}-${key}`}
                  required
                  maxLength={key === "route" || key === "meetingLocation" ? 2048 : 256}
                  value={form[key]}
                  onChange={(e) => field(key, e.target.value)}
                />
              )}
            </div>
          ),
        )}
        <div className="event-field">
          <Label htmlFor={`${id}-game`}>{t("game")}</Label>
          <select
            id={`${id}-game`}
            className="input"
            value={form.game}
            onChange={(e) => {
              setSaved(false);
              setForm((v) => ({
                ...v,
                game: e.target.value as "ets2" | "ats",
                originCityId: null,
                destinationCityId: null,
                prescribedCargoId: null,
                prescribedTrailerTypeId: null,
              }));
            }}
          >
            <option value="ets2">ETS2</option>
            <option value="ats">ATS</option>
          </select>
        </div>
        <div className="event-field">
          <Label htmlFor={`${id}-visibility`}>{t("visibility")}</Label>
          <select
            id={`${id}-visibility`}
            className="input"
            value={form.visibility}
            onChange={(e) => field("visibility", e.target.value)}
          >
            {["public", "members"].map((v) => (
              <option value={v} key={v}>
                {t(v)}
              </option>
            ))}
          </select>
        </div>
        {(["meetingAt", "startsAt", "endsAt"] as const).map((key) => (
          <div className="event-field" key={key}>
            <Label htmlFor={`${id}-${key}`}>
              {t(key)} (UTC){key === "endsAt" ? ` · ${t("optional")}` : ""}
            </Label>
            <Input
              id={`${id}-${key}`}
              type="datetime-local"
              step="0.001"
              required={key !== "endsAt"}
              value={times[key]}
              onChange={(e) => {
                setSaved(false);
                setTimes((v) => ({ ...v, [key]: e.target.value }));
              }}
            />
            {utcInput(times[key]) && (
              <small>
                {t("timePreview")}:{" "}
                {eventTime(utcInput(times[key]) as string, i18n.resolvedLanguage ?? "en", timezone)}
              </small>
            )}
          </div>
        ))}
        <div className="event-field">
          <Label htmlFor={`${id}-mass`}>
            {t("prescribedMassKg")} · {t("optional")}
          </Label>
          <Input
            id={`${id}-mass`}
            inputMode="decimal"
            value={form.prescribedMassKg ?? ""}
            onChange={(e) => field("prescribedMassKg", e.target.value || null)}
          />
        </div>
        <fieldset className="stack">
          <legend>
            {t("catalogSelections")} · {t("optional")}
          </legend>
          {catalogFields.map((key) => (
            <div className="stack" key={key}>
              {form[key] && (
                <p>
                  {t(key)} · {t("retained")}: <span>{form[key]}</span>{" "}
                  <Button type="button" variant="ghost" onClick={() => field(key, null)}>
                    {t("clear")}
                  </Button>
                </p>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            aria-expanded={catalogOpen}
            onClick={() => setCatalogOpen(!catalogOpen)}
          >
            {t(catalogOpen ? "hideCatalog" : "chooseCatalog")}
          </Button>
          {catalogOpen && <EventCatalogFields key={form.game} form={form} onChange={field} />}
        </fieldset>
        <div className="event-wide stack">
          {invalid && (
            <p role="alert" className="field-error">
              {t("invalid")}
            </p>
          )}
          <EventFailureView error={command.failure} seconds={command.seconds} />
          {saved && <p role="status">{t("saved")}</p>}
          <Button
            type="submit"
            disabled={command.pending || command.seconds > 0 || (!!member && !etag)}
          >
            {t(command.pending ? "loading" : member ? "save" : "create")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
function EventCatalogFields({
  form,
  onChange,
}: {
  form: DTO["EventInput"];
  onChange: (key: keyof DTO["EventInput"], value: string | null) => void;
}) {
  const { t } = useTranslation("events"),
    revisions = usePublishedRevisions(form.game),
    revision = revisions.data?.pages
      .flatMap((p) => p.data.data.items)
      .find((r) => r.state === "published")?.id;
  return revisions.isPending ? (
    <p role="status">{t("loadingCatalog")}</p>
  ) : !revision ? (
    <div className="stack">
      <p>{t("catalogUnavailable")}</p>
      {revisions.isError && (
        <Button type="button" variant="outline" onClick={() => void revisions.refetch()}>
          {t("retry")}
        </Button>
      )}
    </div>
  ) : (
    <div className="stack">
      {(
        [
          "originCityId",
          "destinationCityId",
          "prescribedCargoId",
          "prescribedTrailerTypeId",
        ] as const
      ).map((key) => (
        <CatalogSelector
          key={key}
          label={t(key)}
          game={form.game}
          revisionId={revision}
          kind={
            key === "prescribedCargoId"
              ? "cargo"
              : key === "prescribedTrailerTypeId"
                ? "trailer_type"
                : "city"
          }
          value={form[key] ? { entityId: form[key], revisionId: revision } : null}
          onChange={(v) => onChange(key, v?.entityId ?? null)}
        />
      ))}
    </div>
  );
}
