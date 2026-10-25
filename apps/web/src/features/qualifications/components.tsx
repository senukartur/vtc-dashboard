import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { entitySchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery, usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { formatUtc } from "../../shared/formatting.js";
import { Button } from "../../shared/ui/primitives.js";
import { Confirm, Failure, PageNav, State } from "../trips/components.js";
import { type useQualificationCommand, useQualificationQuery } from "./queries.js";
import type { DTO, Game } from "./transport.js";

export { Confirm, Failure, PageNav, State };
export function MemberContext({ name, id }: { name: string; id: string }) {
  const { t } = useTranslation("qualifications");
  return (
    <p className="qualification-command-context">
      <strong>{t("targetMember")}</strong>
      <span>{name}</span>
      <code>{id}</code>
    </p>
  );
}
export function LevelContext({ level }: { level: DTO["QualificationLevel"] | undefined }) {
  const { t } = useTranslation("qualifications");
  return level ? (
    <p className="qualification-command-context">
      <strong>
        {level.game.toUpperCase()} · {t("stage")}: {t(level.code)}
      </strong>
      <span>{level.name}</span>
      <code>{level.id}</code>
    </p>
  ) : null;
}
export function Recovery({
  command,
  onRecovered,
}: {
  command: ReturnType<typeof useQualificationCommand>;
  onRecovered: () => void | Promise<void>;
}) {
  const { t } = useTranslation("qualifications");
  return command.canRecover ? (
    <Button
      type="button"
      variant="outline"
      disabled={command.pending || command.seconds > 0}
      onClick={async () => {
        if (await command.recover()) await onRecovered();
      }}
    >
      {t("recoverCommand")}
    </Button>
  ) : null;
}
export function Time({ value }: { value: string | null }) {
  const { i18n } = useTranslation(),
    session = useSession(),
    zone = session.self?.preferences.displayTimezone ?? "UTC";
  return (
    <time dateTime={value ?? undefined}>
      {formatUtc(value, i18n.resolvedLanguage === "en" ? "en" : "ru", zone)} · {zone}
    </time>
  );
}
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function RulesView({ rules, game }: { rules: DTO["Rule"][]; game: Game }) {
  const { t } = useTranslation("qualifications");
  return rules.length ? (
    <dl className="qualification-facts">
      {rules.map((rule) => (
        <Fact key={rule.type} label={t(rule.type)}>
          {rule.type === "max_mass" ? (
            `${rule.maxKg} kg`
          ) : rule.entityIds.length ? (
            <EntityList
              ids={rule.entityIds}
              game={game}
              kind={rule.type === "allowed_trailer_types" ? "trailer_type" : "adr_category"}
            />
          ) : (
            t("emptyAllowlist")
          )}
        </Fact>
      ))}
    </dl>
  ) : (
    <p>{t("unrestricted")}</p>
  );
}
function EntityList({
  ids,
  game,
  kind,
}: {
  ids: string[];
  game: Game;
  kind: "trailer_type" | "adr_category";
}) {
  const { t } = useTranslation("trips"),
    [visible, setVisible] = useState(25),
    published = usePublishedRevisions(game),
    revision = published.data?.pages[0]?.data.data.items[0]?.id ?? "";
  return (
    <>
      <ul>
        {ids.slice(0, visible).map((id) => (
          <li key={id}>
            <EntityName id={id} revision={revision} game={game} kind={kind} />
          </li>
        ))}
      </ul>
      {ids.length > visible && (
        <Button type="button" variant="outline" onClick={() => setVisible((n) => n + 25)}>
          {t("next")}
        </Button>
      )}
    </>
  );
}
export function EntityName({
  id,
  revision,
  game,
  kind,
}: {
  id: string;
  revision: string;
  game: Game;
  kind: string;
}) {
  const { t, i18n } = useTranslation("qualifications"),
    locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    query = useCatalogQuery(
      ["qualification-label", id, revision, locale],
      `/catalogs/entities/${id}?revisionId=${revision}&locale=${locale}`,
      entitySchema,
      !!revision,
    ),
    entity = query.data?.data.data,
    valid =
      entity?.id === id &&
      entity.revisionId === revision &&
      entity.game === game &&
      entity.kind === kind;
  return (
    <>
      {valid
        ? entity.display.label
        : t(query.isPending && revision ? "catalogLabelLoading" : "catalogLabelUnavailable")}
      {valid && entity.display.englishFallback ? ` · ${t("catalogs:fallback")}` : ""}
      {valid && entity.display.retired ? ` · ${t("catalogs:retired")}` : ""}
      {" · "}
      <code>{id}</code>
    </>
  );
}
export function DraftEntities({
  ids,
  revision,
  game,
  kind,
  page,
  onPage,
  onRemove,
}: {
  ids: (string | null)[];
  revision: string;
  game: Game;
  kind: "trailer_type" | "adr_category";
  page: number;
  onPage: (page: number) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation("qualifications"),
    prefix = useId();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(ids.length / 25) - 1)),
    start = currentPage * 25;
  return (
    <div className="stack">
      <ul className="qualification-draft-entities">
        {ids.slice(start, start + 25).map((id, offset) => {
          const ordinal = start + offset,
            labelId = `${prefix}-${ordinal}`,
            removeId = `${labelId}-remove`;
          // Chain position is the identity of a stateless row; duplicate trailer facts are supported.
          return (
            <li key={labelId}>
              <span id={labelId}>
                {ordinal + 1}.{" "}
                {id ? (
                  <EntityName id={id} revision={revision} game={game} kind={kind} />
                ) : (
                  t("unknown")
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                id={removeId}
                aria-labelledby={`${removeId} ${labelId}`}
                onClick={() => onRemove(ordinal)}
              >
                {t("remove")}
              </Button>
            </li>
          );
        })}
      </ul>
      {ids.length > 25 && (
        <div className="qualification-actions">
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => onPage(currentPage - 1)}
          >
            {t("trips:previous")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={start + 25 >= ids.length}
            onClick={() => onPage(currentPage + 1)}
          >
            {t("trips:next")}
          </Button>
        </div>
      )}
    </div>
  );
}
export function ActionActor({ actor }: { actor: DTO["QualificationActionActor"] | null }) {
  const { t } = useTranslation("qualifications");
  return actor ? (
    <span>
      {actor.nickname ?? t("actorLabelUnavailable")} · <code>{actor.id}</code>
    </span>
  ) : (
    <span>{t("actorNotRecorded")}</span>
  );
}
export function RuleHistory({
  level,
  manage = false,
}: {
  level: DTO["QualificationLevel"];
  manage?: boolean;
}) {
  const { t } = useTranslation("qualifications"),
    [open, setOpen] = useState(false),
    [cursors, setCursors] = useState<string[]>([]);
  const query = useQualificationQuery(
    `${manage ? "/admin" : ""}/qualification-levels/${level.id}/rule-versions?limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? "")}` : ""}`,
    manage ? "EnvelopeListQualificationRuleHistory" : "EnvelopeListQualificationRuleVersion",
    open,
  );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("rulesHistory")}</summary>
      {open && (
        <div className="stack">
          <State query={query} />
          {query.data?.data.data.items.map((r) => (
            <article className="qualification-history" key={r.id}>
              <strong>
                {t(
                  r.id === level.ruleVersionId
                    ? "currentVersion"
                    : Date.parse(r.effectiveAt) > Date.now()
                      ? "scheduled"
                      : "historical",
                )}
              </strong>
              <p>
                {t("version")}: <code>{r.id}</code>
              </p>
              <p>
                {t("published")}: <Time value={r.publishedAt} />
              </p>
              {manage && "publisher" in r && (
                <p>
                  {t("publisher")}: <ActionActor actor={r.publisher} />
                </p>
              )}
              <p>
                {t("effective")}: <Time value={r.effectiveAt} />
              </p>
              <RulesView rules={r.rules} game={r.game} />
              <p>
                {t("thresholds")}: {r.requiredTrips ?? t("unset")} /{" "}
                {r.requiredDistanceM ?? t("unset")} m
              </p>
            </article>
          ))}
          <PageNav
            next={query.data?.data.data.nextCursor}
            hasPrevious={cursors.length > 0}
            onNext={(c) => setCursors((prev) => [...prev, c])}
            onPrevious={() => setCursors((prev) => prev.slice(0, -1))}
          />
        </div>
      )}
    </details>
  );
}
