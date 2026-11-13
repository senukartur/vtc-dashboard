import { type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Card, Label, Select } from "../../shared/ui/primitives.js";
import { PageNav } from "./components.js";
import { PromotionConfirmation, type ReadyCandidate } from "./PromotionConfirmation.js";
import {
  CandidateTable,
  HistoryMemberFilter,
  HistoryTable,
  PromotionReadState,
} from "./promotion-lists.js";
import { usePromotionCandidates, usePromotionHistory } from "./promotion-queries.js";
import type { Candidate } from "./promotion-transport.js";
import { type DTO, type Game, schema } from "./transport.js";
import "./promotions.css";

const tabs = ["ready", "all", "history"] as const;
type Tab = (typeof tabs)[number];
type Filters = { tab: Tab; game: Game; memberId: string | null };
type Notice = { kind: "committed" | "conflict"; nickname: string; game: Game };
type Preview = { candidate: ReadyCandidate; initialReason: string };
type ListPage = { items: unknown[]; total: number; nextCursor: string | null };

function searchParams({ tab, game, memberId }: Filters, cursor: string | null = null) {
  const params = new URLSearchParams({ game, tab });
  if (tab === "history" && memberId) params.set("memberId", memberId);
  if (cursor) params.set("cursor", cursor);
  return params;
}

export function PromotionsPage() {
  const { self, generation } = useSession();
  const { t } = useTranslation("promotions");
  if (!self?.capabilities.includes("qualifications.manage"))
    return (
      <div className="promotion-workspace stack">
        <h1>{t("title")}</h1>
        <Card>
          <p>{t("forbidden")}</p>
        </Card>
      </div>
    );
  const scope = [generation, self.member.id, self.identityEpoch, self.capabilities.join(",")].join(
    ":",
  );
  return <PromotionsWorkspace key={scope} />;
}

function PromotionsWorkspace() {
  const { t, i18n } = useTranslation("promotions");
  const [params, setParams] = useSearchParams();
  const tabValue = params.get("tab");
  const tab: Tab = tabValue === "all" || tabValue === "history" ? tabValue : "ready";
  const game = params.get("game") === "ats" ? "ats" : "ets2";
  const member = schema("Id").safeParse(tab === "history" ? params.get("memberId") : null);
  const memberId = member.success ? member.data : null;
  const filters: Filters = { tab, game, memberId };
  const cursorValue = params.get("cursor");
  const cursor = cursorValue && cursorValue.length <= 2048 ? cursorValue : null;
  const [selection, setSelection] = useState<DTO["MemberSummary"] | null>(null);
  const previous = useRef(new Map<string, string | null>());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saved, setSaved] = useState<{ memberId: string; game: Game; reason: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const focusHeading = useRef(false);
  const candidates = usePromotionCandidates(
    game,
    tab === "all" ? "all" : "eligible",
    cursor,
    tab !== "history",
  );
  const history = usePromotionHistory(game, memberId, cursor, tab === "history");
  const query = tab === "history" ? history : candidates;
  const data: ListPage | undefined = query.data?.data.data;
  const total = data?.total;
  const pageKey = searchParams(filters).toString();

  function firstPage(replace = false) {
    if (cursor) setParams(searchParams(filters), { replace });
  }
  function chooseMember(member: DTO["MemberSummary"] | null) {
    setSelection(member);
    setParams(searchParams({ ...filters, memberId: member?.id ?? null }));
  }
  function promote(candidate: Candidate, button: HTMLButtonElement) {
    if (preview || !candidate.eligible || !candidate.nextLevel) return;
    trigger.current = button;
    focusHeading.current = false;
    setNotice(null);
    setPreview({
      candidate: { ...candidate, nextLevel: candidate.nextLevel },
      initialReason:
        saved?.memberId === candidate.member.id && saved.game === candidate.game
          ? saved.reason
          : "",
    });
  }
  function close(result?: { kind: "committed" | "conflict"; reason: string }) {
    if (preview && result) {
      const { candidate } = preview;
      focusHeading.current = true;
      setNotice({ kind: result.kind, nickname: candidate.member.nickname, game: candidate.game });
      setSaved(
        result.kind === "conflict"
          ? { memberId: candidate.member.id, game: candidate.game, reason: result.reason }
          : null,
      );
    }
    setPreview(null);
  }
  const number = new Intl.NumberFormat(i18n.resolvedLanguage === "en" ? "en" : "ru");
  const selectedLabel =
    selection?.id === memberId
      ? selection?.nickname
      : history.data?.data.data.items.find((item) => item.member.id === memberId)?.member.nickname;
  return (
    <div className="promotion-workspace stack">
      <header className="promotion-heading">
        <h1 ref={heading} tabIndex={-1}>
          {t("title")}
        </h1>
        {total !== undefined && (
          <span className="promotion-muted" role="status">
            {t(tab === "history" ? "historyCount" : "candidateCount", {
              count: total,
              total: number.format(total),
            })}
          </span>
        )}
      </header>
      <nav className="promotion-tabs" aria-label={t("tabs")}>
        {tabs.map((key) => (
          <Link
            key={key}
            aria-current={tab === key ? "page" : undefined}
            to={`?${searchParams({ ...filters, tab: key })}`}
          >
            {t(key)}
          </Link>
        ))}
      </nav>
      <div className="promotion-filters">
        <div className="promotion-field">
          <Label htmlFor="promotion-game">{t("game")}</Label>
          <Select
            id="promotion-game"
            value={game}
            onChange={(event) =>
              setParams(
                searchParams({ ...filters, game: event.target.value === "ats" ? "ats" : "ets2" }),
              )
            }
          >
            <option value="ets2">ETS2</option>
            <option value="ats">ATS</option>
          </Select>
        </div>
        {tab === "history" && (
          <HistoryMemberFilter
            memberId={memberId}
            memberLabel={selectedLabel}
            onSelect={chooseMember}
          />
        )}
      </div>
      {notice && (
        <p
          className={notice.kind === "conflict" ? "field-error" : "promotion-notice"}
          role={notice.kind === "conflict" ? "alert" : "status"}
        >
          {notice.kind === "conflict"
            ? t("conflict")
            : t("committed", { nickname: notice.nickname, game: notice.game.toUpperCase() })}
        </p>
      )}
      <Card className="promotion-results stack">
        <PromotionReadState query={query} cursor={cursor} onFirstPage={() => firstPage(true)} />
        {data && data.items.length === 0 && (
          <p role="status">
            {t(tab === "history" ? "emptyHistory" : tab === "ready" ? "emptyReady" : "emptyAll")}
          </p>
        )}
        {tab === "history" && !!history.data?.data.data.items.length && (
          <HistoryTable items={history.data.data.data.items} />
        )}
        {tab !== "history" && !!candidates.data?.data.data.items.length && (
          <CandidateTable
            items={candidates.data.data.data.items}
            onPromote={promote}
            blocked={!!preview}
          />
        )}
        {(cursor || data?.nextCursor) && !query.isError && (
          <PageNav
            hasPrevious={!!cursor}
            next={data?.nextCursor}
            onNext={(next) => {
              previous.current.set(`${pageKey}&cursor=${next}`, cursor);
              setParams(searchParams(filters, next));
            }}
            onPrevious={() =>
              setParams(
                searchParams(filters, previous.current.get(`${pageKey}&cursor=${cursor}`) ?? null),
              )
            }
          />
        )}
      </Card>
      {preview && (
        <PromotionConfirmation
          {...preview}
          onRefresh={() => {
            previous.current.clear();
            firstPage(true);
          }}
          onClose={close}
          onFocusReturn={() => restoreFocus(trigger, heading, focusHeading.current)}
        />
      )}
    </div>
  );
}

function restoreFocus(
  trigger: RefObject<HTMLButtonElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
  forceHeading: boolean,
) {
  const origin = trigger.current;
  if (!forceHeading && origin?.isConnected) origin.focus();
  else heading.current?.focus();
}
