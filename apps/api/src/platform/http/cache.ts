// Shared HTTP cache policy. Every response is `no-store` unless it matches one of these exceptions.

/** Fingerprinted JS/CSS assets served by the built web root. */
export const assetCache = "public, max-age=31536000, immutable";

/** Short shared cache for anonymous company-aggregate summaries (no cookies, no identities). */
export const publicSummaryCache = "public, max-age=60";

/** Route patterns allowed to keep `publicSummaryCache` on a 200 response. */
export const publicSummaryRoutes: ReadonlySet<string> = new Set(["/api/v1/public/company-stats"]);

/** Whether a response may keep the Cache-Control value its handler set. */
export function keepsCacheControl(
  statusCode: number,
  cacheControl: unknown,
  routeUrl: string | undefined,
): boolean {
  if ([200, 206, 304].includes(statusCode) && cacheControl === assetCache) return true;
  return (
    statusCode === 200 &&
    cacheControl === publicSummaryCache &&
    routeUrl !== undefined &&
    publicSummaryRoutes.has(routeUrl)
  );
}
