import { useQuery } from "@tanstack/react-query";
import { publicContent, type PublicLocale } from "./content.js";
import { readCompanyStats, statsView } from "./stats.js";

/**
 * VTC-052 public aggregates only. Loading, every failure and malformed data render nothing,
 * so an unavailable value is never shown as zero.
 */
export function StatsBand({ locale }: { locale: PublicLocale }) {
  const query = useQuery({
    queryKey: ["public-company-stats"],
    queryFn: ({ signal }) => readCompanyStats(signal),
    meta: { private: false },
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });
  if (!query.isSuccess) return null;
  const view = statsView(query.data, locale);
  return (
    <section className="landing-stats" aria-labelledby="landing-stats-title">
      <h2 id="landing-stats-title" className="visually-hidden">
        {publicContent[locale].statsTitle}
      </h2>
      {view.caption && <p className="landing-stats-caption">{view.caption}</p>}
      <dl>
        {view.tiles.map((tile) => (
          <div key={tile.key} className="landing-stat">
            <dt>{tile.label}</dt>
            <dd>{tile.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
