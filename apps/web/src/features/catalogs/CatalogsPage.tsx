import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { kinds, uuid } from "../../shared/catalog-selectors/contracts.js";
import {
  CatalogSelector,
  type Game,
  type Kind,
  type Selection,
} from "../../shared/catalog-selectors/index.js";
import { usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import { CatalogImport } from "./CatalogImport.js";
import { CatalogReview } from "./CatalogReview.js";
import "./catalogs.css";

export function CatalogsPage() {
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
  const staff = session.self?.capabilities.includes("qualifications.manage"),
    read = session.self?.capabilities.includes("company.read");
  const candidate = params.get("candidate"),
    candidateId = uuid.safeParse(candidate).success ? candidate : null;
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
  if (!read)
    return (
      <Card>
        <h1>{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </Card>
    );
  return (
    <div className="stack catalog-page">
      <header>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
      </header>
      <Card className="stack">
        <div className="catalog-grid">
          <div className="stack">
            <Label htmlFor="catalog-game">{t("game")}</Label>
            <select
              id="catalog-game"
              className="input"
              value={game}
              onChange={(e) => {
                setGame(e.target.value as Game);
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.set("game", e.target.value);
                    return next;
                  },
                  { replace: true },
                );
                setRevision("");
                setRegion(null);
              }}
            >
              <option value="ets2">ETS2</option>
              <option value="ats">ATS</option>
            </select>
          </div>
          <div className="stack">
            <Label htmlFor="catalog-revision">{t("revision")}</Label>
            <select
              id="catalog-revision"
              className="input"
              value={active}
              disabled={!list.length}
              onChange={(e) => {
                setRevision(e.target.value);
                setRegion(null);
              }}
            >
              {!list.length && <option value="">{t("noPublication")}</option>}
              {list.map((r, i) => (
                <option value={r.id} key={r.id}>
                  {i === 0 ? t("current") : r.createdAt} · {r.id}
                </option>
              ))}
            </select>
            {active && <small>{active}</small>}
          </div>
        </div>
        {publications.isPending && <p role="status">{t("loading")}</p>}
        {publications.isError && (
          <p role="alert">
            {t("readError")}{" "}
            <Button onClick={() => void publications.refetch()}>{t("refresh")}</Button>
          </p>
        )}
        {publications.hasNextPage && (
          <Button
            variant="outline"
            disabled={publications.isFetchingNextPage}
            onClick={() => void publications.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
        <div className="catalog-grid">
          <div className="stack">
            <Label htmlFor="catalog-kind">{t("kind")}</Label>
            <select
              id="catalog-kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
            {kind === "city" && (
              <CatalogSelector
                key={`${game}-${active}`}
                label={t("regionFilter")}
                game={game}
                revisionId={active}
                kind="region"
                value={region}
                onChange={setRegion}
              />
            )}
          </div>
          <CatalogSelector
            label={t(kind)}
            game={game}
            revisionId={active}
            kind={kind}
            regionId={
              kind === "city" && region?.revisionId === active ? region.entityId : undefined
            }
            value={value}
            onChange={setValue}
          />
        </div>
      </Card>
      {staff ? (
        <>
          <h2>{t("administration")}</h2>
          <CatalogImport game={game} onCandidate={selectCandidate} />
          {candidateId && <CatalogReview key={candidateId} id={candidateId} />}
        </>
      ) : (
        <p>{t("staffOnly")}</p>
      )}
      {staff && candidate && !candidateId && <p role="alert">{t("invalidId")}</p>}
    </div>
  );
}
