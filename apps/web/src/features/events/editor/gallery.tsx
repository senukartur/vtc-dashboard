import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "../../../app/Session.js";
import { Button, Input, Label } from "../../../shared/ui/primitives.js";
import { AccountFailure } from "../../account/transport.js";
import { useTripQuery } from "../../trips/queries.js";
import { EventFailureView } from "../components.js";
import type { DTO } from "../model.js";
import { useEventStage2Image, useEventStage2Query } from "../stage-2-queries.js";
import {
  eventStage2Commands,
  eventStage2Content,
  eventStage2Reads,
  readEventStage2,
} from "../stage-2-transport.js";
import { eventEditorAccessLost, useEditorCommands } from "./commands.js";
import { eventRevisionTag } from "./draft.js";
import { eventScreenshotAccept, eventScreenshotError, eventScreenshotLimit } from "./model.js";
import { useEditorText } from "./text.js";

type Gallery = DTO["EventStage2AdminMediaList"];
type GalleryItem = DTO["EventStage2AdminMediaItem"];
type Media = DTO["EventStage2Media"];
type MediaEdit = DTO["EventStage2MediaEditInput"];
type GalleryEnvelope = "EventStage2EnvelopeMediaUpload" | "EventStage2EnvelopeAdminMediaList";
type Snapshot = { eventId: string; gallery: Gallery; etag: string };

export function useEditorGallery(
  eventId: string | null,
  ensureDraft: () => Promise<string | null>,
) {
  const session = useSession();
  const readPolicy = !!session.self?.capabilities.includes("trips.submit_own");
  const policy = useTripQuery("/me/upload-policy", "EnvelopeUploadPolicy", readPolicy);
  const maxBytes = policy.data?.data.data.enabled ? policy.data.data.data.maxFileBytes : null;
  const policyPending = readPolicy && policy.isPending;
  const query = useEventStage2Query(eventStage2Reads.adminMedia(eventId ?? ""), !!eventId);
  const { refetch } = query;
  const writes = useEditorCommands<GalleryEnvelope>();
  const [committed, setCommitted] = useState<Snapshot | null>(null);
  const [captionEdits, setCaptionEdits] = useState<{
    eventId: string;
    values: Map<string, string>;
  } | null>(null);
  const { discardRetry, retry } = writes;
  const [file, setFile] = useState<File | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [prepareError, setPrepareError] = useState<unknown>(null);
  const [status, setStatus] = useState(false);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [operation, setOperation] = useState<"upload" | "edit">();
  const firstRead = useRef<AbortController | null>(null);
  const fetchedEtag = eventRevisionTag(query.data?.etag);
  const fetched =
    eventId && query.data && fetchedEtag
      ? { eventId, gallery: query.data.data.data, etag: fetchedEtag }
      : null;
  const received = committed?.eventId === eventId ? committed : null;
  const error = prepareError ?? writes.failure;
  const terminalRead = eventEditorAccessLost(query.error);
  const terminalWrite = eventEditorAccessLost(error);
  const terminal = terminalRead || terminalWrite;
  const failureKind = error instanceof AccountFailure ? error.kind : undefined;
  const accessLost =
    terminalRead ||
    failureKind === "forbidden" ||
    failureKind === "unauthorized" ||
    (terminalWrite && operation === "upload");
  const snapshot =
    query.isError || terminal
      ? null
      : fetched && (!received || fetched.gallery.version >= received.gallery.version)
        ? fetched
        : received;
  const items = snapshot?.gallery.items ?? [];
  const fileError = file ? eventScreenshotError(file, items.length, maxBytes) : undefined;
  const ready = items
    .flatMap(({ state, media }) => (state === "ready" && media ? [media] : []))
    .sort((first, second) => first.position - second.position);
  const processing = items.some(({ state }) => state === "processing");
  const cover = ready.find(({ isCover }) => isCover) ?? null;
  const busy = preparing || writes.pending;
  const conflict = failureKind === "conflict";
  const locked = busy || !!writes.retry || conflict || terminal;
  const captions = captionEdits?.eventId === eventId ? captionEdits.values : undefined;

  useEffect(() => {
    if (terminalRead && retry) discardRetry();
  }, [terminalRead, retry, discardRetry]);
  useEffect(() => {
    if (terminal) setCommitted((previous) => (previous?.eventId === eventId ? null : previous));
  }, [eventId, terminal]);
  useEffect(() => {
    setCaptionEdits((previous) =>
      previous && previous.eventId === eventId && !accessLost ? previous : null,
    );
  }, [eventId, accessLost]);

  useEffect(() => () => firstRead.current?.abort(), []);
  useEffect(() => {
    if (!processing || query.isError) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refetch({ cancelRefetch: false });
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [processing, query.isError, refetch]);

  function choose(value: File | null) {
    if (locked) return;
    setFile(value);
    setStatus(false);
    setPrepareError(null);
    writes.clearFailure();
  }

  async function upload() {
    if (!file || locked || firstRead.current || policyPending || (eventId && !snapshot)) return;
    if (fileError) return;
    setStatus(false);
    setPrepareError(null);
    setPreparing(true);
    setOperation("upload");
    setLastUpload(null);
    const controller = new AbortController();
    firstRead.current = controller;
    try {
      const target = eventId ?? (await ensureDraft());
      if (!target || controller.signal.aborted) return;
      const result =
        snapshot ??
        (await readEventStage2(eventStage2Reads.adminMedia(target), controller.signal).then(
          ({ data, etag }) => {
            const version = eventRevisionTag(etag);
            return version ? { eventId: target, gallery: data.data, etag: version } : null;
          },
        ));
      if (controller.signal.aborted) return;
      if (!result) throw new AccountFailure("conflict");
      const afterSave = eventScreenshotError(file, result.gallery.items.length, maxBytes);
      if (afterSave) {
        setCommitted(result);
        return;
      }
      setUploading(true);
      await writes.run({
        request: eventStage2Commands.upload(target, file, result.etag),
        commit({ data: { data }, etag }) {
          if (!("item" in data)) throw new AccountFailure("uncertain");
          setCommitted({
            eventId: target,
            etag,
            gallery: {
              version: data.version,
              items: [...result.gallery.items.filter(({ id }) => id !== data.item.id), data.item],
            },
          });
          setLastUpload(data.item.id);
          setFile(null);
          setFileVersion((previous) => previous + 1);
          return undefined;
        },
      });
    } catch (failure) {
      if (!controller.signal.aborted) setPrepareError(failure);
    } finally {
      setPreparing(false);
      setUploading(false);
      if (firstRead.current === controller) firstRead.current = null;
    }
  }

  function editCaption(mediaId: string, value: string) {
    if (!eventId || locked || !snapshot) return;
    setCaptionEdits((previous) => {
      const values = new Map(previous?.eventId === eventId ? previous.values : undefined);
      values.set(mediaId, value);
      return { eventId, values };
    });
  }

  function update(mediaId: string, value: MediaEdit | null, onSaved?: () => void) {
    if (locked || !snapshot || !eventId) return;
    setStatus(false);
    setOperation("edit");
    setLastUpload(null);
    setPrepareError(null);
    return writes.run({
      request: value
        ? eventStage2Commands.updateMedia(eventId, mediaId, value, snapshot.etag)
        : eventStage2Commands.deleteMedia(eventId, mediaId, snapshot.etag),
      commit({ data: { data }, etag }) {
        if (!("items" in data)) throw new AccountFailure("uncertain");
        setCommitted({ eventId, gallery: data, etag });
        if (value === null || value.caption !== undefined) {
          setCaptionEdits((previous) => {
            if (previous?.eventId !== eventId || !previous.values.has(mediaId)) return previous;
            const values = new Map(previous.values);
            values.delete(mediaId);
            return { eventId, values };
          });
        }
        setStatus(true);
        onSaved?.();
        return undefined;
      },
    });
  }

  async function refresh() {
    if (!eventId) return;
    const fresh = await refetch({ cancelRefetch: false });
    if (!fresh.isError && eventRevisionTag(fresh.data?.etag)) {
      if (terminal) {
        setCommitted(null);
        discardRetry();
      }
      setPrepareError(null);
      writes.clearFailure();
    }
  }

  return {
    file,
    fileError,
    fileVersion,
    maxBytes,
    policyPending,
    items,
    ready,
    captions,
    cover,
    busy,
    locked,
    uploading,
    lastUploadState: items.find(({ id }) => id === lastUpload)?.state,
    status,
    error,
    accessError: terminalRead ? query.error : terminalWrite ? error : null,
    conflict: conflict && !terminal,
    refreshing: query.isFetching,
    refusedUpload: operation === "upload" && failureKind === "invalid",
    loading: !!eventId && !snapshot && query.isPending && !terminal,
    readError: !!eventId && !snapshot && (terminal || !query.isPending),
    canUpload: !eventId || !!snapshot,
    retry: terminal ? null : writes.retry,
    coolingDown: writes.coolingDown,
    choose,
    upload,
    editCaption,
    update,
    refresh,
    retryRequest: async () => {
      setUploading(writes.retry?.request.schema === "EventStage2EnvelopeMediaUpload");
      try {
        await writes.retryRequest();
      } finally {
        setUploading(false);
      }
    },
  };
}

export function GalleryImage({ eventId, media }: { eventId: string; media: Media }) {
  const { text } = useEditorText();
  const image = useEventStage2Image(eventStage2Content.member(eventId, media.id, "thumb"));
  const blob = image.data;
  const [failedBlob, setFailedBlob] = useState<Blob | undefined>();
  const [object, setObject] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setObject({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (object && object.blob === blob && failedBlob !== blob) {
    return (
      <img
        src={object.url}
        alt={media.caption ?? text.screenshot}
        width={media.width}
        height={media.height}
        onError={() => setFailedBlob(blob)}
      />
    );
  }
  if (image.isError || (blob && failedBlob === blob))
    return (
      <div className="event-editor-image-note">
        <p className="muted">{text.imageUnavailable}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void image.refetch()}>
          {text.retry}
        </Button>
      </div>
    );
  return (
    <span className="muted" role="status">
      {text.galleryLoading}
    </span>
  );
}

function ReadyScreenshot({
  eventId,
  media,
  earlier,
  later,
  caption,
  onCaptionChange,
  update,
  onRemoved,
}: {
  eventId: string;
  media: Media;
  earlier: number | undefined;
  later: number | undefined;
  caption: string;
  onCaptionChange: (value: string) => void;
  update: ReturnType<typeof useEditorGallery>["update"];
  onRemoved: () => void;
}) {
  const { text } = useEditorText();
  const id = useId();
  const changed = caption.trim() !== (media.caption ?? "");
  const captionInput = useRef<HTMLInputElement>(null);

  function saveCaption() {
    if (changed) void update(media.id, { caption: caption.trim() || null });
  }

  function move(position: number) {
    void update(media.id, { position }, () =>
      requestAnimationFrame(() => captionInput.current?.focus()),
    );
  }
  return (
    <li className="event-editor-media-row">
      <div className="event-editor-gallery-thumb">
        <GalleryImage eventId={eventId} media={media} />
      </div>
      <div className="stack">
        <div className="event-editor-inline">
          <strong>
            {text.screenshot} {media.position + 1}
          </strong>
          {media.isCover && <span className="event-editor-tag">{text.cover}</span>}
        </div>
        <div className="event-editor-inline">
          <div className="event-editor-caption">
            <Label htmlFor={id}>
              {text.caption} · {text.screenshot} {media.position + 1}
            </Label>
            <Input
              id={id}
              ref={captionInput}
              maxLength={2048}
              value={caption}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  saveCaption();
                }
              }}
              onChange={(event) => onCaptionChange(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!changed}
            onClick={saveCaption}
          >
            {text.saveCaption}
          </Button>
        </div>
        <div className="event-editor-inline">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void update(media.id, { isCover: !media.isCover })}
          >
            {media.isCover ? text.clearCover : text.setCover}
          </Button>
          {earlier !== undefined && (
            <Button type="button" size="sm" variant="ghost" onClick={() => move(earlier)}>
              {text.moveEarlier}
            </Button>
          )}
          {later !== undefined && (
            <Button type="button" size="sm" variant="ghost" onClick={() => move(later)}>
              {text.moveLater}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void update(media.id, null, onRemoved)}
          >
            {text.delete}
          </Button>
        </div>
      </div>
    </li>
  );
}

function ProcessingScreenshot({ item, onRemove }: { item: GalleryItem; onRemove: () => void }) {
  const { text } = useEditorText();
  return (
    <li className="event-editor-inline">
      <p>{item.state === "processing" ? text.processing : text.rejected}</p>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
        {text.delete}
      </Button>
    </li>
  );
}

export function EditorGallery({
  eventId,
  gallery,
  disabled,
}: {
  eventId: string | null;
  gallery: ReturnType<typeof useEditorGallery>;
  disabled: boolean;
}) {
  const { text, locale } = useEditorText();
  const id = useId();
  const heading = useRef<HTMLLegendElement>(null);
  const full = gallery.items.length >= eventScreenshotLimit;
  const restoreFocus = () => requestAnimationFrame(() => heading.current?.focus());
  const helpId = `${id}-help`;
  return (
    <fieldset className="event-editor-section">
      <legend ref={heading} tabIndex={-1}>
        {text.screenshots}
      </legend>
      <p id={helpId} className="muted">
        {text.galleryHelp}{" "}
        {gallery.maxBytes && (
          <>
            {text.gallerySizeLabel} · {gallery.maxBytes.toLocaleString(locale)}.
          </>
        )}
      </p>
      {!eventId && <p className="muted">{text.galleryDraft}</p>}
      {gallery.loading && <p role="status">{text.galleryLoading}</p>}
      {gallery.readError && (
        <div className="event-editor-inline">
          {gallery.accessError ? (
            <EventFailureView error={gallery.accessError} />
          ) : (
            <p role="alert" className="field-error">
              {text.galleryUnavailable}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || gallery.busy || gallery.refreshing}
            onClick={() => void gallery.refresh()}
          >
            {text.retry}
          </Button>
        </div>
      )}
      {eventId && !gallery.loading && !gallery.readError && !gallery.items.length && (
        <p className="muted">{text.galleryEmpty}</p>
      )}
      <fieldset className="event-editor-gallery-controls" disabled={disabled || gallery.locked}>
        {eventId && gallery.items.length > 0 && (
          <ul className="event-editor-gallery-list">
            {gallery.ready.map((media, index) => (
              <ReadyScreenshot
                key={media.id}
                eventId={eventId}
                media={media}
                earlier={gallery.ready[index - 1]?.position}
                later={gallery.ready[index + 1]?.position}
                caption={gallery.captions?.get(media.id) ?? media.caption ?? ""}
                onCaptionChange={(value) => gallery.editCaption(media.id, value)}
                update={gallery.update}
                onRemoved={restoreFocus}
              />
            ))}
            {gallery.items
              .filter(({ state }) => state !== "ready")
              .map((item) => (
                <ProcessingScreenshot
                  key={item.id}
                  item={item}
                  onRemove={() => void gallery.update(item.id, null, restoreFocus)}
                />
              ))}
          </ul>
        )}
        <div className="event-editor-inline">
          <div className="event-editor-caption">
            <Label htmlFor={id}>{text.chooseFile}</Label>
            <Input
              key={gallery.fileVersion}
              id={id}
              type="file"
              accept={eventScreenshotAccept}
              aria-describedby={gallery.fileError || full ? `${helpId} ${id}-file-error` : helpId}
              aria-invalid={!!gallery.fileError}
              disabled={full}
              onChange={(event) => gallery.choose(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              !gallery.file ||
              !gallery.canUpload ||
              full ||
              !!gallery.fileError ||
              gallery.policyPending
            }
            onClick={() => void gallery.upload()}
          >
            {text.upload}
          </Button>
        </div>
      </fieldset>
      {(gallery.fileError || full) && (
        <p className="field-error" role="alert" id={`${id}-file-error`}>
          {text[gallery.fileError ?? "galleryFull"]}
        </p>
      )}
      <p
        role="status"
        className={gallery.uploading || gallery.status ? undefined : "visually-hidden"}
      >
        {gallery.uploading
          ? text.uploading
          : gallery.status
            ? text.gallerySaved
            : gallery.lastUploadState
              ? text[gallery.lastUploadState]
              : ""}
      </p>
      {gallery.conflict ? (
        <div className="event-editor-inline">
          <p className="field-error" role="alert">
            {text.galleryConflict}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || gallery.busy || gallery.refreshing}
            onClick={() => void gallery.refresh()}
          >
            {text.refresh}
          </Button>
        </div>
      ) : gallery.refusedUpload ? (
        <p className="field-error" role="alert">
          {text.galleryUploadInvalid}
        </p>
      ) : !gallery.accessError ? (
        <EventFailureView error={gallery.error} />
      ) : null}
      {gallery.retry && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled || gallery.busy || gallery.coolingDown}
          onClick={() => void gallery.retryRequest()}
        >
          {text.retryAttempt}
        </Button>
      )}
    </fieldset>
  );
}
