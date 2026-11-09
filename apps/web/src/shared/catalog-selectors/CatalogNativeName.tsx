import { type CatalogLabel, secondaryCityName } from "./native-name.js";

/** Muted canonical name after a label; renders nothing when it would only repeat the label. */
export function CatalogNativeName({
  value,
  className,
}: {
  value: CatalogLabel | null | undefined;
  className: string;
}) {
  const name = secondaryCityName(value);
  return name ? <small className={className}> · {name}</small> : null;
}
