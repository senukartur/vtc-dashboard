// Each case declares its purpose; filenames are deliberately not policy inputs.
export const browserSmokeAreas = [
  "public",
  "account",
  "admissions",
  "members",
  "settings",
  "catalogs",
  "dashboard",
  "drivers",
  "events",
  "notifications",
  "qualifications",
  "trip-list",
  "manual-report",
  "review",
  "foundation",
  "readiness",
  "navigation",
] as const;
const categories = ["@layout", "@functional", "@real", "@probe"];
const scopes = [
  "@viewport-desktop",
  "@viewport-mobile",
  "@viewport-non-mobile",
  "@viewport-narrow",
];
const smokeTags = browserSmokeAreas.map((area) => `@smoke-${area}`);

export function assertBrowserPolicy(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((tag) => typeof tag !== "string") ||
    new Set(value).size !== value.length ||
    value.some((tag) => ![...categories, ...scopes, ...smokeTags].includes(tag)) ||
    value.filter((tag) => categories.includes(tag)).length !== 1 ||
    value.filter((tag) => scopes.includes(tag)).length > 1 ||
    (value.some((tag) => scopes.includes(tag)) && !value.includes("@layout")) ||
    value.filter((tag) => smokeTags.includes(tag)).length > 1 ||
    (value.some((tag) => smokeTags.includes(tag)) && !value.includes("@functional"))
  )
    throw new Error("INVALID_BROWSER_POLICY");
}

// Metadata is evaluated at the declaration, while Playwright receives the original test function.
// Wrapping test() itself changes source locations and breaks safe diagnostic provenance.
export function browserCase(tags: string[]) {
  assertBrowserPolicy(tags);
  return { tag: tags };
}

export const browserProjectPolicy = {
  "desktop-chromium": { grepInvert: /@viewport-(?:mobile|narrow)\b/ },
  "tablet-chromium": {
    grep: /@layout\b|@probe\b/,
    grepInvert: /@viewport-(?:desktop|mobile)\b/,
  },
  "mobile-chromium": {
    grep: /@layout\b|@smoke-[a-z-]+\b|@probe\b/,
    grepInvert: /@viewport-(?:desktop|non-mobile)\b/,
  },
};
