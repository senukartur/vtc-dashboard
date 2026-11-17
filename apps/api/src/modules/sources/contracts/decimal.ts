const NON_NEGATIVE_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Validates that a string is a well-formed non-negative decimal quantity.
 */
export function isValidNonNegativeDecimal(value: unknown): value is string {
  return typeof value === "string" && NON_NEGATIVE_DECIMAL_REGEX.test(value);
}

/**
 * Compares two non-negative decimal strings exactly without converting to IEEE 754 numbers.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 *
 * @throws {Error} If either input is not a valid non-negative decimal string.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (!isValidNonNegativeDecimal(a) || !isValidNonNegativeDecimal(b)) {
    throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  }

  const [intA = "0", fracA = ""] = a.split(".");
  const [intB = "0", fracB = ""] = b.split(".");

  // 1. Compare integer parts by length first (eliminates need for BigInt conversion)
  if (intA.length < intB.length) return -1;
  if (intA.length > intB.length) return 1;

  // Same length integer parts can be compared lexicographically
  if (intA < intB) return -1;
  if (intA > intB) return 1;

  // 2. Integer parts are identical; compare fractional parts by right-padding with zeroes
  const maxFractionLength = Math.max(fracA.length, fracB.length);
  const paddedFracA = fracA.padEnd(maxFractionLength, "0");
  const paddedFracB = fracB.padEnd(maxFractionLength, "0");

  if (paddedFracA < paddedFracB) return -1;
  if (paddedFracA > paddedFracB) return 1;

  return 0;
}

/**
 * Performs lossless base-10 shifting on a non-negative decimal string.
 * Positive places shift the decimal point to the left (divide by 10^places).
 * Negative places shift the decimal point to the right (multiply by 10^|places|).
 * Zero places canonicalizes the decimal (removes redundant leading and trailing zeroes).
 *
 * @throws {Error} If value is invalid or places is outside supported range [-18, 18].
 */
export function shiftDecimal(value: string, places: number): string {
  if (!isValidNonNegativeDecimal(value)) {
    throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  }
  if (!Number.isInteger(places) || places < -18 || places > 18) {
    throw new Error("INVALID_DECIMAL_SHIFT_PLACES");
  }

  const [integer = "0", fraction = ""] = value.split(".");

  if (places === 0) {
    const cleanInteger = integer.replace(/^0+(?=\d)/, "") || "0";
    const cleanFraction = fraction.replace(/0+$/, "");
    return cleanFraction ? `${cleanInteger}.${cleanFraction}` : cleanInteger;
  }

  if (places > 0) {
    // Shifting decimal point to the left (divide by 10^places)
    const padded = integer.padStart(places + 1, "0");
    const whole = padded.slice(0, -places).replace(/^0+(?=\d)/, "") || "0";
    const decimals = `${padded.slice(-places)}${fraction}`.replace(/0+$/, "");
    return decimals ? `${whole}.${decimals}` : whole;
  }

  // places < 0: Shifting decimal point to the right (multiply by 10^|places|)
  const shift = -places;
  if (fraction.length <= shift) {
    const wholeDigits = `${integer}${fraction.padEnd(shift, "0")}`;
    const whole = wholeDigits.replace(/^0+(?=\d)/, "") || "0";
    return whole;
  }
  const wholeDigits = `${integer}${fraction.slice(0, shift)}`;
  const whole = wholeDigits.replace(/^0+(?=\d)/, "") || "0";
  const decimals = fraction.slice(shift).replace(/0+$/, "");
  return decimals ? `${whole}.${decimals}` : whole;
}

/**
 * Subtracts non-negative decimal string b from a (a - b) exactly using BigInt digit alignment.
 * Requires a >= b.
 *
 * @throws {Error} If inputs are invalid or a < b.
 */
export function subtractDecimal(a: string, b: string): string {
  if (!isValidNonNegativeDecimal(a) || !isValidNonNegativeDecimal(b)) {
    throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  }
  if (compareDecimal(a, b) < 0) {
    throw new Error("SUBTRACTION_UNDERFLOW");
  }

  const [intA = "0", fracA = ""] = a.split(".");
  const [intB = "0", fracB = ""] = b.split(".");

  const maxFrac = Math.max(fracA.length, fracB.length);
  const digitsA = BigInt(`${intA}${fracA.padEnd(maxFrac, "0")}`);
  const digitsB = BigInt(`${intB}${fracB.padEnd(maxFrac, "0")}`);

  const diff = digitsA - digitsB;
  if (diff === 0n) return "0";

  const diffStr = diff.toString().padStart(maxFrac + 1, "0");
  if (maxFrac === 0) return diffStr;

  const whole = diffStr.slice(0, -maxFrac);
  const frac = diffStr.slice(-maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Losslessly converts kilograms (kg) to metric tonnes (t) by dividing by 1000.
 */
export function kgToTon(kg: string): string {
  return shiftDecimal(kg, 3);
}

/**
 * Losslessly converts metric tonnes (t) to kilograms (kg) by multiplying by 1000.
 */
export function tonToKg(ton: string): string {
  return shiftDecimal(ton, -3);
}

/**
 * Canonicalizes a non-negative decimal string (removes redundant leading/trailing zeros).
 */
export function canonicalDecimal(value: string): string {
  return shiftDecimal(value, 0);
}
