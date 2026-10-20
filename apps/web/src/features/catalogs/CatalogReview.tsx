import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CatalogDTO, revisionSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogPages, useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { CatalogMapping } from "./CatalogMappings.js";
import { Failure } from "./Feedback.js";
import { changesSchema, coverageSchema, issuesSchema, reviewSchema } from "./transport.js";
import { useCatalogCommand } from "./useCatalogCommand.js";

function Provenance({ items }: { items: CatalogDTO["CatalogProvenance"][] }) {
  const { t } = useTranslation("catalogs");
  return (
    <div>
      <h4>{t("provenance")}</h4>
      {!items.length ? (
        <p>{t("noProvenance")}</p>
      ) : (
        items.map((p) => (
          <div className="catalog-selection" key={p.referenceId}>
            <a href={p.publicSourceUrl} target="_blank" rel="noreferrer">
              {p.publicSourceUrl}
            </a>
            <p>{p.attribution}</p>
            <p>{p.permittedUseBasis}</p>
            <time>{p.observedAt}</time>
          </div>
        ))
      )}
    </div>
  );
}
const renderValue = (value: CatalogDTO["CatalogFieldChange"]["after"]) =>
  value === null ? "∅" : Array.isArray(value) ? value.join(" · ") : String(value);
export function CatalogReview({ id }: { id: string }) {
  const { t } = useTranslation("catalogs"),
    client = useQueryClient();
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
  const [view, setView] = useState<"changes" | "coverage" | "mappings" | "translations">("changes"),
    [changeKind, setChangeKind] = useState("");
  const [confirmation, setConfirmation] = useState<{
      revision: CatalogDTO["CatalogRevision"];
      review: CatalogDTO["CatalogReview"];
      etag: string;
    } | null>(null),
    [reason, setReason] = useState(""),
    [success, setSuccess] = useState(false),
    [stale, setStale] = useState(false);
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
  const gate =
    valid &&
    r.state === "draft" &&
    r.coverageComplete &&
    r.englishLabelsComplete &&
    r.sourceReviewComplete &&
    manifest.mappingIssues === 0;
  const active = view === "coverage" ? coverage : view === "mappings" ? issues : diff;
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
  return (
    <Card className="stack">
      <div className="catalog-toolbar">
        <h2>{t("reviewTitle")}</h2>
        <Button variant="outline" disabled={command.pending} onClick={() => void refresh()}>
          {t("refresh")}
        </Button>
      </div>
      {(detail.isPending || review.isPending) && <p role="status">{t("loading")}</p>}
      {(detail.isError || review.isError) && <p role="alert">{t("readError")}</p>}
      {success && <p role="status">{t("publishedSuccess")}</p>}
      {r && manifest && (
        <>
          <dl className="catalog-facts">
            <dt>{t("game")}</dt>
            <dd>{r.game.toUpperCase()}</dd>
            <dt>{t("candidate")}</dt>
            <dd>
              {r.id} · {t(r.state)}
            </dd>
            <dt>{t("build")}</dt>
            <dd>{manifest.gameBuild}</dd>
            <dt>{t("inventory")}</dt>
            <dd>{manifest.releaseInventoryAsOf}</dd>
            <dt>{t("comparison")}</dt>
            <dd>{manifest.comparisonRevisionId ?? t("firstPublication")}</dd>
            <dt>{t("version")}</dt>
            <dd>{r.version}</dd>
            <dt>{t("publicationVersion")}</dt>
            <dd>{r.publicationVersion}</dd>
          </dl>
          <div className="catalog-summary">
            <span>
              {t("added")}: {manifest.addedEntities}
            </span>
            <span>
              {t("changed")}: {manifest.changedEntities}
            </span>
            <span>
              {t("retiredCount")}: {manifest.retiredEntities}
            </span>
            <span>
              {t("expectedPacks")}: {manifest.expectedPacks}
            </span>
            <span>
              {t("mappingIssues")}: {manifest.mappingIssues}
            </span>
          </div>
          <Provenance items={manifest.provenance} />
          <div className="catalog-toolbar">
            {(["changes", "coverage", "mappings", "translations"] as const).map((v) => (
              <Button
                key={v}
                variant={v === view ? "default" : "outline"}
                aria-pressed={v === view}
                onClick={() => setView(v)}
              >
                {t(v)}
              </Button>
            ))}
          </div>
          <section className="stack" aria-label={t(view)}>
            <h3>{t(view)}</h3>
            {view === "translations" && <p>{t("translationHelp")}</p>}
            {view === "mappings" && <p>{t("mappingHelp")}</p>}
            {(view === "changes" || view === "translations") && (
              <>
                <Label htmlFor="change-kind">{t("changes")}</Label>
                <select
                  className="input"
                  id="change-kind"
                  value={changeKind}
                  onChange={(e) => setChangeKind(e.target.value)}
                >
                  <option value="">{t("changes")}</option>
                  {["added", "changed", "retired"].map((v) => (
                    <option key={v} value={v}>
                      {t(v === "retired" ? "retiredCount" : v)}
                    </option>
                  ))}
                </select>
                {changes.map((c) => (
                  <article key={c.entityId} className="stack catalog-selection">
                    <h4>{labels.get(c.entityId) ?? c.entityId}</h4>
                    <p>
                      {t(c.kind)} · {t(c.changeKind === "retired" ? "retiredCount" : c.changeKind)}
                    </p>
                    <small>{c.entityId}</small>
                    <dl>
                      {c.fields
                        .filter(
                          (f) =>
                            view !== "translations" || ["label_en", "label_ru"].includes(f.field),
                        )
                        .map((f) => (
                          <div key={JSON.stringify([f.field, f.before, f.after])}>
                            <dt>{t(f.field)}</dt>
                            <dd>
                              {t("before")}: {renderValue(f.before)} → {t("after")}:{" "}
                              {renderValue(f.after)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    {c.reasonCodes.length > 0 && (
                      <p>
                        {t("reasons")}: {c.reasonCodes.join(" · ")}
                      </p>
                    )}
                  </article>
                ))}
              </>
            )}
            {view === "coverage" &&
              coverage.data?.pages
                .flatMap((p) => p.data.data.items)
                .map((pack) => (
                  <article className="stack catalog-selection" key={pack.packId}>
                    <h4>
                      {pack.title} · {pack.packId}
                    </h4>
                    <p>{t(pack.state)}</p>
                    <p>
                      {t("contribution")}:{" "}
                      {pack.contributionKinds.map((k) => t(k)).join(" · ") || t("none")}
                    </p>
                    <p>
                      {t("reasons")}: {pack.reasonCodes.join(" · ") || t("none")}
                    </p>
                    <Provenance items={pack.provenance} />
                  </article>
                ))}
            {view === "mappings" &&
              issues.data?.pages
                .flatMap((p) => p.data.data.items)
                .map((issue) => (
                  <CatalogMapping
                    key={`${issue.id}-${manifest.version}`}
                    issue={issue}
                    revisionId={id}
                    game={r.game}
                    editable={r.state === "draft"}
                    changed={refresh}
                    labels={labels}
                  />
                ))}
            {active.isPending && <p role="status">{t("loading")}</p>}
            {active.isError && <p role="alert">{t("readError")}</p>}
            {active.isSuccess && !active.data?.pages.some((p) => p.data.data.items.length) && (
              <p>{t("none")}</p>
            )}
            {active.hasNextPage && (
              <Button
                variant="outline"
                disabled={active.isFetchingNextPage}
                onClick={() => void active.fetchNextPage()}
              >
                {t("more")}
              </Button>
            )}
          </section>
          <section className="stack catalog-selection">
            <h3>{t("publish")}</h3>
            <p>{t("gates")}</p>
            <ul>
              <li>
                {t("coverageReview")}: {t(r.coverageComplete ? "yes" : "no")}
              </li>
              <li>
                {t("englishReview")}: {t(r.englishLabelsComplete ? "yes" : "no")}
              </li>
              <li>
                {t("sourceReview")}: {t(manifest.sourceReviewState)}
              </li>
              <li>
                {t("mappingIssues")}: {manifest.mappingIssues}
              </li>
            </ul>
            {stale && <p role="alert">{t("stale")}</p>}
            <Dialog
              open={!!confirmation}
              onOpenChange={(open) => {
                if (!open && !command.pending) setConfirmation(null);
              }}
            >
              <DialogTrigger asChild>
                <Button
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
                className="stack catalog-dialog"
                onEscapeKeyDown={(e) => {
                  if (command.pending) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                  if (command.pending) e.preventDefault();
                }}
              >
                <DialogTitle>{t("confirmTitle")}</DialogTitle>
                <DialogDescription>{t("confirmHelp")}</DialogDescription>
                {confirmation && (
                  <>
                    <p>
                      {confirmation.revision.game.toUpperCase()} · {confirmation.review.gameBuild}
                    </p>
                    <p>
                      {confirmation.revision.id} · {t("version")}: {confirmation.revision.version} ·{" "}
                      {t("publicationVersion")}: {confirmation.revision.publicationVersion}
                    </p>
                    <form
                      className="stack"
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
                      <Label htmlFor="publication-reason">{t("reason")}</Label>
                      <Input
                        id="publication-reason"
                        value={reason}
                        maxLength={2048}
                        required
                        disabled={command.pending}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Failure error={command.failure} seconds={command.seconds} />
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
                        <Button disabled={command.pending || command.seconds > 0 || !reason.trim()}>
                          {t(command.pending ? "pendingAction" : "confirmPublish")}
                        </Button>
                      )}
                    </form>
                  </>
                )}
                <DialogClose asChild>
                  <Button variant="outline" disabled={command.pending}>
                    {t("cancel")}
                  </Button>
                </DialogClose>
              </DialogContent>
            </Dialog>
          </section>
        </>
      )}
    </Card>
  );
}
