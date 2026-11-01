import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CatalogDTO, revisionSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogPages, useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { formatDecimal } from "../../shared/formatting.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Button, Card, Input, Label, Select } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { AccountFailure } from "../account/transport.js";
import { CatalogMapping, mappingPossible } from "./CatalogMappings.js";
import { Failure } from "./Feedback.js";
import { changeCount, type PublishBlocker, packProblems, publishBlockers } from "./model.js";
import {
  ChangesTable,
  CoverageTable,
  MappingsTable,
  Provenance,
  ScrollRegion,
  StateBadge,
  TranslationsTable,
} from "./ReviewTables.js";
import { changesSchema, coverageSchema, issuesSchema, reviewSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

type View = "changes" | "coverage" | "mappings" | "translations";
type Pages = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  data?: { pages: { data: { data: { items: unknown[] } } }[] } | undefined;
  refetch: () => Promise<unknown>;
  fetchNextPage: () => Promise<unknown>;
};

/** Shared panel states: pending, error with retry, empty only after success, and paging. */
function PanelStates({ query }: { query: Pages }) {
  const { t } = useTranslation("catalogs");
  return (
    <>
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.isError && (
        <div role="alert" className="catalog-inline-alert">
          <p>{t("readError")}</p>
          <Button size="xs" variant="outline" onClick={() => void query.refetch()}>
            {t("retryRead")}
          </Button>
        </div>
      )}
      {query.isSuccess && !query.data?.pages.some((p) => p.data.data.items.length) && (
        <p>{t("none")}</p>
      )}
      {query.hasNextPage && (
        <Button
          size="xs"
          variant="outline"
          className="catalog-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </>
  );
}

function ChangeKindFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation("catalogs"),
    id = useId();
  return (
    <div className="catalog-panel-toolbar">
      <Label htmlFor={id}>{t("changeType")}</Label>
      <Select size="xs" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("allChanges")}</option>
        {(["added", "changed", "retired"] as const).map((v) => (
          <option key={v} value={v}>
            {t(v === "retired" ? "retiredCount" : v)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Panel({ children, foot }: { children: ReactNode; foot: ReactNode }) {
  return (
    <div className="catalog-panel">
      {children}
      <div className="catalog-panel-foot">{foot}</div>
    </div>
  );
}

export function CatalogReview({ id }: { id: string }) {
  const { t, i18n } = useTranslation("catalogs"),
    client = useQueryClient(),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    headingId = useId(),
    whyId = useId();
  const detail = useCatalogQuery(
    ["candidate", id],
    `/admin/catalog-revisions/${id}`,
    revisionSchema,
  );
  const review = useCatalogQuery(
    ["review", id],
    `/admin/catalog-revisions/${id}/review`,
    reviewSchema,
  );
  const r = detail.data?.data.data,
    manifest = review.data?.data.data;
  const [view, setView] = useState<View>("changes"),
    [changeKind, setChangeKind] = useState("");
  const [confirmation, setConfirmation] = useState<{
      revision: CatalogDTO["CatalogRevision"];
      review: CatalogDTO["CatalogReview"];
      etag: string;
    } | null>(null),
    [reason, setReason] = useState(""),
    [success, setSuccess] = useState(false),
    [stale, setStale] = useState(false),
    [mappingSaved, setMappingSaved] = useState(false),
    savedRef = useRef<HTMLParagraphElement>(null);
  // A saved mapping can remount or remove its row, so focus moves to the stable status line.
  useEffect(() => {
    if (mappingSaved) savedRef.current?.focus();
  }, [mappingSaved]);
  const command = useCatalogCommand(),
    valid = !!r && !!manifest && r.version === manifest.version;
  const diff = useCatalogPages(
    ["diff", id, manifest?.version, changeKind],
    `/admin/catalog-revisions/${id}/diff`,
    { reviewVersion: manifest?.version, changeKind: changeKind || undefined },
    changesSchema,
    valid && (view === "changes" || view === "translations" || view === "mappings"),
  );
  const coverage = useCatalogPages(
    ["coverage", id, manifest?.version],
    `/admin/catalog-revisions/${id}/coverage`,
    { reviewVersion: manifest?.version },
    coverageSchema,
    valid && view === "coverage",
  );
  const issues = useCatalogPages(
    ["issues", id, manifest?.version],
    `/admin/catalog-revisions/${id}/mapping-issues`,
    { reviewVersion: manifest?.version },
    issuesSchema,
    valid && view === "mappings",
  );
  const changes = diff.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  const packs = coverage.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  const issueItems = issues.data?.pages.flatMap((p) => p.data.data.items) ?? [];
  const labels = new Map(
    changes.flatMap((c) => {
      const f = c.fields.find((f) => f.field === "label_en" && typeof f.after === "string");
      return f ? [[c.entityId, String(f.after)] as const] : [];
    }),
  );
  async function refresh() {
    setConfirmation(null);
    setStale(false);
    command.reset();
    await client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "catalogs" &&
        q.queryKey.includes(id) &&
        ["candidate", "review"].some((lane) => q.queryKey.includes(lane)),
    });
    await client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "catalogs" &&
        q.queryKey.includes(id) &&
        ["diff", "coverage", "issues"].some((lane) => q.queryKey.includes(lane)),
    });
  }
  const blockers = publishBlockers(r, manifest),
    gate = blockers.length === 0;
  const conflict =
    command.failure?.kind === "conflict" ||
    [detail.error, review.error, diff.error, coverage.error, issues.error].some(
      (error) => error instanceof AccountFailure && error.kind === "conflict",
    );
  useEffect(() => {
    if (!conflict) return;
    setConfirmation(null);
    setStale(true);
    void client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "catalogs" &&
        ["candidate", "review"].some((key) => q.queryKey.includes(key)),
    });
  }, [conflict, client]);
  const number = (n: number) => formatDecimal(String(n), locale);
  const condition = (blocker: PublishBlocker): string => {
    switch (blocker.kind) {
      case "unavailable":
        return t("blockUnavailable");
      case "version":
        return t("blockVersion");
      case "state":
        return t("blockState", { state: t(blocker.state) });
      case "coverage":
        return blocker.problems > 0
          ? t("coverageProblems", { n: number(blocker.problems) })
          : t("coverageIncomplete");
      case "english":
        return t("englishIncomplete");
      case "source":
        return t("sourceReviewState", { state: t(blocker.state) });
      case "mappings":
        return t("mappingCount", { n: number(blocker.count) });
    }
  };
  const why = gate
    ? t("whyReady")
    : t("whyBlocked", { reasons: blockers.map(condition).join("; ") });
  return (
    <Card className="catalog-card catalog-candidate" aria-labelledby={headingId}>
      <div className="catalog-card-head">
        <h2 id={headingId}>{t("reviewTitle")}</h2>
        {r && <StateBadge state={r.state} label={t(r.state)} />}
        <Button
          size="xs"
          variant="outline"
          className="catalog-head-action"
          disabled={command.pending}
          onClick={() => void refresh()}
        >
          {t("refresh")}
        </Button>
      </div>
      {(detail.isPending || review.isPending) && <p role="status">{t("loading")}</p>}
      {(detail.isError || review.isError) && <p role="alert">{t("readError")}</p>}
      {success && <p role="status">{t("publishedSuccess")}</p>}
      {r && manifest && (
        <>
          <dl className="catalog-meta">
            <div>
              <dt>{t("game")}</dt>
              <dd>{r.game.toUpperCase()}</dd>
            </div>
            <div>
              <dt>{t("build")}</dt>
              <dd>{manifest.gameBuild}</dd>
            </div>
            <div>
              <dt>{t("inventory")}</dt>
              <dd>{manifest.releaseInventoryAsOf}</dd>
            </div>
            <div>
              <dt>{t("version")}</dt>
              <dd>{r.version}</dd>
            </div>
            <div>
              <dt>{t("publicationVersion")}</dt>
              <dd>{r.publicationVersion}</dd>
            </div>
            <div className="catalog-meta-wide">
              <dt>{t("candidate")}</dt>
              <dd>
                <code>{r.id}</code>
              </dd>
            </div>
            <div className="catalog-meta-wide">
              <dt>{t("comparison")}</dt>
              <dd>
                {manifest.comparisonRevisionId ? (
                  <code>{manifest.comparisonRevisionId}</code>
                ) : (
                  t("firstPublication")
                )}
              </dd>
            </div>
          </dl>
          <details className="catalog-details">
            <summary>{t("provenanceCount", { n: manifest.provenance.length })}</summary>
            <Provenance items={manifest.provenance} />
          </details>
          <fieldset className="catalog-summary" aria-label={t("summaryLabel")}>
            <dl className="catalog-tiles">
              <div className="catalog-tile-added">
                <dt>{t("added")}</dt>
                <dd>{number(manifest.addedEntities)}</dd>
              </div>
              <div className="catalog-tile-changed">
                <dt>{t("changed")}</dt>
                <dd>{number(manifest.changedEntities)}</dd>
              </div>
              <div>
                <dt>{t("retiredCount")}</dt>
                <dd>{number(manifest.retiredEntities)}</dd>
              </div>
            </dl>
          </fieldset>
          <ul className="catalog-conditions" aria-label={t("conditionsLabel")}>
            {[
              {
                ok: r.coverageComplete,
                text: r.coverageComplete
                  ? t("coverageReview")
                  : condition({ kind: "coverage", problems: packProblems(manifest) }),
              },
              {
                ok: r.englishLabelsComplete,
                text: t(r.englishLabelsComplete ? "englishReview" : "englishIncomplete"),
              },
              {
                ok: r.sourceReviewComplete,
                text: t("sourceReviewState", { state: t(manifest.sourceReviewState) }),
              },
              {
                ok: manifest.mappingIssues === 0,
                text:
                  manifest.mappingIssues === 0
                    ? t("noMappings")
                    : t("mappingCount", { n: number(manifest.mappingIssues) }),
              },
            ].map((item) => (
              <li key={item.text} className={item.ok ? "catalog-ok" : "catalog-blocked"}>
                <span aria-hidden="true">{item.ok ? "✓" : "✕"}</span> <span>{item.text}</span>
              </li>
            ))}
          </ul>
          <Tabs
            value={view}
            onValueChange={(next) => {
              setView(next as View);
              setMappingSaved(false);
            }}
          >
            <TabsList aria-label={t("sectionsLabel")} className="catalog-tabs">
              <TabsTrigger value="changes">
                {t("tabChanges", { n: number(changeCount(manifest)) })}
              </TabsTrigger>
              <TabsTrigger value="coverage">
                {packProblems(manifest) > 0 ? (
                  <>
                    {t("tabCoverage", { n: number(packProblems(manifest)) })}{" "}
                    <span aria-hidden="true" className="catalog-blocked">
                      ✕
                    </span>
                  </>
                ) : (
                  t("coverage")
                )}
              </TabsTrigger>
              <TabsTrigger value="mappings">
                {manifest.mappingIssues > 0
                  ? t("tabMappings", { n: number(manifest.mappingIssues) })
                  : t("mappings")}
              </TabsTrigger>
              <TabsTrigger value="translations">{t("translations")}</TabsTrigger>
            </TabsList>
            <TabsContent value="changes">
              <Panel foot={<p>{t("changesFoot")}</p>}>
                <ChangeKindFilter value={changeKind} onChange={setChangeKind} />
                {changes.length > 0 && (
                  <ScrollRegion label={t("changes")}>
                    <ChangesTable changes={changes} />
                  </ScrollRegion>
                )}
                <PanelStates query={diff} />
              </Panel>
            </TabsContent>
            <TabsContent value="coverage">
              <Panel foot={<p>{t("coverageFoot")}</p>}>
                {packs.length > 0 && (
                  <ScrollRegion label={t("coverage")}>
                    <CoverageTable packs={packs} />
                  </ScrollRegion>
                )}
                <PanelStates query={coverage} />
              </Panel>
            </TabsContent>
            <TabsContent value="mappings">
              <Panel
                foot={
                  <>
                    <p>{t("mappingHelp")}</p>
                    {issueItems.some((issue) => !mappingPossible(issue) || r.state !== "draft") && (
                      <p>{t("reimport")}</p>
                    )}
                  </>
                }
              >
                <p ref={savedRef} role="status" tabIndex={-1} className="catalog-saved">
                  {mappingSaved ? t("mappingSaved") : ""}
                </p>
                {issueItems.length > 0 && (
                  <ScrollRegion label={t("mappings")}>
                    <MappingsTable>
                      {issueItems.map((issue) => (
                        <CatalogMapping
                          key={`${issue.id}-${manifest.version}`}
                          issue={issue}
                          revisionId={id}
                          game={r.game}
                          editable={r.state === "draft"}
                          changed={refresh}
                          onOpen={() => setMappingSaved(false)}
                          onSaved={() => setMappingSaved(true)}
                          labels={labels}
                        />
                      ))}
                    </MappingsTable>
                  </ScrollRegion>
                )}
                <PanelStates query={issues} />
              </Panel>
            </TabsContent>
            <TabsContent value="translations">
              <Panel foot={<p>{t("translationHelp")}</p>}>
                <ChangeKindFilter value={changeKind} onChange={setChangeKind} />
                {changes.length > 0 && (
                  <TranslationsTable changes={changes} more={diff.hasNextPage} />
                )}
                <PanelStates query={diff} />
              </Panel>
            </TabsContent>
          </Tabs>
          {stale && <p role="alert">{t("stale")}</p>}
          <div className="catalog-publish">
            <Dialog
              open={!!confirmation}
              onOpenChange={(open) => {
                if (!open && !command.pending) setConfirmation(null);
              }}
            >
              <DialogTrigger asChild>
                <Button
                  aria-describedby={whyId}
                  disabled={!gate || !detail.data?.etag || command.pending || stale}
                  onClick={() => {
                    if (detail.data?.etag) {
                      setConfirmation({ revision: r, review: manifest, etag: detail.data.etag });
                      setReason("");
                      command.reset();
                    }
                  }}
                >
                  {t("publish")}
                </Button>
              </DialogTrigger>
              <DialogContent
                className="catalog-dialog"
                onEscapeKeyDown={(e) => {
                  if (command.pending) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                  if (command.pending) e.preventDefault();
                }}
              >
                <DialogTitle>
                  {t("confirmTitle", {
                    game: (confirmation?.revision.game ?? r.game).toUpperCase(),
                  })}
                </DialogTitle>
                <DialogDescription>{t("confirmHelp")}</DialogDescription>
                {confirmation && (
                  <>
                    <ul className="catalog-points">
                      <li>
                        {t("confirmBuild", {
                          game: confirmation.revision.game.toUpperCase(),
                          build: confirmation.review.gameBuild,
                        })}
                      </li>
                      <li>
                        {t("confirmCandidate", {
                          id: confirmation.revision.id,
                          version: confirmation.revision.version,
                        })}
                      </li>
                      <li>
                        {t("confirmPointer", { n: confirmation.revision.publicationVersion })}
                      </li>
                    </ul>
                    <form
                      className="catalog-dialog-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!reason.trim()) return;
                        const result = await command.run(
                          `/admin/catalog-revisions/${id}/publication`,
                          {
                            expectedPublicationVersion: confirmation.revision.publicationVersion,
                            reason: reason.trim(),
                          },
                          revisionSchema,
                          confirmation.etag,
                        );
                        if (result) {
                          setConfirmation(null);
                          setSuccess(true);
                          await refresh();
                          await client.invalidateQueries({
                            predicate: (q) =>
                              q.queryKey[0] === "catalogs" && q.queryKey.includes("published"),
                          });
                        }
                      }}
                    >
                      <div className="catalog-field">
                        <Label htmlFor="publication-reason">{t("reason")}</Label>
                        <Input
                          id="publication-reason"
                          value={reason}
                          maxLength={2048}
                          required
                          disabled={command.pending}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </div>
                      <Failure error={command.failure} seconds={command.seconds} />
                      <div className="catalog-dialog-actions">
                        <DialogClose asChild>
                          <Button type="button" variant="outline" disabled={command.pending}>
                            {t("cancel")}
                          </Button>
                        </DialogClose>
                        {command.failure?.kind === "conflict" ? (
                          <Button
                            type="button"
                            onClick={() => {
                              setConfirmation(null);
                              setStale(true);
                              void client.invalidateQueries({
                                predicate: (q) =>
                                  q.queryKey[0] === "catalogs" &&
                                  q.queryKey.includes(id) &&
                                  ["candidate", "review"].some((lane) => q.queryKey.includes(lane)),
                              });
                            }}
                          >
                            {t("stale")}
                          </Button>
                        ) : (
                          <Button
                            disabled={command.pending || command.seconds > 0 || !reason.trim()}
                          >
                            {t(command.pending ? "pendingAction" : "confirmPublish")}
                          </Button>
                        )}
                      </div>
                    </form>
                  </>
                )}
              </DialogContent>
            </Dialog>
            <p id={whyId} role="status" className={gate ? "catalog-muted" : "catalog-why-blocked"}>
              {why}
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
