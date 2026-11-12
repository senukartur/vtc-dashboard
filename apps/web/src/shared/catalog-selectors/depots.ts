import type { ComboboxOption } from "./combobox.js";
import type { CatalogDTO, Game } from "./contracts.js";

/** A company a depot picker offers: its canonical name and the code that tells namesakes apart. */
export type DepotCompanyOption = ComboboxOption;

/** Can this depot's company be newly chosen in the city? Hidden depots, companies or cities cannot. */
export function visibleDepot(depot: CatalogDTO["CatalogDepot"], game: Game, cityId: string) {
  return (
    depot.game === game &&
    depot.city.id === cityId &&
    !depot.hidden &&
    !depot.city.label.hidden &&
    !depot.company.label.hidden
  );
}

/** Distinct companies with a visible depot in the city, in server order. */
export function depotCompanyOptions(
  depots: readonly CatalogDTO["CatalogDepot"][],
  game: Game,
  cityId: string,
): DepotCompanyOption[] {
  const options = new Map<string, DepotCompanyOption>();
  for (const depot of depots)
    if (visibleDepot(depot, game, cityId) && !options.has(depot.company.id))
      options.set(depot.company.id, {
        id: depot.company.id,
        label: depot.company.label.label,
        code: depot.company.code,
      });
  return [...options.values()];
}

/** The field text of a chosen company; the code keeps two companies of one name apart. */
export const depotOptionText = (option: DepotCompanyOption) => `${option.label} · ${option.code}`;
