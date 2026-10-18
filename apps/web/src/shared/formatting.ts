export type Locale = "ru" | "en";
const localeTag = { ru: "ru-RU", en: "en-GB" } as const;
const missing = { ru: "Недоступно", en: "Unavailable" } as const;

/** Lossless base-10 division by powers of ten. No canonical quantity passes through Number. */
export function decimalShift(value: string, places: number): string {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
    !Number.isInteger(places) ||
    places < 0 ||
    places > 9
  )
    throw new Error("INVALID_DECIMAL");
  const [integer = "0", fraction = ""] = value.split(".");
  const digits = integer.padStart(places + 1, "0");
  const whole = places ? digits.slice(0, -places) : digits;
  const decimals = `${places ? digits.slice(-places) : ""}${fraction}`.replace(/0+$/, "");
  return `${whole}${decimals ? `.${decimals}` : ""}`;
}

export function formatDecimal(value: string | null, locale: Locale): string {
  if (value === null) return missing[locale];
  const canonical = decimalShift(value, 0);
  const [integer = "0", fraction] = canonical.split(".");
  const formatter = new Intl.NumberFormat(localeTag[locale]);
  const separator =
    new Intl.NumberFormat(localeTag[locale], { minimumFractionDigits: 1 })
      .formatToParts(1)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return `${formatter.format(BigInt(integer))}${fraction ? `${separator}${fraction}` : ""}`;
}

export function formatQuantity(value: string | null, unit: "km" | "t", locale: Locale): string {
  if (value === null) return missing[locale];
  return `${formatDecimal(decimalShift(value, 3), locale)} ${unit === "km" ? (locale === "ru" ? "км" : "km") : locale === "ru" ? "т" : "t"}`;
}

export function formatUtc(value: string | null, locale: Locale, timeZone: string): string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return missing[locale];
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19))
    return missing[locale];
  try {
    return new Intl.DateTimeFormat(localeTag[locale], {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date);
  } catch {
    return missing[locale];
  }
}

/** Approximation is permitted only for chart geometry; use exact strings for all visible values. */
export function chartGeometry(value: string): number | null {
  decimalShift(value, 0);
  const converted = Number(value);
  return Number.isFinite(converted) && converted <= Number.MAX_SAFE_INTEGER ? converted : null;
}
