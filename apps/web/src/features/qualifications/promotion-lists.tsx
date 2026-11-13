// biome-ignore-all lint/a11y/noRedundantRoles: explicit table roles survive the stacked layout in WebKit.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Button, Input, Label, Select, Table } from "../../shared/ui/primitives.js";
import { Failure, PageNav } from "./components.js";
import { usePromotionMemberSearch } from "./promotion-queries.js";
import type { Candidate } from "./promotion-transport.js";
import { type DTO, QualificationFailure } from "./transport.js";

type HistoryItem = DTO["QualificationStage3CompanyAction"];

export function PromotionReadState({
  query,
  cursor,
  onFirstPage,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  cursor: string | null;
  onFirstPage: () => void;
}) {
  const { t } = useTranslation("promotions");
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  if (!query.isError) return null;
  if (query.error instanceof QualificationFailure && query.error.kind === "forbidden")
    return <p role="alert">{t("forbidden")}</p>;
  if (cursor && query.error instanceof QualificationFailure && query.error.kind === "conflict")
    return (
      <div className="stack">
        <p role="alert">{t("cursorConflict")}</p>
        <Button variant="outline" type="button" onClick={onFirstPage}>
          {t("firstPage")}
        </Button>
      </div>
    );
  return (
    <div className="stack">
      <Failure error={query.error} />
      <Button
        variant="outline"
        type="button"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t("refresh")}
      </Button>
    </div>
  );
}

export function usePromotionDisplay() {
  const { t, i18n } = useTranslation("promotions");
  const { self } = useSession();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const timezone = self?.preferences.displayTimezone ?? "UTC";
  const number = new Intl.NumberFormat(locale);
  return {
    trips: (actual: number, required: number | null) =>
      t("progress", {
        actual: number.format(actual),
        required: required === null ? t("noMinimum") : number.format(required),
      }),
    distance: (actual: string, required: string | null) =>
      t("progress", {
        actual: formatQuantity(actual, "km", locale),
        required: required === null ? t("noMinimum") : formatQuantity(required, "km", locale),
      }),
    time: (value: string) => <time dateTime={value}>{formatUtc(value, locale, timezone)}</time>,
  };
}

function PromotionCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <td role="cell">
      <span className="promotion-cell-label" aria-hidden="true">
        {label}
      </span>
      <div>{children}</div>
    </td>
  );
}

export function CandidateTable({
  items,
  onPromote,
  blocked,
}: {
  items: Candidate[];
  onPromote: (candidate: Candidate, trigger: HTMLButtonElement) => void;
  blocked: boolean;
}) {
  const { t } = useTranslation("promotions");
  const display = usePromotionDisplay();
  return (
    <Table
      className="promotion-table promotion-candidates"
      aria-label={t("candidates")}
      role="table"
    >
      <thead role="rowgroup">
        <tr role="row">
          {(
            ["driver", "game", "transition", "trips", "distance", "readySince", "action"] as const
          ).map((key) => (
            <th key={key} scope="col" role="columnheader">
              {t(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {items.map((candidate) => (
          <tr key={candidate.assignmentId} role="row">
            <th scope="row" role="rowheader">
              {candidate.member.nickname}
            </th>
            <PromotionCell label={t("game")}>{candidate.game.toUpperCase()}</PromotionCell>
            <PromotionCell label={t("transition")}>
              <div>{candidate.currentLevel.name}</div>
              <div className={candidate.nextLevel ? "promotion-next-level" : "promotion-muted"}>
                {candidate.nextLevel ? `→ ${candidate.nextLevel.name}` : t("terminal")}
              </div>
            </PromotionCell>
            <PromotionCell label={t("trips")}>
              {display.trips(candidate.acceptedTrips, candidate.requiredTrips)}
            </PromotionCell>
            <PromotionCell label={t("distance")}>
              {display.distance(candidate.actualDistanceM, candidate.requiredDistanceM)}
            </PromotionCell>
            <PromotionCell label={t("readySince")}>
              {candidate.eligibleSince
                ? display.time(candidate.eligibleSince)
                : candidate.eligible
                  ? t("unknown")
                  : "—"}
            </PromotionCell>
            <PromotionCell label={t("action")}>
              {candidate.eligible && candidate.nextLevel ? (
                <Button
                  type="button"
                  aria-disabled={blocked || undefined}
                  aria-label={t("promoteDriver", { nickname: candidate.member.nickname })}
                  onClick={(event) => onPromote(candidate, event.currentTarget)}
                >
                  {t("promote")}
                </Button>
              ) : (
                <span className="promotion-muted">{candidate.nextLevel ? t("notReady") : "—"}</span>
              )}
            </PromotionCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HistoryTable({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation("promotions");
  const display = usePromotionDisplay();
  return (
    <Table
      className="promotion-table promotion-history"
      aria-label={t("companyHistory")}
      role="table"
    >
      <thead role="rowgroup">
        <tr role="row">
          {(["driver", "game", "action", "date", "actor", "reason"] as const).map((key) => (
            <th key={key} scope="col" role="columnheader">
              {t(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {items.map((item) => (
          <tr key={`${item.kind}:${item.id}`} role="row">
            <th scope="row" role="rowheader">
              {item.member.nickname}
            </th>
            <PromotionCell label={t("game")}>{item.game.toUpperCase()}</PromotionCell>
            <PromotionCell label={t("action")}>
              <strong>{t(item.kind === "promotion" ? "promotion" : item.purpose)}</strong>
              <div>
                {item.kind === "promotion"
                  ? `${item.sourceLevel.name} → ${item.targetLevel.name}`
                  : item.level.name}
              </div>
            </PromotionCell>
            <PromotionCell label={t("date")}>
              {display.time(item.kind === "promotion" ? item.confirmedAt : item.assignedAt)}
            </PromotionCell>
            <PromotionCell label={t("actor")}>
              {item.actor?.nickname ?? item.actor?.id ?? t("unrecorded")}
            </PromotionCell>
            <PromotionCell label={t("reason")}>
              <div className="promotion-reason">{item.reason ?? t("unrecorded")}</div>
            </PromotionCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HistoryMemberFilter({
  memberId,
  memberLabel,
  onSelect,
}: {
  memberId: string | null;
  memberLabel: string | undefined;
  onSelect: (member: DTO["MemberSummary"] | null) => void;
}) {
  const { t } = useTranslation("promotions");
  const id = useId();
  const searchField = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const term = input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  return (
    <div className="promotion-member-filter stack">
      <div className="promotion-field">
        <Label htmlFor={id}>{t("search")}</Label>
        <Input
          ref={searchField}
          id={id}
          type="search"
          maxLength={128}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
      {memberId && (
        <div className="promotion-selected">
          <span>{memberLabel ?? memberId}</span>
          <Button type="button" variant="outline" onClick={() => onSelect(null)}>
            {t("allMembers")}
          </Button>
        </div>
      )}
      {term && search === term && (
        <HistoryMemberResults
          key={search}
          search={search}
          memberId={memberId}
          onSelect={(member) => {
            setInput("");
            searchField.current?.focus();
            onSelect(member);
          }}
        />
      )}
    </div>
  );
}

function HistoryMemberResults({
  search,
  memberId,
  onSelect,
}: {
  search: string;
  memberId: string | null;
  onSelect: (member: DTO["MemberSummary"]) => void;
}) {
  const { t } = useTranslation("promotions");
  const id = useId();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1) ?? null;
  const query = usePromotionMemberSearch(search, cursor);
  const data = query.data?.data.data;
  const items = data?.items ?? [];
  return (
    <>
      <PromotionReadState query={query} cursor={cursor} onFirstPage={() => setCursors([])} />
      {data && items.length === 0 && <p role="status">{t("emptySearch")}</p>}
      {items.length > 0 && (
        <div className="promotion-field">
          <Label htmlFor={id}>{t("chooseMember")}</Label>
          <Select
            id={id}
            value={items.some((member) => member.id === memberId) ? (memberId ?? "") : ""}
            onChange={(event) => {
              const member = items.find((item) => item.id === event.target.value);
              if (member) onSelect(member);
            }}
          >
            <option value="" disabled>
              {t("chooseMember")}
            </option>
            {items.map((member) => {
              const duplicate = items.some(
                (other) => other.id !== member.id && other.nickname === member.nickname,
              );
              const former = member.formerMember ? ` · ${t("former")}` : "";
              return (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                  {former}
                  {duplicate ? ` · ${member.id}` : ""}
                </option>
              );
            })}
          </Select>
        </div>
      )}
      {(cursor || data?.nextCursor) && (
        <PageNav
          hasPrevious={!!cursor}
          next={data?.nextCursor}
          onNext={(next) => setCursors((previous) => [...previous, next])}
          onPrevious={() => setCursors((previous) => previous.slice(0, -1))}
        />
      )}
    </>
  );
}
