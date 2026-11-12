import type { ReactNode } from "react";
import { useState } from "react";
import { Button, Input, Label, Select } from "../../../shared/ui/primitives.js";
import { useMemberProfile, useMembersList } from "../../drivers/queries.js";
import type { DTO } from "../model.js";
import type { EditorErrors, EditorForm, FieldName } from "./model.js";
import { useEditorText } from "./text.js";

export function EditorField({
  base,
  name,
  error,
  children,
}: {
  base: string;
  name: FieldName;
  error: EditorErrors[FieldName];
  children: (id: string, errorId: string | undefined) => ReactNode;
}) {
  const { text } = useEditorText();
  const id = `${base}-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset
      className="event-editor-field"
      id={`${id}-field`}
      aria-label={text[name]}
      aria-describedby={errorId}
      tabIndex={-1}
    >
      {children(id, errorId)}
      {error && (
        <p className="field-error" id={errorId}>
          {text[error]}
        </p>
      )}
    </fieldset>
  );
}

export function focusEditorField(base: string, name: FieldName) {
  const group = document.getElementById(`${base}-${name}-field`);
  const control = group?.querySelector<HTMLElement>(
    "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
  );
  (control ?? group)?.focus();
}

type SetEditorField = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;

export function BasicsFields({
  base,
  form,
  errors,
  onChange,
  onGame,
}: {
  base: string;
  form: EditorForm;
  errors: EditorErrors;
  onChange: SetEditorField;
  onGame: (game: EditorForm["game"]) => void;
}) {
  const { text } = useEditorText();
  return (
    <fieldset className="event-editor-section">
      <legend>{text.basics}</legend>
      <div className="event-editor-grid">
        {(["title", "server"] as const).map((name) => (
          <EditorField key={name} base={base} name={name} error={errors[name]}>
            {(id, errorId) => (
              <>
                <Label htmlFor={id}>{text[name]}</Label>
                <Input
                  id={id}
                  value={form[name]}
                  maxLength={256}
                  aria-required="true"
                  aria-invalid={!!errorId}
                  aria-describedby={errorId}
                  onChange={(event) => onChange(name, event.target.value)}
                />
              </>
            )}
          </EditorField>
        ))}
        <EditorField base={base} name="game" error={errors.game}>
          {(id, errorId) => (
            <>
              <Label htmlFor={id}>{text.game}</Label>
              <Select
                id={id}
                value={form.game}
                aria-required="true"
                aria-invalid={!!errorId}
                aria-describedby={errorId}
                onChange={(event) => onGame(event.target.value as EditorForm["game"])}
              >
                <option value="">{text.choose}</option>
                <option value="ets2">ETS2</option>
                <option value="ats">ATS</option>
              </Select>
            </>
          )}
        </EditorField>
        <EditorField base={base} name="platform" error={errors.platform}>
          {(id, errorId) => (
            <>
              <Label htmlFor={id}>{text.platform}</Label>
              <Select
                id={id}
                value={form.platform}
                aria-required="true"
                aria-invalid={!!errorId}
                aria-describedby={errorId}
                onChange={(event) =>
                  onChange("platform", event.target.value as EditorForm["platform"])
                }
              >
                <option value="">{text.choose}</option>
                <option value="truckersmp">TruckersMP</option>
                <option value="haulmp">HaulMP</option>
              </Select>
            </>
          )}
        </EditorField>
        <EditorField base={base} name="visibility" error={errors.visibility}>
          {(id, errorId) => (
            <>
              <Label htmlFor={id}>{text.visibility}</Label>
              <Select
                id={id}
                value={form.visibility}
                aria-required="true"
                aria-invalid={!!errorId}
                aria-describedby={errorId}
                onChange={(event) =>
                  onChange("visibility", event.target.value as EditorForm["visibility"])
                }
              >
                <option value="">{text.choose}</option>
                <option value="members">{text.members}</option>
                <option value="public">{text.public}</option>
              </Select>
            </>
          )}
        </EditorField>
        <div className="event-editor-wide">
          <EditorField base={base} name="description" error={errors.description}>
            {(id, errorId) => (
              <>
                <Label htmlFor={id}>
                  {text.description} <span className="muted">· {text.optional}</span>
                </Label>
                <textarea
                  className="input"
                  id={id}
                  value={form.description}
                  maxLength={8000}
                  aria-invalid={!!errorId}
                  aria-describedby={errorId}
                  onChange={(event) => onChange("description", event.target.value)}
                />
              </>
            )}
          </EditorField>
        </div>
      </div>
    </fieldset>
  );
}

export function TimeFields({
  base,
  form,
  errors,
  onChange,
}: {
  base: string;
  form: EditorForm;
  errors: EditorErrors;
  onChange: SetEditorField;
}) {
  const { text } = useEditorText();
  const helpId = `${base}-utc`;
  return (
    <fieldset className="event-editor-section">
      <legend>{text.when}</legend>
      <p id={helpId} className="muted">
        {text.utcHelp}
      </p>
      <div className="event-editor-grid">
        {(["meetingAt", "startsAt", "endsAt"] as const).map((name) => (
          <EditorField key={name} base={base} name={name} error={errors[name]}>
            {(id, errorId) => (
              <>
                <Label htmlFor={id}>
                  {text[name]} (UTC)
                  {name === "endsAt" && <span className="muted"> · {text.optional}</span>}
                </Label>
                <Input
                  id={id}
                  type="datetime-local"
                  step="0.001"
                  value={form[name]}
                  aria-required={name !== "endsAt"}
                  aria-invalid={!!errorId}
                  aria-describedby={errorId ? `${helpId} ${errorId}` : helpId}
                  onChange={(event) => onChange(name, event.target.value)}
                />
              </>
            )}
          </EditorField>
        ))}
      </div>
    </fieldset>
  );
}

export function EditorDecimal({
  base,
  name,
  value,
  error,
  onChange,
}: {
  base: string;
  name: "distanceKm" | "prescribedMassKg";
  value: string;
  error: EditorErrors[FieldName];
  onChange: (value: string) => void;
}) {
  const { text } = useEditorText();
  return (
    <EditorField base={base} name={name} error={error}>
      {(id, errorId) => (
        <>
          <Label htmlFor={id}>
            {text[name]} <span className="muted">· {text.optional}</span>
          </Label>
          <Input
            id={id}
            value={value}
            inputMode="decimal"
            maxLength={64}
            aria-invalid={!!errorId}
            aria-describedby={errorId}
            onChange={(event) => onChange(event.target.value)}
          />
        </>
      )}
    </EditorField>
  );
}

export function OrganizerField({
  base,
  value,
  hint,
  legacyName,
  error,
  onChange,
}: {
  base: string;
  value: string | null;
  hint: string | undefined;
  legacyName: string | undefined;
  error: EditorErrors["organizerMemberId"];
  onChange: (value: DTO["MemberSummary"] | null) => void;
}) {
  const { text } = useEditorText();
  const [cursors, setCursors] = useState<string[]>([]);
  const query = useMembersList({ limit: 25, cursor: cursors.at(-1) });
  const profile = useMemberProfile(hint ? "" : (value ?? ""));
  const options = query.isError
    ? []
    : (query.data?.items.filter(({ formerMember }) => !formerMember) ?? []);
  const current = profile.isError ? undefined : profile.data?.member.nickname;
  const name = hint ?? current;
  return (
    <fieldset className="event-editor-section">
      <legend>{text.organizer}</legend>
      <EditorField base={base} name="organizerMemberId" error={error}>
        {(id, errorId) => (
          <>
            {value && (
              <div className="event-editor-inline">
                <span>
                  {text.organizerKept} · {name ?? text.organizerUnknown}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                  {text.clear}
                </Button>
              </div>
            )}
            {!value && legacyName && (
              <p className="muted">
                {text.legacyOrganizer} · {legacyName}
              </p>
            )}
            <Label htmlFor={id}>{text.organizerMemberId}</Label>
            <Select
              id={id}
              value=""
              aria-required="true"
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => {
                const selected = options.find(({ id }) => id === event.target.value);
                if (selected) onChange(selected);
              }}
            >
              <option value="">{text.choose}</option>
              {options
                .filter(({ id }) => id !== value)
                .map(({ id, nickname }) => (
                  <option key={id} value={id}>
                    {nickname}
                  </option>
                ))}
            </Select>
          </>
        )}
      </EditorField>
      {query.isPending && <p role="status">{text.organizerLoading}</p>}
      {query.isError && (
        <div className="event-editor-inline">
          <p role="alert" className="field-error">
            {text.organizerUnavailable}
          </p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {text.retry}
          </Button>
        </div>
      )}
      {query.isSuccess && options.length === 0 && <p className="muted">{text.organizerEmpty}</p>}
      <div className="event-editor-inline">
        {!!cursors.length && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            {text.previous}
          </Button>
        )}
        {query.data?.nextCursor && !query.isError && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const next = query.data.nextCursor;
              if (next) setCursors((previous) => [...previous, next]);
            }}
          >
            {text.next}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
