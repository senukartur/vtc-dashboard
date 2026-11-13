import type { ReactNode } from "react";
import { useState } from "react";
import { Button, Input, Label, Select } from "../../../shared/ui/primitives.js";
import { SegmentedControl } from "../../../shared/ui/segmented-control.js";
import { useMemberProfile, useMembersList } from "../../drivers/queries.js";
import { type DTO, utcInput } from "../model.js";
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
  (
    control ??
    (name === "meetingAt" || name === "startsAt"
      ? document.getElementById(`${base}-date`)
      : null) ??
    group
  )?.focus();
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
      <div className="event-editor-grid event-editor-basics">
        <div className="event-editor-wide">
          <EditorField base={base} name="title" error={errors.title}>
            {(id, errorId) => (
              <>
                <Label htmlFor={id}>
                  {text.title}
                  <Required />
                </Label>
                <Input
                  id={id}
                  value={form.title}
                  placeholder={text.titleExample}
                  maxLength={256}
                  aria-required="true"
                  aria-invalid={!!errorId}
                  aria-describedby={errorId}
                  onChange={(event) => onChange("title", event.target.value)}
                />
              </>
            )}
          </EditorField>
        </div>
        <EditorChoice
          base={base}
          name="game"
          value={form.game}
          options={[
            { value: "ets2", label: "ETS2" },
            { value: "ats", label: "ATS" },
          ]}
          error={errors.game}
          onChange={onGame}
        />
        <EditorChoice
          base={base}
          name="visibility"
          value={form.visibility}
          options={[
            { value: "members", label: text.members },
            { value: "public", label: text.public },
          ]}
          error={errors.visibility}
          onChange={(value) => onChange("visibility", value)}
        >
          {form.visibility && (
            <p className="muted">
              {form.visibility === "members" ? text.membersHelp : text.publicHelp}
            </p>
          )}
        </EditorChoice>
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
                  placeholder={text.descriptionExample}
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

export function Required() {
  return (
    <span className="event-editor-required" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

function EditorChoice<T extends string>({
  base,
  name,
  value,
  options,
  error,
  onChange,
  children,
}: {
  base: string;
  name: "game" | "visibility" | "platform";
  value: T | "";
  options: readonly { value: T; label: string }[];
  error: EditorErrors[FieldName];
  onChange: (value: T) => void;
  children?: ReactNode;
}) {
  const { text } = useEditorText();
  return (
    <EditorField base={base} name={name} error={error}>
      {(id) => (
        <>
          <span id={id}>
            {text[name]}
            <Required />
          </span>
          <SegmentedControl<T | "">
            aria-labelledby={id}
            className={name === "visibility" ? "event-editor-visibility" : ""}
            value={value}
            options={options}
            onValueChange={(next) => {
              if (next) onChange(next);
            }}
          />
          {children}
        </>
      )}
    </EditorField>
  );
}

export function RouteBasics({
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
  return (
    <div className="event-editor-grid">
      <EditorChoice
        base={base}
        name="platform"
        value={form.platform}
        options={[
          { value: "truckersmp", label: "TruckersMP" },
          { value: "haulmp", label: "HaulMP" },
        ]}
        error={errors.platform}
        onChange={(value) => onChange("platform", value)}
      />
      <EditorField base={base} name="server" error={errors.server}>
        {(id, errorId) => (
          <>
            <Label htmlFor={id}>
              {text.server}
              <Required />
            </Label>
            <Input
              id={id}
              value={form.server}
              placeholder={
                form.platform === "truckersmp" && form.game === "ets2" ? "Simulation 1" : undefined
              }
              maxLength={256}
              aria-required="true"
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => onChange("server", event.target.value)}
            />
          </>
        )}
      </EditorField>
    </div>
  );
}

const scheduleFields = ["meetingAt", "startsAt", "endsAt"] as const;
const moscowOffsetMs = 3 * 60 * 60 * 1000;

function shiftWallTime(value: string, offset: number) {
  const iso = utcInput(value);
  if (!iso || !Number.isFinite(offset)) return "";
  const shifted = new Date(Date.parse(iso) + offset).toISOString().slice(0, -1);
  if (!utcInput(shifted)) return "";
  return shifted.replace(/:00\.000$/, "").replace(/\.000$/, "");
}

export function TimeFields({
  base,
  form,
  errors,
  onScheduleChange,
}: {
  base: string;
  form: EditorForm;
  errors: EditorErrors;
  onScheduleChange: (fields: Partial<Pick<EditorForm, (typeof scheduleFields)[number]>>) => void;
}) {
  const { text } = useEditorText();
  const helpId = `${base}-moscow`;
  const local = {
    meetingAt: shiftWallTime(form.meetingAt, moscowOffsetMs),
    startsAt: shiftWallTime(form.startsAt, moscowOffsetMs),
    endsAt: shiftWallTime(form.endsAt, moscowOffsetMs),
  };
  const inferred = (local.startsAt || local.meetingAt || local.endsAt).slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(!!form.endsAt);
  const [meetingDate, setMeetingDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const date = selectedDate ?? inferred;
  const separateMeetingDate =
    meetingDate !== null || Boolean(local.meetingAt && local.meetingAt.slice(0, 10) !== date);

  function changeDate(next: string) {
    setSelectedDate(next);
    const delta = Date.parse(next) - Date.parse(date);
    setMeetingDate(
      meetingDate ? shiftWallTime(`${meetingDate}T00:00`, delta).slice(0, 10) || null : null,
    );
    setEndDate(endDate ? shiftWallTime(`${endDate}T00:00`, delta).slice(0, 10) || null : null);
    const schedule = Object.fromEntries(
      scheduleFields.map((name) => [name, shiftWallTime(form[name], delta)]),
    );
    onScheduleChange(next && date ? schedule : { meetingAt: "", startsAt: "", endsAt: "" });
  }

  function clock(name: (typeof scheduleFields)[number]) {
    const override = name === "meetingAt" ? meetingDate : name === "endsAt" ? endDate : null;
    const localDate = override ?? (local[name].slice(0, 10) || date);
    const separateDate =
      name === "endsAt" ||
      (name === "meetingAt" && separateMeetingDate) ||
      (localDate && localDate !== date);
    return (
      <EditorField base={base} name={name} error={errors[name]}>
        {(id, errorId) => (
          <div className={separateDate ? "event-editor-clock-row" : undefined}>
            {separateDate && (
              <div className="event-editor-field">
                <Label htmlFor={`${id}-date`}>
                  {name === "meetingAt" ? text.meetingDate : text.date}
                </Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={localDate}
                  disabled={!date}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    if (name === "meetingAt") setMeetingDate(event.target.value);
                    if (name === "endsAt") setEndDate(event.target.value);
                    if (local[name])
                      onScheduleChange({
                        [name]: shiftWallTime(
                          `${event.target.value}T${local[name].slice(11)}`,
                          -moscowOffsetMs,
                        ),
                      });
                  }}
                />
              </div>
            )}
            <div className="event-editor-field">
              <Label htmlFor={id}>
                {text[name]}
                {name !== "endsAt" && <Required />}
              </Label>
              <Input
                id={id}
                type="time"
                step="any"
                value={local[name].slice(11)}
                disabled={!date}
                aria-required={name !== "endsAt"}
                aria-invalid={!!errorId}
                aria-describedby={errorId ? `${helpId} ${errorId}` : helpId}
                onChange={(event) =>
                  onScheduleChange({
                    [name]: shiftWallTime(`${localDate}T${event.target.value}`, -moscowOffsetMs),
                  })
                }
              />
            </div>
          </div>
        )}
      </EditorField>
    );
  }

  return (
    <fieldset className="event-editor-section">
      <legend>{text.when}</legend>
      <div className="event-editor-grid event-editor-schedule">
        <div className="event-editor-field">
          <Label htmlFor={`${base}-date`}>
            {text.date}
            <Required />
          </Label>
          <Input
            id={`${base}-date`}
            type="date"
            value={date}
            aria-required="true"
            aria-describedby={helpId}
            onChange={(event) => changeDate(event.target.value)}
          />
        </div>
        {clock("meetingAt")}
        {clock("startsAt")}
      </div>
      {showEnd && clock("endsAt")}
      <Button
        className="event-editor-disclosure"
        type="button"
        variant="ghost"
        size="sm"
        disabled={!date}
        aria-expanded={separateMeetingDate}
        onClick={() => {
          if (!separateMeetingDate) {
            setMeetingDate(date);
            return;
          }
          setMeetingDate(null);
          if (local.meetingAt)
            onScheduleChange({
              meetingAt: shiftWallTime(`${date}T${local.meetingAt.slice(11)}`, -moscowOffsetMs),
            });
        }}
      >
        {separateMeetingDate ? text.useStartDate : text.separateMeetingDate}
      </Button>
      <Button
        className="event-editor-disclosure"
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={showEnd}
        onClick={() => {
          setShowEnd(!showEnd);
          if (showEnd) {
            setEndDate(null);
            onScheduleChange({ endsAt: "" });
          }
        }}
      >
        {showEnd ? text.removeEnd : `+ ${text.addEnd}`}
      </Button>
      <p id={helpId} className="muted">
        {text.moscowHelp}
      </p>
    </fieldset>
  );
}

export function shiftMass(value: string, places: -3 | 3) {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(value.trim());
  if (!match) return value;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  const digits = whole + fraction;
  const point = whole.length + places;
  const integer = (point > 0 ? digits.slice(0, point).padEnd(point, "0") : "0").replace(
    /^0+(?=\d)/,
    "",
  );
  const decimals = (point < 0 ? "0".repeat(-point) + digits : digits.slice(point)).replace(
    /0+$/,
    "",
  );
  return decimals ? `${integer}.${decimals}` : integer;
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
  const tonnes = name === "prescribedMassKg";
  const [edit, setEdit] = useState<{ kilos: string; tonnes: string } | null>(null);
  const display = tonnes ? (edit?.kilos === value ? edit.tonnes : shiftMass(value, -3)) : value;

  return (
    <EditorField base={base} name={name} error={error}>
      {(id, errorId) => (
        <>
          <Label htmlFor={id}>
            {tonnes ? text.mass : text[name]}{" "}
            {!tonnes && <span className="muted">· {text.optional}</span>}
          </Label>
          <div className={tonnes ? "event-editor-unit" : undefined}>
            <Input
              id={id}
              value={display}
              inputMode="decimal"
              maxLength={64}
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => {
                const next = event.target.value;
                const kilos = tonnes ? shiftMass(next, 3) : next;
                if (tonnes) setEdit({ kilos, tonnes: next });
                onChange(kilos);
              }}
            />
            {tonnes && <span aria-hidden="true">{text.tonnes}</span>}
          </div>
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
  const member = profile.isError ? undefined : profile.data?.member;
  const current = member?.id === value ? member.nickname : undefined;
  const name = hint ?? current;
  return (
    <fieldset className="event-editor-section">
      <legend>{text.organization}</legend>
      <EditorField base={base} name="organizerMemberId" error={error}>
        {(id, errorId) => (
          <>
            {!value && legacyName && (
              <p className="muted">
                {text.legacyOrganizer} · {legacyName}
              </p>
            )}
            <Label htmlFor={id}>
              {text.organizerMemberId}
              <Required />
            </Label>
            <Select
              id={id}
              value={value ?? ""}
              aria-required="true"
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => {
                const selected = options.find(({ id }) => id === event.target.value);
                if (selected) onChange(selected);
                else if (!event.target.value) onChange(null);
              }}
            >
              <option value="">{text.choose}</option>
              {value && !options.some(({ id }) => id === value) && (
                <option value={value}>{name ?? text.organizerUnknown}</option>
              )}
              {options.map(({ id, nickname }) => (
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
