import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { EventState } from "./components.js";
import type { DTO } from "./model.js";
import { useEventStage2Image, useEventStage2Query } from "./stage-2-queries.js";
import { eventStage2Content, eventStage2Reads } from "./stage-2-transport.js";
import { EventFailure } from "./transport.js";

type Media = DTO["EventStage2Media"];

function useImageUrl(blob: Blob | undefined) {
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return blob && image?.blob === blob ? image.url : undefined;
}

function missing(error: unknown) {
  return error instanceof EventFailure && error.status === 404;
}

export function EventPublicCover({ id }: { id: string }) {
  const { t } = useTranslation("events");
  const cover = useEventStage2Image(eventStage2Content.publicCover(id));
  const url = useImageUrl(cover.data);
  if (missing(cover.error)) return null;
  return (
    <Card className="event-public-cover">
      {url ? <img src={url} alt={t("eventCover")} /> : <EventState query={cover} />}
    </Card>
  );
}

function Thumbnail({
  eventId,
  item,
  number,
  onSelect,
}: {
  eventId: string;
  item: Media;
  number: number;
  onSelect: (button: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation("events");
  const thumb = useEventStage2Image(eventStage2Content.member(eventId, item.id, "thumb"));
  const url = useImageUrl(thumb.data);
  const label = item.caption || t("imageNumber", { number });
  return (
    <li className={item.isCover ? "event-gallery-cover" : undefined}>
      <figure>
        <button
          type="button"
          className="event-gallery-thumbnail"
          aria-label={t("viewImage", { label })}
          onClick={(event) => onSelect(event.currentTarget)}
        >
          {url && <img src={url} alt="" />}
          {thumb.isError && <span>{t("thumbnailUnavailable")}</span>}
        </button>
        {item.caption && <figcaption>{item.caption}</figcaption>}
      </figure>
    </li>
  );
}

function FullImage({
  eventId,
  item,
  focusTarget,
}: {
  eventId: string;
  item: Media;
  focusTarget: () => void;
}) {
  const { t } = useTranslation("events");
  const image = useEventStage2Image(eventStage2Content.member(eventId, item.id, "full"));
  const url = useImageUrl(image.data);
  return (
    <div className="event-gallery-full">
      {url ? (
        <img src={url} alt={item.caption || t("galleryImage")} />
      ) : (
        <>
          <EventState query={image} focusTarget={focusTarget} />
          {image.isFetching && !image.isPending && <p role="status">{t("loadingImage")}</p>}
        </>
      )}
    </div>
  );
}

export function EventGallery({ id, enabled }: { id: string; enabled: boolean }) {
  const { t } = useTranslation("events");
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const query = useEventStage2Query(eventStage2Reads.memberMedia(id), enabled);
  const items = [...((enabled && query.data?.data.data.items) || [])].sort(
    (a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = items.findIndex((item) => item.id === selectedId);
  const selected = items[current];
  const move = (offset: number) => {
    const next = items[(current + offset + items.length) % items.length];
    if (next) setSelectedId(next.id);
  };

  return (
    <Card className="events-gallery" aria-labelledby={titleId}>
      <h2 id={titleId} ref={heading} tabIndex={-1}>
        {t("gallery")}
      </h2>
      {!enabled || missing(query.error) || (query.isSuccess && !items.length) ? (
        <p className="event-gallery-empty muted">{t("galleryEmpty")}</p>
      ) : (
        <EventState query={query} focusTarget={() => heading.current?.focus()} />
      )}
      {items.length > 0 && (
        <ul className="event-gallery-grid">
          {items.map((item, index) => (
            <Thumbnail
              key={item.id}
              eventId={id}
              item={item}
              number={index + 1}
              onSelect={(button) => {
                trigger.current = button;
                setSelectedId(item.id);
              }}
            />
          ))}
        </ul>
      )}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent
          className="event-gallery-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            close.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
            else heading.current?.focus();
          }}
          onKeyDown={(event) => {
            if (items.length < 2) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              move(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          {selected && (
            <>
              <div className="event-gallery-toolbar">
                <DialogTitle>
                  {t("imagePosition", { current: current + 1, total: items.length })}
                </DialogTitle>
                <DialogClose asChild>
                  <Button variant="outline" ref={close}>
                    {t("close")}
                  </Button>
                </DialogClose>
              </div>
              <DialogDescription
                aria-live="polite"
                className={selected.caption ? undefined : "visually-hidden"}
              >
                {selected.caption || t("galleryImage")}
              </DialogDescription>
              <FullImage
                eventId={id}
                item={selected}
                key={selected.id}
                focusTarget={() => close.current?.focus()}
              />
              {items.length > 1 && (
                <div className="event-gallery-toolbar">
                  <Button variant="outline" onClick={() => move(-1)}>
                    {t("previousImage")}
                  </Button>
                  <Button variant="outline" onClick={() => move(1)}>
                    {t("nextImage")}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
