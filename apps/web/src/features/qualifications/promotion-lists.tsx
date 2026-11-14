import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { useCursorPages } from "../../shared/paging.js";
import { DataTable } from "../../shared/ui/DataTable.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Input, Label, Select } from "../../shared/ui/primitives.js";
import { Failure } from "./components.js";
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

function DriverIdentity({ member }: { member: DTO["MemberSummary"] }) {
  return (
    <>
      {member.nickname}
      <code className="promotion-member-id" title={member.id}>
        {member.id.slice(-12)}
      </code>
    </>
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
    <DataTable
      caption={t("candidates")}
      className="promotion-table promotion-candidates"
      cardsBelow={800}
      rows={items}
      rowKey={(candidate) => candidate.assignmentId}
      columns={[
        {
          id: "driver",
          header: t("driver"),
          rowHeader: true,
          cardLabel: false,
          cell: ({ member }) => <DriverIdentity member={member} />,
        },
        { id: "game", header: t("game"), cell: ({ game }) => game.toUpperCase() },
        {
          id: "transition",
          header: t("transition"),
          cell: ({ currentLevel, nextLevel }) => (
            <>
              <div>{currentLevel.name}</div>
              <div className={nextLevel ? "promotion-next-level" : "promotion-muted"}>
                {nextLevel ? `→ ${nextLevel.name}` : t("terminal")}
              </div>
            </>
          ),
        },
        {
          id: "trips",
          header: t("trips"),
          cell: ({ acceptedTrips, requiredTrips }) => display.trips(acceptedTrips, requiredTrips),
        },
        {
          id: "distance",
          header: t("distance"),
          cell: ({ actualDistanceM, requiredDistanceM }) =>
            display.distance(actualDistanceM, requiredDistanceM),
        },
        {
          id: "readySince",
          header: t("readySince"),
          cell: ({ eligibleSince, eligible }) =>
            eligibleSince ? display.time(eligibleSince) : eligible ? t("unknown") : "—",
        },
        {
          id: "action",
          header: t("action"),
          cell: (candidate) =>
            candidate.eligible && candidate.nextLevel ? (
              <Button
                type="button"
                aria-disabled={blocked || undefined}
                aria-label={t("promoteDriver", { nickname: candidate.member.nickname })}
                aria-description={candidate.member.id}
                onClick={(event) => onPromote(candidate, event.currentTarget)}
              >
                {t("promote")}
              </Button>
            ) : (
              <span className="promotion-muted">{candidate.nextLevel ? t("notReady") : "—"}</span>
            ),
        },
      ]}
    />
  );
}

export function HistoryTable({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation("promotions");
  const display = usePromotionDisplay();
  return (
    <DataTable
      caption={t("companyHistory")}
      className="promotion-table promotion-history"
      cardsBelow={800}
      rows={items}
      rowKey={(item) => `${item.kind}:${item.id}`}
      columns={[
        {
          id: "driver",
          header: t("driver"),
          rowHeader: true,
          cardLabel: false,
          cell: ({ member }) => <DriverIdentity member={member} />,
        },
        { id: "game", header: t("game"), cell: ({ game }) => game.toUpperCase() },
        {
          id: "action",
          header: t("action"),
          cell: (item) => (
            <>
              <strong>{t(item.kind === "promotion" ? "promotion" : item.purpose)}</strong>
              <div>
                {item.kind === "promotion"
                  ? `${item.sourceLevel.name} → ${item.targetLevel.name}`
                  : item.level.name}
              </div>
            </>
          ),
        },
        {
          id: "date",
          header: t("date"),
          cell: (item) =>
            display.time(item.kind === "promotion" ? item.confirmedAt : item.assignedAt),
        },
        {
          id: "actor",
          header: t("actor"),
          cell: ({ actor }) => actor?.nickname ?? actor?.id ?? t("unrecorded"),
        },
        {
          id: "reason",
          header: t("reason"),
          cell: ({ reason }) => <div className="promotion-reason">{reason ?? t("unrecorded")}</div>,
        },
      ]}
    />
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
          <span>
            {memberLabel}
            <code className="promotion-member-id">{memberId}</code>
          </span>
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
  const pages = useCursorPages(search);
  const query = usePromotionMemberSearch(search, pages.cursor);
  const data = query.data?.data.data;
  const items = data?.items ?? [];
  return (
    <>
      <PromotionReadState query={query} cursor={pages.cursor} onFirstPage={pages.restart} />
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
              const former = member.formerMember ? ` · ${t("former")}` : "";
              return (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                  {former}
                  {` · ${member.id}`}
                </option>
              );
            })}
          </Select>
        </div>
      )}
      {!query.isError && (
        <Pager
          pages={pages}
          nextCursor={data?.nextCursor}
          busy={query.isPending}
          label={t("searchPages")}
        />
      )}
    </>
  );
}
