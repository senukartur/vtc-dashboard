// Shared HTTP cache policy. Every response is `no-store` unless it matches one of these exceptions.

/**
 * Fingerprinted JS/CSS bundles and MP4/WebP media served by the built web root, also on Range
 * (206) responses.
 */
export const assetCache = "public, max-age=31536000, immutable";

/** Short shared cache for anonymous company-aggregate summaries (no cookies, no identities). */
export const publicSummaryCache = "public, max-age=60";

/** Route patterns allowed to keep `publicSummaryCache` on a 200 response. */
export const publicSummaryRoutes: ReadonlySet<string> = new Set(["/api/v1/public/company-stats"]);

/**
 * Authenticated company logo images. A request that names the current version may be reused for
 * a day; any other request must revalidate. Both stay private to the browser.
 */
export const logoVersionedCache = "private, max-age=86400";
export const logoRevalidateCache = "private, no-cache";

/** Route patterns allowed to keep a logo policy on a 200 or 304 response. */
export const logoRoutes: ReadonlySet<string> = new Set(["/api/v1/catalogs/companies/:id/logo"]);

/** Whether a response may keep the Cache-Control value its handler set. */
export function keepsCacheControl(
  statusCode: number,
  cacheControl: unknown,
  routeUrl: string | undefined,
): boolean {
  if ([200, 206, 304].includes(statusCode) && cacheControl === assetCache) return true;
  if (
    (statusCode === 200 || statusCode === 304) &&
    (cacheControl === logoVersionedCache || cacheControl === logoRevalidateCache) &&
    routeUrl !== undefined &&
    logoRoutes.has(routeUrl)
  )
    return true;
  return (
    statusCode === 200 &&
    cacheControl === publicSummaryCache &&
    routeUrl !== undefined &&
    publicSummaryRoutes.has(routeUrl)
  );
}
