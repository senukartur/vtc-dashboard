import { useId } from "react";
import { useEventTimezone } from "../components.js";
import { type DTO, eventTime, utcInput } from "../model.js";
import type { EditorDlc } from "./catalog.js";
import { GalleryImage } from "./gallery.js";
import type { EditorForm } from "./model.js";
import { useEditorText } from "./text.js";

export function EditorPreview({
  form,
  cityNames,
  depotNames,
  dlcs,
  cargo,
  trailer,
  eventId,
  cover,
  coverState,
}: {
  form: EditorForm;
  cityNames: (string | undefined)[];
  depotNames: (string | undefined)[];
  dlcs: EditorDlc[];
  cargo: string | undefined;
  trailer: string | undefined;
  eventId: string | null;
  cover: DTO["EventStage2Media"] | null;
  coverState: "loading" | "unavailable" | "empty" | null;
}) {
  const id = useId();
  const { text, locale } = useEditorText();
  const timezone = useEventTimezone();
  const start = utcInput(form.startsAt);
  const date =
    start &&
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(start));
  const hasRoute =
    form.origin.cityId ||
    form.destination.cityId ||
    form.origin.depotId ||
    form.destination.depotId;
  const platform =
    form.platform === "truckersmp" ? "TruckersMP" : form.platform === "haulmp" ? "HaulMP" : "";
  return (
    <aside className="event-editor-preview" aria-labelledby={id}>
      <h2 id={id}>{text.preview}</h2>
      <article className="card event-editor-preview-card">
        {coverState !== null && (
          <div className="event-editor-preview-cover">
            {eventId && cover ? (
              <GalleryImage eventId={eventId} media={cover} />
            ) : (
              <span>
                {
                  text[
                    coverState === "loading"
                      ? "galleryLoading"
                      : coverState === "unavailable"
                        ? "imageUnavailable"
                        : "noCover"
                  ]
                }
              </span>
            )}
          </div>
        )}
        <div className="event-editor-preview-body">
          <header className="stack">
            <div className="event-editor-inline">
              {form.game && <span className="event-editor-tag">{form.game.toUpperCase()}</span>}
              {form.visibility && <span className="muted">{text[form.visibility]}</span>}
            </div>
            {start && date ? (
              <time dateTime={start} className="event-editor-date">
                {date}
              </time>
            ) : (
              <span className="muted">{text.noDate}</span>
            )}
            <h3>{form.title.trim() || text.untitled}</h3>
            {form.description.trim() && (
              <p className="event-editor-preview-description">{form.description.trim()}</p>
            )}
          </header>
          <dl className="event-editor-facts">
            {(["meetingAt", "startsAt", "endsAt"] as const).map((name) => {
              const instant = utcInput(form[name]);
              if (!instant && name === "endsAt") return null;
              return (
                <div key={name}>
                  <dt>{text[name]}</dt>
                  <dd>
                    {instant ? (
                      <time dateTime={instant}>{eventTime(instant, locale, timezone)}</time>
                    ) : (
                      text.noValue
                    )}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>{text.platform}</dt>
              <dd>{platform || text.noValue}</dd>
            </div>
            <div>
              <dt>{text.server}</dt>
              <dd>{form.server.trim() || text.noValue}</dd>
            </div>
          </dl>
          <section className="event-editor-preview-section">
            <h4>{text.route}</h4>
            {hasRoute ? (
              <dl className="event-editor-route-preview">
                {(["origin", "destination"] as const).map((end, index) => (
                  <div key={end}>
                    <dt>{text[end]}</dt>
                    <dd>
                      {cityNames[index] ?? (form[end].cityId ? text.retainedCatalog : text.noValue)}
                      {form[end].depotId && (
                        <small>{depotNames[index] ?? text.retainedDepot}</small>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">{text.noRoute}</p>
            )}
            {form.distanceKm.trim() && (
              <p>
                {form.distanceKm.trim()} {locale === "ru" ? "км" : "km"}
              </p>
            )}
          </section>
          <section className="event-editor-preview-section">
            <h4>{text.requiredDlcIds}</h4>
            {dlcs.length ? (
              <ul className="event-editor-preview-dlcs">
                {dlcs.map(({ id, label, code, sources }) => (
                  <li key={id}>
                    <span>{label ?? text.retainedCatalog}</span>
                    {code && <code>{code}</code>}
                    <small className="muted">
                      {sources
                        .map((source) => text[source === "manual" ? "manual" : "derived"])
                        .join(" · ")}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{text.noDlcs}</p>
            )}
          </section>
          <section className="event-editor-preview-section">
            <h4>{text.load}</h4>
            {form.prescribedCargoId ||
            form.prescribedTrailerTypeId ||
            form.prescribedMassKg.trim() ? (
              <dl className="event-editor-facts">
                {form.prescribedCargoId && (
                  <div>
                    <dt>{text.prescribedCargoId}</dt>
                    <dd>{cargo ?? text.retainedCatalog}</dd>
                  </div>
                )}
                {form.prescribedMassKg.trim() && (
                  <div>
                    <dt>{text.prescribedMassKg}</dt>
                    <dd>{form.prescribedMassKg.trim()}</dd>
                  </div>
                )}
                {form.prescribedTrailerTypeId && (
                  <div>
                    <dt>{text.prescribedTrailerTypeId}</dt>
                    <dd>{trailer ?? text.retainedCatalog}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="muted">{text.noLoad}</p>
            )}
          </section>
        </div>
      </article>
    </aside>
  );
}
