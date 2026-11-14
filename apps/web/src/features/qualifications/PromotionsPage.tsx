import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import type { CursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import { usePromotionCommand } from "./PromotionCommandProvider.js";
import { PromotionConfirmation } from "./PromotionConfirmation.js";
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
type ListPage = { items: unknown[]; total: number; nextCursor: string | null };

function searchParams({ tab, game, memberId }: Filters, cursor: string | null = null) {
  const params = new URLSearchParams({ game, tab });
  if (tab === "history" && memberId) params.set("memberId", memberId);
  if (cursor) params.set("cursor", cursor);
  return params;
}

export function PromotionsPage() {
  const { self } = useSession();
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
  return <PromotionsWorkspace />;
}

function PromotionsWorkspace() {
  const { t, i18n } = useTranslation("promotions");
  const [params, setParams] = useSearchParams();
  const command = usePromotionCommand();
  const tabValue = params.get("tab");
  const tab: Tab = tabValue === "all" || tabValue === "history" ? tabValue : "ready";
  const game = params.get("game") === "ats" ? "ats" : "ets2";
  const member = schema("Id").safeParse(tab === "history" ? params.get("memberId") : null);
  const memberId = member.success ? member.data : null;
  const filters: Filters = { tab, game, memberId };
  const cursorValue = params.get("cursor");
  const cursor = cursorValue && cursorValue.length <= 2048 ? cursorValue : null;
  const [selection, setSelection] = useState<DTO["MemberSummary"] | null>(null);
  const previous = useRef(new Map<string, { cursor: string | null; page: number }>());
  const handledChange = useRef<typeof command.changed>(null);
  const recovery = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const focusReturn = useRef<"trigger" | "recovery" | "heading" | null>(null);

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

  const { changed, notice, candidate, saved, open } = command;
  const wasOpen = useRef(open);

  useLayoutEffect(() => {
    if (!open && wasOpen.current && notice) focusReturn.current = "heading";
    wasOpen.current = open;
  }, [notice, open]);

  useEffect(() => {
    if (!changed || handledChange.current === changed) return;
    handledChange.current = changed;
    if (changed.candidate.game !== game) return;
    if (tab === "history" && memberId && memberId !== changed.candidate.member.id) return;
    for (const key of previous.current.keys()) {
      const paging = new URLSearchParams(key);
      const previousMember = paging.get("memberId");
      if (
        paging.get("game") === game &&
        (!previousMember || previousMember === changed.candidate.member.id)
      )
        previous.current.delete(key);
    }
    if (cursor) {
      if (open) {
        // Cursor replacement closes a location-bound preview. Keep its focus on this page.
        focusReturn.current = command.conflict ? "recovery" : "heading";
      }
      setParams(searchParams({ tab, game, memberId }), { replace: true });
    }
  }, [changed, command.conflict, cursor, game, memberId, open, setParams, tab]);

  // The workspace cursor is shareable and follows browser Back/Forward. Adapt the URL
  // controls to Pager while keeping the explicit first-page action for rejected cursors.
  const previousPage = previous.current.get(`${pageKey}&cursor=${cursor}`);
  const page = cursor ? (previousPage?.page ?? 1) + 1 : 1;
  const pages: CursorPages = {
    cursor,
    page,
    hasPrevious: !!cursor,
    next(next) {
      previous.current.set(`${pageKey}&cursor=${next}`, { cursor, page });
      setParams(searchParams(filters, next));
    },
    previous() {
      setParams(searchParams(filters, previousPage?.cursor ?? null));
    },
    restart() {
      heading.current?.focus();
      setParams(searchParams(filters), { replace: true });
    },
    recover: () => false,
  };
  function chooseMember(member: DTO["MemberSummary"] | null) {
    setSelection(member);
    setParams(searchParams({ ...filters, memberId: member?.id ?? null }));
  }
  function promote(candidate: Candidate, button: HTMLButtonElement) {
    if (command.candidate || !candidate.eligible || !candidate.nextLevel) return;
    if (command.select({ ...candidate, nextLevel: candidate.nextLevel })) {
      trigger.current = button;
      focusReturn.current = null;
    }
  }
  function dismiss() {
    focusReturn.current = command.held || !trigger.current ? "recovery" : "trigger";
    command.dismiss();
  }
  function restoreFocus() {
    const target = focusReturn.current;
    focusReturn.current = null;
    // Browser navigation can close the dialog while another view already owns focus.
    if (!target || !heading.current?.isConnected) return;
    const control =
      target === "trigger" ? trigger.current : target === "recovery" ? recovery.current : null;
    (control?.isConnected ? control : heading.current).focus();
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
            : t("committed", {
                nickname: notice.candidate.member.nickname,
                game: notice.candidate.game.toUpperCase(),
              })}
        </p>
      )}
      {candidate && !open && (
        <div className="promotion-recovery stack">
          {command.busy && <p role="status">{t("saving")}</p>}
          {command.held && <p role="status">{t("uncertain")}</p>}
          {command.conflict && (
            <p role="alert" className="field-error">
              {t("conflict")}
            </p>
          )}
          <div className="promotion-selected">
            <Button
              ref={recovery}
              type="button"
              variant="outline"
              aria-disabled={command.conflict && command.blocked ? true : undefined}
              onClick={() => {
                if (command.conflict) {
                  if (command.blocked) return;
                  heading.current?.focus();
                  command.reviewAgain();
                  return;
                }
                trigger.current = null;
                focusReturn.current = null;
                command.openPreview();
              }}
            >
              {t(command.conflict ? "reviewCandidates" : command.held ? "recover" : "openPreview")}
            </Button>
          </div>
        </div>
      )}
      <Card className="promotion-results stack">
        <PromotionReadState query={query} cursor={cursor} onFirstPage={pages.restart} />
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
            blocked={!!candidate}
          />
        )}
        {!query.isError && (
          <Pager pages={pages} nextCursor={data?.nextCursor} busy={query.isPending} />
        )}
      </Card>
      {open && candidate && (
        <PromotionConfirmation
          candidate={candidate}
          initialReason={
            command.attemptReason ??
            (saved?.candidate.member.id === candidate.member.id &&
            saved.candidate.game === candidate.game
              ? saved.reason
              : "")
          }
          onDismiss={dismiss}
          onFocusReturn={restoreFocus}
        />
      )}
    </div>
  );
}
