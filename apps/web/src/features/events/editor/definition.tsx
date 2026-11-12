import { useState } from "react";
import { Button } from "../../../shared/ui/primitives.js";
import { AccountFailure } from "../../account/transport.js";
import { EventFailureView } from "../components.js";
import type { DTO } from "../model.js";
import { useEventStage2Query } from "../stage-2-queries.js";
import { eventStage2Commands, eventStage2Reads } from "../stage-2-transport.js";
import { type EditorStep, eventEditorAccessLost, useEditorCommands } from "./commands.js";
import { type DraftFields, eventRevisionTag, type OpenEventDraft } from "./draft.js";
import { eventDefinitionSeed } from "./model.js";
import { useEditorText } from "./text.js";

type Published = { kind: "published"; member: DTO["EventStage2Member"]; etag: string | null };
export type EditorSource =
  | { kind: "new"; seed?: DraftFields | undefined }
  | { kind: "draft"; id: string }
  | Published;
export type EditorDefinition = Exclude<EditorSource, { kind: "draft" }> | OpenEventDraft;
type SavedDefinition = OpenEventDraft | Published;
type DefinitionEnvelope =
  | "EventStage2EnvelopeCreation"
  | "EventStage2EnvelopeDraft"
  | "EventStage2EnvelopeMember";
type DefinitionStep = EditorStep<DefinitionEnvelope>;
type Publication = (member: DTO["EventStage2Member"], etag: string) => void;

export function definitionFields(source: EditorDefinition): DraftFields | undefined {
  if (source.kind === "new") return source.seed;
  if (source.kind === "draft") return source.fields;
  const { meetingLocation, route } = source.member.event;
  return { ...eventDefinitionSeed(source.member), meetingLocation, route };
}

export function useDefinitionActions(source: EditorDefinition, onPublished?: Publication) {
  const { locale } = useEditorText();
  const writes = useEditorCommands<DefinitionEnvelope>();
  const [definition, setDefinition] = useState(source);
  const [latest, setLatest] = useState<SavedDefinition | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<unknown>(null);
  const [status, setStatus] = useState<"draftSaved" | "published" | "saved">();
  const eventId =
    definition.kind === "draft"
      ? definition.id
      : definition.kind === "published"
        ? definition.member.event.id
        : null;
  const draftRead = useEventStage2Query(eventStage2Reads.draft(eventId ?? ""), false);
  const publishedRead = useEventStage2Query(
    eventStage2Reads.memberDetail(eventId ?? "", locale),
    false,
  );
  const conflict = writes.failure?.kind === "conflict" && definition.kind !== "new";
  const missingRevision = definition.kind !== "new" && !eventRevisionTag(definition.etag);
  const accessFailure = [writes.failure, refreshFailure].find(eventEditorAccessLost);
  const locked =
    writes.pending ||
    !!writes.retry ||
    conflict ||
    refreshing ||
    missingRevision ||
    !!accessFailure;

  function draftStep(
    fields: DraftFields,
    then?: (value: OpenEventDraft) => DefinitionStep | undefined,
  ): DefinitionStep {
    const request =
      definition.kind === "draft"
        ? eventStage2Commands.updateDraft(definition.id, fields, definition.etag)
        : eventStage2Commands.create({ ...fields, draft: true }, locale);
    return {
      request,
      commit({ data: { data }, etag }) {
        if (!("lifecycle" in data) || (definition.kind === "draft" && data.id !== definition.id)) {
          throw new AccountFailure("uncertain");
        }
        const saved = { kind: "draft", id: data.id, etag, fields: data.fields } as const;
        setDefinition(saved);
        setStatus("draftSaved");
        return then?.(saved);
      },
    };
  }

  async function saveDraft(fields: DraftFields) {
    if (locked || definition.kind === "published") return null;
    let savedId: string | null = null;
    setStatus(undefined);
    await writes.run(
      draftStep(fields, ({ id }) => {
        savedId = id;
        return undefined;
      }),
    );
    return savedId;
  }

  async function publish(fields: DTO["EventStage2Input"]) {
    if (locked) return;
    setStatus(undefined);
    const mode = definition.kind;
    const finish: DefinitionStep["commit"] = ({ data: { data }, etag }) => {
      if (!("event" in data) || (eventId && data.event.id !== eventId))
        throw new AccountFailure("uncertain");
      setDefinition({ kind: "published", member: data, etag });
      setStatus(mode === "published" ? "saved" : "published");
      onPublished?.(data, etag);
      return undefined;
    };
    if (definition.kind === "draft") {
      await writes.run(
        draftStep(fields, ({ id, etag }) => ({
          request: eventStage2Commands.publishDraft(id, etag, locale),
          commit: finish,
        })),
      );
    } else if (definition.kind === "published") {
      if (!definition.etag) return;
      await writes.run({
        request: eventStage2Commands.updatePublished(
          definition.member.event.id,
          fields,
          definition.etag,
          locale,
        ),
        commit: finish,
      });
    } else {
      await writes.run({ request: eventStage2Commands.create(fields, locale), commit: finish });
    }
  }

  async function refresh() {
    if (!eventId || refreshing) return;
    setRefreshing(true);
    setRefreshFailure(null);
    setLatest(null);
    try {
      if (definition.kind === "draft") {
        const result = await draftRead.refetch();
        const record = result.data?.data.data;
        const etag = eventRevisionTag(result.data?.etag);
        if (result.isError) throw result.error;
        if (!etag || record?.id !== eventId) throw new AccountFailure("unavailable");
        setLatest({ kind: "draft", id: eventId, etag, fields: record.fields });
      } else {
        const result = await publishedRead.refetch();
        const member = result.data?.data.data;
        const etag = eventRevisionTag(result.data?.etag);
        if (result.isError) throw result.error;
        if (!etag || member?.event.id !== eventId) throw new AccountFailure("unavailable");
        setLatest({ kind: "published", member, etag });
      }
    } catch (failure) {
      setRefreshFailure(failure);
    } finally {
      setRefreshing(false);
    }
  }

  function acceptLatest() {
    if (!latest) return;
    setDefinition(latest);
    setLatest(null);
    setStatus(undefined);
    writes.clearFailure();
  }

  return {
    definition,
    eventId,
    accessFailure,
    locked,
    conflict,
    missingRevision,
    pending: writes.pending,
    status,
    latest,
    refreshing,
    refreshFailure,
    refresh,
    acceptLatest,
    saveDraft,
    publish,
    failure: writes.failure,
    retry: writes.retry,
    retryRequest: writes.retryRequest,
    coolingDown: writes.coolingDown,
    clearStatus: () => setStatus(undefined),
  };
}

export function DefinitionFeedback({
  actions,
  blocked,
  onLoadLatest,
}: {
  actions: ReturnType<typeof useDefinitionActions>;
  blocked?: boolean | undefined;
  onLoadLatest: (source: SavedDefinition) => void;
}) {
  const { text } = useEditorText();
  const { latest } = actions;
  return (
    <>
      {actions.pending && <p role="status">{text.saving}</p>}
      {actions.status && <p role="status">{text[actions.status]}</p>}
      {actions.conflict || actions.missingRevision ? (
        <div className="stack">
          <p role="alert" className="field-error">
            {actions.conflict ? text.draftConflict : text.revisionMissing}
          </p>
          {actions.eventId && !latest && (
            <Button
              type="button"
              variant="outline"
              disabled={blocked || actions.refreshing}
              onClick={() => void actions.refresh()}
            >
              {text.refresh}
            </Button>
          )}
          {actions.refreshing && <p role="status">{text.loading}</p>}
          <EventFailureView error={actions.refreshFailure} />
          {latest && (
            <>
              <p>
                {text.latest} · {definitionFields(latest)?.title || text.untitled}
              </p>
              <div className="event-editor-inline">
                <Button
                  type="button"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => {
                    onLoadLatest(latest);
                    actions.acceptLatest();
                  }}
                >
                  {text.useSaved}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={blocked}
                  onClick={actions.acceptLatest}
                >
                  {text.keepEdits}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <EventFailureView error={actions.failure} />
      )}
      {actions.retry && (
        <Button
          type="button"
          variant="outline"
          disabled={blocked || actions.pending || actions.coolingDown}
          onClick={() => void actions.retryRequest()}
        >
          {text.retryAttempt}
        </Button>
      )}
    </>
  );
}
