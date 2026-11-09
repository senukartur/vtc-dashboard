import { type CatalogLabel, secondaryCityName } from "./native-name.js";

/** Muted canonical name after a label; renders nothing when it would only repeat the label. */
export function CatalogNativeName({ value }: { value: CatalogLabel | null | undefined }) {
  const name = secondaryCityName(value);
  return name ? <small className="catalog-native"> · {name}</small> : null;
}
