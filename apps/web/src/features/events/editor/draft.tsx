import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../../app/Session.js";
import { Button, Input, Label } from "../../../shared/ui/primitives.js";
import { AccountFailure } from "../../account/transport.js";
import { EventFailureView } from "../components.js";
import type { DTO } from "../model.js";
import { useEventStage2Query } from "../stage-2-queries.js";
import { eventStage2Commands, eventStage2Reads } from "../stage-2-transport.js";
import { eventEditorAccessLost, useEditorCommands } from "./commands.js";

export type DraftFields = DTO["EventStage2DraftInput"];
export type OpenEventDraft = { kind: "draft"; id: string; etag: string; fields: DraftFields };

const en = {
  heading: "Edit event draft",
  save: "Save draft",
  saving: "Saving draft…",
  saved: "Draft saved.",
  invalidId: "This draft link is invalid.",
  unavailable: "Event drafts are unavailable.",
  revisionMissing: "The saved draft version is unavailable.",
  conflict: "The saved draft changed. Your edits are still here.",
  refresh: "Check latest draft",
  latest: "Latest saved title",
  latestDescription: "Latest saved description",
  noDescription: "No saved description",
  untitled: "Untitled draft",
  keep: "Keep my edits",
  load: "Load saved fields",
  retry: "Retry the same request",
};
const ru: Record<keyof typeof en, string> = {
  heading: "Редактирование черновика события",
  save: "Сохранить черновик",
  saving: "Сохранение черновика…",
  saved: "Черновик сохранён.",
  invalidId: "Ссылка на черновик недействительна.",
  unavailable: "Черновики событий недоступны.",
  revisionMissing: "Сохранённая версия черновика недоступна.",
  conflict: "Сохранённый черновик изменился. Ваши правки остались в редакторе.",
  refresh: "Проверить последний черновик",
  latest: "Последнее сохранённое название",
  latestDescription: "Последнее сохранённое описание",
  noDescription: "Описание отсутствует",
  untitled: "Черновик без названия",
  keep: "Сохранить мои правки",
  load: "Загрузить сохранённые поля",
  retry: "Повторить тот же запрос",
};
export function useDraftText() {
  const { i18n } = useTranslation("events");
  return i18n.resolvedLanguage === "en" ? en : ru;
}

export function eventRevisionTag(etag: string | null | undefined) {
  return etag && /^"v[1-9][0-9]*"$/.test(etag) ? etag : null;
}

export function EditorAccess({ children }: { children: (scope: string) => ReactNode }) {
  const session = useSession();
  const { t } = useTranslation("events");
  if (session.state === "checking") return <p role="status">{t("loading")}</p>;
  if (session.state === "unavailable")
    return <EventFailureView error={new AccountFailure("unavailable")} />;
  if (!session.self?.capabilities.includes("events.manage")) {
    return (
      <EventFailureView
        error={new AccountFailure(session.state === "anonymous" ? "unauthorized" : "forbidden")}
      />
    );
  }
  const scope = JSON.stringify([
    session.self.member.id,
    session.generation,
    session.self.identityEpoch,
  ]);
  return children(scope);
}

function openedDraft(
  id: string,
  response?: { data: DTO["EventStage2EnvelopeDraft"]; etag: string | null },
) {
  const etag = eventRevisionTag(response?.etag);
  const draft = response?.data.data;
  return etag && draft?.id === id
    ? ({ kind: "draft", id, fields: draft.fields, etag } as const)
    : null;
}

export function EventDraftRead({
  id,
  observeAfterOpening = true,
  children,
}: {
  id: string;
  observeAfterOpening?: boolean;
  children: (draft: OpenEventDraft, refresh: () => Promise<OpenEventDraft>) => ReactNode;
}) {
  const { t } = useTranslation("events");
  const text = useDraftText();
  const [opened, setOpened] = useState<OpenEventDraft | null>(null);
  const query = useEventStage2Query(eventStage2Reads.draft(id), !opened || observeAfterOpening);
  const response = query.data;
  const accessLost = eventEditorAccessLost(query.error);

  // Initialize the editable form once. Background reads must never replace its unsaved values.
  useEffect(() => {
    if (accessLost) {
      setOpened(null);
      return;
    }
    const saved = openedDraft(id, response);
    if (saved) setOpened((previous) => previous ?? saved);
  }, [id, response, accessLost]);

  if (accessLost) return <EventFailureView error={query.error} />;
  if (opened)
    return children(opened, async () => {
      const result = await query.refetch();
      if (result.isError) throw result.error;
      const latest = openedDraft(id, result.data);
      if (!latest) throw new AccountFailure("unavailable");
      return latest;
    });
  if (query.isPending || query.isFetching || openedDraft(id, response)) {
    return <p role="status">{t("loading")}</p>;
  }
  return (
    <div className="stack">
      {query.error ? (
        <EventFailureView error={query.error} />
      ) : (
        <p role="alert" className="field-error">
          {text.revisionMissing}
        </p>
      )}
      <Button type="button" variant="outline" onClick={() => void query.refetch()}>
        {t("retry")}
      </Button>
    </div>
  );
}

/** The direct draft entry supports definition edits while the full editor is being integrated. */
export function DraftEventEditor({ id }: { id: string }) {
  return (
    <EditorAccess>
      {(scope) => (
        <EventDraftRead key={JSON.stringify([scope, id])} id={id}>
          {(draft, refresh) => <DraftFieldsEditor draft={draft} refresh={refresh} />}
        </EventDraftRead>
      )}
    </EditorAccess>
  );
}

function DraftFieldsEditor({
  draft,
  refresh,
}: {
  draft: OpenEventDraft;
  refresh: () => Promise<OpenEventDraft>;
}) {
  const { t } = useTranslation("events");
  const text = useDraftText();
  const id = useId();
  const commands = useEditorCommands<"EventStage2EnvelopeDraft">();
  const [saved, setSaved] = useState(draft);
  const [edits, setEdits] = useState<Pick<DraftFields, "title" | "description">>({});
  const [status, setStatus] = useState(false);
  const [latest, setLatest] = useState<OpenEventDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const conflict = commands.failure?.kind === "conflict";
  const locked = commands.pending || !!commands.retry || conflict;
  const title = edits.title === undefined ? saved.fields.title : edits.title;
  const description =
    edits.description === undefined ? saved.fields.description : edits.description;

  async function save() {
    if (locked || !Object.keys(edits).length) return;
    setStatus(false);
    await commands.run({
      request: eventStage2Commands.updateDraft(saved.id, { ...saved.fields, ...edits }, saved.etag),
      commit({ data: { data }, etag }) {
        if (data.id !== saved.id) throw new AccountFailure("uncertain");
        setSaved({ kind: "draft", id: data.id, fields: data.fields, etag });
        setEdits({});
        setStatus(true);
        return undefined;
      },
    });
  }

  async function checkLatest() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      setLatest(await refresh());
    } catch (error) {
      setRefreshError(error);
    } finally {
      setRefreshing(false);
    }
  }

  function acceptLatest(keep: boolean) {
    if (!latest) return;
    setSaved(latest);
    if (!keep) setEdits({});
    setLatest(null);
    commands.clearFailure();
  }

  const accessLost = [commands.failure, refreshError].find(eventEditorAccessLost);
  if (accessLost) return <EventFailureView error={accessLost} />;

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset className="event-editor-fields stack" disabled={locked}>
        <div className="event-field">
          <Label htmlFor={`${id}-title`}>{t("eventTitle")}</Label>
          <Input
            id={`${id}-title`}
            value={title ?? ""}
            maxLength={256}
            onChange={(event) => {
              const value = event.target.value;
              setEdits((previous) => ({ ...previous, title: value.trim() ? value : null }));
              setStatus(false);
            }}
          />
        </div>
        <div className="event-field">
          <Label htmlFor={`${id}-description`}>{t("description")}</Label>
          <textarea
            className="input"
            id={`${id}-description`}
            value={description ?? ""}
            maxLength={8000}
            onChange={(event) => {
              const value = event.target.value;
              setEdits((previous) => ({ ...previous, description: value.trim() ? value : null }));
              setStatus(false);
            }}
          />
        </div>
        <Button type="submit" disabled={!Object.keys(edits).length}>
          {text.save}
        </Button>
      </fieldset>
      {commands.pending && <p role="status">{text.saving}</p>}
      {status && <p role="status">{text.saved}</p>}
      {conflict ? (
        <div className="stack">
          <p className="field-error" role="alert">
            {text.conflict}
          </p>
          {latest ? (
            <>
              <dl className="event-facts">
                {edits.title !== undefined && (
                  <div>
                    <dt>{text.latest}</dt>
                    <dd>{latest.fields.title ?? text.untitled}</dd>
                  </div>
                )}
                {edits.description !== undefined && (
                  <div>
                    <dt>{text.latestDescription}</dt>
                    <dd className="event-description">
                      {latest.fields.description ?? text.noDescription}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="event-actions">
                <Button type="button" variant="outline" onClick={() => acceptLatest(false)}>
                  {text.load}
                </Button>
                <Button type="button" variant="outline" onClick={() => acceptLatest(true)}>
                  {text.keep}
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={refreshing}
              onClick={() => void checkLatest()}
            >
              {text.refresh}
            </Button>
          )}
          <EventFailureView error={refreshError} />
        </div>
      ) : (
        <EventFailureView error={commands.failure} />
      )}
      {commands.retry && (
        <Button
          type="button"
          variant="outline"
          disabled={commands.coolingDown || commands.pending}
          onClick={() => void commands.retryRequest()}
        >
          {text.retry}
        </Button>
      )}
    </form>
  );
}
