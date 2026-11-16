// Exact distance strings in metres, folded in tenths with BigInt so no float drift occurs.

export function decimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === 0 || value === "0") return "0";
  const str = typeof value === "number" ? value.toFixed(1) : String(value);
  const clean = str.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  return clean === "" || clean === "-0" ? "0" : clean;
}

const parseScaled = (s: string) => {
  const clean = decimal(s);
  if (clean === "0") return 0n;
  const [whole = "0", frac = ""] = clean.split(".");
  const fracPadded = `${frac}0`.slice(0, 1);
  return BigInt(whole) * 10n + BigInt(fracPadded);
};

const formatScaled = (value: bigint) => {
  if (value === 0n) return "0";
  const whole = value / 10n;
  const frac = value % 10n;
  return frac === 0n ? whole.toString() : `${whole}.${frac}`;
};

export function addDistances(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}

/** a - b in tenths; a negative result means the inputs do not nest and is a server error. */
export function subtractDistances(a: string, b: string): string {
  const difference = parseScaled(a) - parseScaled(b);
  if (difference < 0n) throw new Error("ANALYTICS_BREAKDOWN_INVARIANT");
  return formatScaled(difference);
}
