import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogDTO } from "../../shared/catalog-selectors/contracts.js";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Table } from "../../shared/ui/primitives.js";
import { entityLabel, type LabelValue, labelChange, renderValue, stateTone } from "./model.js";

type Change = CatalogDTO["CatalogEntityChange"];
type Pack = CatalogDTO["CatalogCoveragePack"];

/** Tone, glyph and text together, so a state never depends on colour alone. */
export function StateBadge({ state, label }: { state: string; label: string }) {
  const { tone, glyph } = stateTone(state);
  return (
    <Badge size="xs" className={`catalog-tone-${tone}`}>
      <span aria-hidden="true">{glyph}</span> <span>{label}</span>
    </Badge>
  );
}

/** Wide review tables scroll inside a named, keyboard-focusable region; the page never does. */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling.
    <section className="catalog-scroll" aria-label={label} tabIndex={0}>
      {children}
    </section>
  );
}

export function Provenance({ items }: { items: CatalogDTO["CatalogProvenance"][] }) {
  const { t, i18n } = useTranslation("catalogs");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  if (!items.length) return <p className="catalog-muted">{t("noProvenance")}</p>;
  return (
    <ul className="catalog-provenance-list">
      {items.map((p) => (
        <li key={p.referenceId}>
          <a href={p.publicSourceUrl} target="_blank" rel="noreferrer">
            {p.publicSourceUrl}
          </a>
          <p>{p.attribution}</p>
          <p>{p.permittedUseBasis}</p>
          <time dateTime={p.observedAt}>{formatUtc(p.observedAt, locale, "UTC")} UTC</time>
        </li>
      ))}
    </ul>
  );
}

function useChangeType() {
  const { t } = useTranslation("catalogs");
  return (kind: Change["changeKind"]) => (
    <StateBadge state={kind} label={t(kind === "retired" ? "retiredCount" : kind)} />
  );
}

function EntityHeader({ change }: { change: Change }) {
  const label = entityLabel(change);
  return (
    <th scope="row">
      {label ?? <code>{change.entityId}</code>}
      {label && <code className="catalog-id">{change.entityId}</code>}
    </th>
  );
}

export function ChangesTable({ changes }: { changes: Change[] }) {
  const { t } = useTranslation("catalogs"),
    type = useChangeType();
  return (
    <Table size="xs" className="catalog-table catalog-changes-table">
      <thead>
        <tr>
          <th scope="col">{t("colEntity")}</th>
          <th scope="col">{t("colKind")}</th>
          <th scope="col">{t("changes")}</th>
          <th scope="col">{t("colType")}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.entityId}>
            <EntityHeader change={c} />
            <td>{t(c.kind)}</td>
            <td>
              {c.fields.length > 0 && (
                <dl className="catalog-fields">
                  {c.fields.map((f) => (
                    <div key={JSON.stringify([f.field, f.before, f.after])}>
                      <dt>{t(f.field)}</dt>
                      <dd>
                        {renderValue(f.before)} → {renderValue(f.after)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {c.reasonCodes.length > 0 && (
                <p className="catalog-muted">
                  {t("reasons")}: {c.reasonCodes.join(" · ")}
                </p>
              )}
            </td>
            <td>{type(c.changeKind)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LabelCell({ value, russian }: { value: LabelValue; russian: boolean }) {
  const { t } = useTranslation("catalogs");
  if (!value.returned) return <td className="catalog-muted">{t("labelUnchanged")}</td>;
  if (value.value !== null) return <td>{value.value}</td>;
  return (
    <td>
      {russian ? <span className="catalog-fallback">{t("fallback")}</span> : renderValue(null)}
    </td>
  );
}

/** Only changes that returned label fields; this is not a complete translation queue. */
export function TranslationsTable({ changes, more }: { changes: Change[]; more: boolean }) {
  const { t } = useTranslation("catalogs"),
    type = useChangeType();
  const rows = changes.flatMap((change) => {
    const labels = labelChange(change);
    return labels ? [{ change, labels }] : [];
  });
  // Later pages may still hold label changes, so "None" is final only after the last page.
  if (!rows.length) return <p>{t(more ? "noLabelsLoaded" : "none")}</p>;
  return (
    <ScrollRegion label={t("translations")}>
      <Table size="xs" className="catalog-table catalog-translations-table">
        <thead>
          <tr>
            <th scope="col">{t("colEntity")}</th>
            <th scope="col">{t("label_en")}</th>
            <th scope="col">{t("label_ru")}</th>
            <th scope="col">{t("colType")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ change, labels }) => (
            <tr key={change.entityId}>
              <EntityHeader change={change} />
              <LabelCell value={labels.en} russian={false} />
              <LabelCell value={labels.ru} russian />
              <td>{type(change.changeKind)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </ScrollRegion>
  );
}

export function CoverageTable({ packs }: { packs: Pack[] }) {
  const { t } = useTranslation("catalogs");
  return (
    <Table size="xs" className="catalog-table catalog-coverage-table">
      <thead>
        <tr>
          <th scope="col">{t("colPack")}</th>
          <th scope="col">{t("contribution")}</th>
          <th scope="col">{t("reasons")}</th>
          <th scope="col">{t("stateColumn")}</th>
        </tr>
      </thead>
      <tbody>
        {packs.map((pack) => (
          <tr key={pack.packId}>
            <th scope="row">
              {pack.title} · {pack.packId}
            </th>
            <td>{pack.contributionKinds.map((k) => t(k)).join(" · ") || t("none")}</td>
            <td>
              <span>{pack.reasonCodes.join(" · ") || "—"}</span>
              <details className="catalog-details">
                <summary>{t("provenanceCount", { n: pack.provenance.length })}</summary>
                <Provenance items={pack.provenance} />
              </details>
            </td>
            <td>
              <StateBadge
                state={pack.state}
                label={t(pack.state === "failed" ? "packFailed" : pack.state)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function MappingsTable({ children }: { children: ReactNode }) {
  const { t } = useTranslation("catalogs");
  return (
    <Table size="xs" className="catalog-table catalog-mappings-table">
      <thead>
        <tr>
          <th scope="col">{t("colSource")}</th>
          <th scope="col">{t("colCandidates")}</th>
          <th scope="col">{t("colContext")}</th>
          <th scope="col">{t("colDecision")}</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </Table>
  );
}
