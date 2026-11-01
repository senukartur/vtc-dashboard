import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO } from "../../shared/catalog-selectors/contracts.js";
import { kinds } from "../../shared/catalog-selectors/contracts.js";
import {
  CatalogSelector,
  type Game,
  type Kind,
  type Selection,
} from "../../shared/catalog-selectors/index.js";
import { Card, Label, Select } from "../../shared/ui/primitives.js";

/** Published-value search. It stays mounted so selector reads survive review navigation. */
export function CatalogSearch({
  game,
  list,
  active,
  onRevision,
  kind,
  onKind,
  region,
  onRegion,
  value,
  onValue,
}: {
  game: Game;
  list: CatalogDTO["CatalogRevision"][];
  active: string;
  onRevision: (id: string) => void;
  kind: Kind;
  onKind: (kind: Kind) => void;
  region: Selection | null;
  onRegion: (value: Selection | null) => void;
  value: Selection | null;
  onValue: (value: Selection | null) => void;
}) {
  const { t } = useTranslation("catalogs"),
    headingId = useId();
  return (
    <Card className="catalog-card catalog-search" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("searchTitle")}</h2>
      <div className="catalog-search-grid">
        <div className="catalog-field">
          <Label htmlFor="catalog-revision">{t("revision")}</Label>
          <Select
            id="catalog-revision"
            value={active}
            disabled={!list.length}
            onChange={(e) => onRevision(e.target.value)}
          >
            {!list.length && <option value="">{t("noPublication")}</option>}
            {list.map((r, i) => (
              <option value={r.id} key={r.id}>
                {i === 0 ? t("current") : r.createdAt} · {r.id}
              </option>
            ))}
          </Select>
        </div>
        <div className="catalog-field">
          <Label htmlFor="catalog-kind">{t("kind")}</Label>
          <Select id="catalog-kind" value={kind} onChange={(e) => onKind(e.target.value as Kind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </Select>
        </div>
        {kind === "city" && (
          <CatalogSelector
            key={`${game}-${active}`}
            label={t("regionFilter")}
            game={game}
            revisionId={active}
            kind="region"
            value={region}
            onChange={onRegion}
          />
        )}
        <CatalogSelector
          label={t(kind)}
          game={game}
          revisionId={active}
          kind={kind}
          regionId={kind === "city" && region?.revisionId === active ? region.entityId : undefined}
          value={value}
          onChange={onValue}
        />
      </div>
    </Card>
  );
}
