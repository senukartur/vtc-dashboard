import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { revisionSchema, uuid } from "../../shared/catalog-selectors/contracts.js";
import type { Game, Kind, Selection } from "../../shared/catalog-selectors/index.js";
import { useCatalogQuery, usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { CatalogImport } from "./CatalogImport.js";
import { CatalogReview } from "./CatalogReview.js";
import { CatalogRevisions } from "./CatalogRevisions.js";
import { CatalogSearch } from "./CatalogSearch.js";
import { StateBadge } from "./ReviewTables.js";
import "./catalogs.css";

const games = [
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;

/** Gate: without company.read no catalog query hook mounts, so nothing is requested. */
export function CatalogsPage() {
  const { t } = useTranslation("catalogs"),
    session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="catalog-page">
        <header className="catalog-header">
          <h1>{t("title")}</h1>
        </header>
        <Card className="catalog-card">
          <p>{t("pageForbidden")}</p>
        </Card>
      </div>
    );
  return <CatalogWorkspace />;
}

function NoCandidate() {
  const { t } = useTranslation("catalogs"),
    headingId = useId();
  return (
    <Card className="catalog-card catalog-empty" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("noCandidateTitle")}</h2>
      <p className="catalog-muted">{t("noCandidateHelp")}</p>
    </Card>
  );
}

function CatalogWorkspace() {
  const { t } = useTranslation("catalogs"),
    session = useSession(),
    [params, setParams] = useSearchParams();
  const [game, setGame] = useState<Game>(params.get("game") === "ats" ? "ats" : "ets2"),
    [revision, setRevision] = useState(""),
    [kind, setKind] = useState<Kind>("city"),
    [region, setRegion] = useState<Selection | null>(null),
    [value, setValue] = useState<Selection | null>(null);
  const publications = usePublishedRevisions(game),
    list = publications.data?.pages.flatMap((p) => p.data.data.items) ?? [],
    active = revision || list[0]?.id || "";
  const staff = !!session.self?.capabilities.includes("qualifications.manage");
  const candidate = params.get("candidate"),
    candidateId = uuid.safeParse(candidate).success ? candidate : null;
  // Same key as CatalogReview's detail query, so the revisions row shares its cache entry.
  const candidateDetail = useCatalogQuery(
    ["candidate", candidateId],
    `/admin/catalog-revisions/${candidateId}`,
    revisionSchema,
    staff && !!candidateId,
  );
  const selectCandidate = useCallback(
    (id: string) => {
      setParams(
        (previous) => {
          if (previous.get("candidate") === id) return previous;
          const next = new URLSearchParams(previous);
          next.set("candidate", id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return (
    <div className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-heading">
          <h1>{t("title")}</h1>
          {publications.isSuccess && (
            <StateBadge
              state={list.length ? "current" : "replaced"}
              label={t(list.length ? "badgeInUse" : "badgeNone")}
            />
          )}
        </div>
        <SegmentedControl
          aria-label={t("game")}
          className="catalog-game"
          value={game}
          options={games}
          onValueChange={(next) => {
            setGame(next);
            setParams(
              (previous) => {
                const nextParams = new URLSearchParams(previous);
                nextParams.set("game", next);
                return nextParams;
              },
              { replace: true },
            );
            setRevision("");
            setRegion(null);
          }}
        />
        <p className="catalog-description">{t("description")}</p>
      </header>
      <div className="catalog-layout">
        <div className="catalog-column">
          <CatalogRevisions
            game={game}
            published={list}
            candidate={candidateDetail.data?.data.data}
            isPending={publications.isPending}
            isError={publications.isError}
            isSuccess={publications.isSuccess}
            hasNextPage={publications.hasNextPage}
            isFetchingNextPage={publications.isFetchingNextPage}
            refetch={() => void publications.refetch()}
            fetchNextPage={() => void publications.fetchNextPage()}
          />
          {staff ? (
            <CatalogImport game={game} onCandidate={selectCandidate} />
          ) : (
            <Card className="catalog-card">
              <p className="catalog-muted">{t("staffOnly")}</p>
            </Card>
          )}
        </div>
        <div className="catalog-column">
          {staff && candidate && !candidateId && <p role="alert">{t("invalidId")}</p>}
          {staff &&
            (candidateId ? <CatalogReview key={candidateId} id={candidateId} /> : <NoCandidate />)}
          <CatalogSearch
            game={game}
            list={list}
            active={active}
            onRevision={(id) => {
              setRevision(id);
              setRegion(null);
            }}
            kind={kind}
            onKind={setKind}
            region={region}
            onRegion={setRegion}
            value={value}
            onValue={setValue}
          />
        </div>
      </div>
    </div>
  );
}
