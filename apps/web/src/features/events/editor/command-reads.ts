import { type EventStage2CommandReadFilter, landingConvoysQueryName } from "../stage-2-model.js";
import { eventStage2Content, eventStage2Reads } from "../stage-2-transport.js";

function isDraftList(key: readonly unknown[]) {
  return (
    key.at(-1) === "EventStage2EnvelopeAdminList" &&
    new URLSearchParams(String(key.at(-2)).split("?")[1]).get("period") === "drafts"
  );
}

function isPublishedList(key: readonly unknown[]) {
  const name = key.at(-1);
  return (
    name === "EventStage2EnvelopePublicList" ||
    name === "EventStage2EnvelopeMemberList" ||
    (name === "EventStage2EnvelopeAdminList" && !isDraftList(key)) ||
    (key[0] === "public-events" && key[2] === landingConvoysQueryName)
  );
}

const path = (value: unknown) => String(value).split("?")[0];

function isMemberDetail(key: readonly unknown[], eventId: string) {
  const read = eventStage2Reads.memberDetail(eventId);
  return key.at(-1) === read.schema && path(key.at(-2)) === path(read.path);
}

function isPublicDetail(key: readonly unknown[], eventId: string) {
  const read = eventStage2Reads.publicDetail(eventId);
  return (
    (key.at(-1) === read.schema || key.at(-1) === "compatible-public-detail") &&
    path(key.at(-2)) === path(read.path)
  );
}

function isDraft(key: readonly unknown[], eventId: string) {
  const read = eventStage2Reads.draft(eventId);
  return key.at(-1) === read.schema && key.at(-2) === read.path;
}

export function draftEditorReads(
  eventId: string | null,
  beforePublication: boolean,
): EventStage2CommandReadFilter {
  return (key, outcome) => {
    if (outcome === "conflict") return !!eventId && isDraft(key, eventId);
    return isDraftList(key) || (!beforePublication && !!eventId && isDraft(key, eventId));
  };
}

export function publishedEditorReads(
  eventId: string | null,
  mode: "new" | "draft" | "published",
  visibilityChanged = false,
): EventStage2CommandReadFilter {
  return (key, outcome) => {
    if (outcome === "conflict") {
      return !!eventId && (mode === "draft" ? isDraft(key, eventId) : isMemberDetail(key, eventId));
    }
    return (
      isPublishedList(key) ||
      key.at(-1) === "EventStage2EnvelopeUpcoming" ||
      (mode === "draft" && (isDraftList(key) || (!!eventId && isDraft(key, eventId)))) ||
      (!!eventId &&
        (isMemberDetail(key, eventId) ||
          isPublicDetail(key, eventId) ||
          (visibilityChanged &&
            key.at(-1) === "image" &&
            key.at(-2) === eventStage2Content.publicCover(eventId).path)))
    );
  };
}

export function isEditorMemberGalleryRead(key: readonly unknown[], eventId: string) {
  const read = eventStage2Reads.memberMedia(eventId);
  return key.at(-1) === read.schema && key.at(-2) === read.path;
}

export function editorGalleryReads(
  eventId: string,
  published: boolean,
  edit?: { coverChanged: boolean },
): EventStage2CommandReadFilter {
  const read = eventStage2Reads.adminMedia(eventId);
  return (key, outcome) => {
    if (outcome === "conflict") return key.at(-1) === read.schema && key.at(-2) === read.path;
    if (!published || !edit) return false;
    return (
      isEditorMemberGalleryRead(key, eventId) ||
      (edit.coverChanged &&
        (isPublishedList(key) ||
          isMemberDetail(key, eventId) ||
          isPublicDetail(key, eventId) ||
          (key.at(-1) === "image" && key.at(-2) === eventStage2Content.publicCover(eventId).path)))
    );
  };
}
