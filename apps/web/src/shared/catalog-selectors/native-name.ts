import type { components } from "@vtc/contracts";

export type CatalogLabel = components["schemas"]["CatalogLabel"];
const fold = (text: string) => text.normalize("NFC").toLowerCase();

/** The canonical city name to show beside a label; a case-only difference adds nothing. */
export function secondaryCityName(label: CatalogLabel | null | undefined) {
  const native = label?.nameNative;
  return native && fold(native) !== fold(label.label) ? native : null;
}

/** A label followed by its secondary canonical name, for places that can only hold text. */
export function cityNameText(label: CatalogLabel | null | undefined, unknown: string) {
  const secondary = secondaryCityName(label);
  return `${label?.label ?? unknown}${secondary ? ` · ${secondary}` : ""}`;
}
