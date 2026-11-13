import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../../app/Session.js";
import { Button } from "../../../shared/ui/primitives.js";
import { AccountFailure } from "../../account/transport.js";
import { EventFailureView } from "../components.js";
import type { DTO } from "../model.js";
import { useEventStage2Query } from "../stage-2-queries.js";
import { eventStage2Reads } from "../stage-2-transport.js";
import { eventEditorAccessLost } from "./commands.js";

export type DraftFields = DTO["EventStage2DraftInput"];
export type OpenEventDraft = { kind: "draft"; id: string; etag: string; fields: DraftFields };

const en = {
  heading: "Edit event draft",
  invalidId: "This draft link is invalid.",
  unavailable: "Event drafts are unavailable.",
  revisionMissing: "The saved draft version is unavailable.",
};
const ru: Record<keyof typeof en, string> = {
  heading: "Редактирование черновика события",
  invalidId: "Ссылка на черновик недействительна.",
  unavailable: "Черновики событий недоступны.",
  revisionMissing: "Сохранённая версия черновика недоступна.",
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
  children: (draft: OpenEventDraft) => ReactNode;
}) {
  const { t } = useTranslation("events");
  const text = useDraftText();
  const [opened, setOpened] = useState<OpenEventDraft | null>(null);
  const query = useEventStage2Query(eventStage2Reads.draft(id), !opened || observeAfterOpening);
  const response = query.data;
  const accessLost = (!opened || observeAfterOpening) && eventEditorAccessLost(query.error);

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
  if (opened) return children(opened);
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
