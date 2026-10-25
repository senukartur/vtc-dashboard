import { type ReactNode, useState } from "react";
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
function EntityName({
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
    valid = entity?.game === game && entity.kind === kind;
  return (
    <>
      {valid ? entity.display.label : t("unknown")}
      {valid && entity.display.englishFallback ? ` · ${t("catalogs:fallback")}` : ""}
      {valid && entity.display.retired ? ` · ${t("catalogs:retired")}` : ""}
      <code>{id}</code>
    </>
  );
}
export function RuleHistory({ level }: { level: DTO["QualificationLevel"] }) {
  const { t } = useTranslation("qualifications"),
    [open, setOpen] = useState(false),
    [cursors, setCursors] = useState<string[]>([]);
  const query = useQualificationQuery(
    `/qualification-levels/${level.id}/rule-versions?limit=25${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? "")}` : ""}`,
    "EnvelopeListQualificationRuleVersion",
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
