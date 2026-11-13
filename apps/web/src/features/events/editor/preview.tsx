import { useId } from "react";
import { useEventTimezone } from "../components.js";
import { type DTO, utcInput } from "../model.js";
import { dateTile } from "../view-model.js";
import type { EditorDlc } from "./catalog.js";
import { shiftMass } from "./fields.js";
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
  const meeting = utcInput(form.meetingAt);
  const date = start && dateTile(start, locale, timezone);
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  const weekday =
    start &&
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: timezone }).format(
      new Date(start),
    );
  const platform =
    form.platform === "truckersmp" ? "TruckersMP" : form.platform === "haulmp" ? "HaulMP" : "";
  const timing = [
    meeting && `${text.meetingAt.toLowerCase()} ${clock.format(new Date(meeting))}`,
    start && `${text.startsAt.toLowerCase()} ${clock.format(new Date(start))}`,
  ]
    .filter(Boolean)
    .join(", ");
  const meta = [timing && `${timing} (${timezone})`, platform, form.server.trim()]
    .filter(Boolean)
    .join(" · ");
  const route = cityNames
    .map((name, index) =>
      [
        name ??
          (form[index === 0 ? "origin" : "destination"].cityId ? text.retainedCatalog : undefined),
        depotNames[index],
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean)
    .join(" → ");
  const mass = form.prescribedMassKg.trim();
  const load = [
    cargo ?? (form.prescribedCargoId ? text.retainedCatalog : undefined),
    mass && `${shiftMass(mass, -3)} ${text.tonnes}`,
  ]
    .filter(Boolean)
    .join(", ");
  const loadSummary = [
    load,
    trailer ?? (form.prescribedTrailerTypeId ? text.retainedCatalog : undefined),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <aside className="event-editor-preview" aria-labelledby={id}>
      <h2 id={id}>{text.preview}</h2>
      <article className="card event-editor-preview-card">
        {coverState !== null && (
          <div className="event-editor-preview-cover" data-cover={cover ? "image" : coverState}>
            {eventId && cover ? (
              <GalleryImage eventId={eventId} media={cover} />
            ) : (
              <span className={coverState === "empty" ? "visually-hidden" : undefined}>
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
          {date && (
            <time className="event-editor-date-tile" dateTime={start}>
              <span>{date.month.replace(/\.$/, "")}</span>
              <strong>{date.day}</strong>
              <small>{weekday}</small>
            </time>
          )}
          <div className="event-editor-preview-details">
            <div className="event-editor-inline">
              <h3>{form.title.trim() || text.untitled}</h3>
              {form.game && <span className="event-editor-tag">{form.game.toUpperCase()}</span>}
            </div>
            <p className="muted">{meta || text.noDate}</p>
            {route && <p>{route}</p>}
            {dlcs.length > 0 && (
              <ul className="event-editor-preview-dlcs">
                {dlcs.map(({ id, label }) => (
                  <li key={id} className="event-editor-tag">
                    {label ?? text.retainedCatalog}
                  </li>
                ))}
              </ul>
            )}
            {loadSummary && (
              <p>
                {text.prescribedCargoId}: {loadSummary}
              </p>
            )}
          </div>
        </div>
      </article>
    </aside>
  );
}
