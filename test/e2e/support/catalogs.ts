import { inertNotifications } from "./notifications.ts";
import { switchLanguage } from "./locale.ts";
import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";

type S = components["schemas"];
export const catalogId = "61000000-0000-4000-8000-000000000020",
  candidateId = "62000000-0000-4000-8000-000000000020",
  entityId = "63000000-0000-4000-8000-000000000020",
  regionId = "64000000-0000-4000-8000-000000000020",
  operationId = "65000000-0000-4000-8000-000000000020",
  artifactId = "66000000-0000-4000-8000-000000000020";
export const revision = (
  id = catalogId,
  state: S["CatalogRevision"]["state"] = "published",
): S["CatalogRevision"] => ({
  id,
  version: 1,
  publicationVersion: 2,
  game: "ets2",
  state,
  coverageComplete: true,
  englishLabelsComplete: true,
  sourceReviewComplete: true,
  createdAt: "2026-10-20T00:00:00.000Z",
});
export const review: S["CatalogReview"] = {
  revisionId: candidateId,
  version: 1,
  comparisonRevisionId: catalogId,
  gameBuild: "Synthetic reviewed build",
  releaseInventoryAsOf: "2026-10-20",
  addedEntities: 2,
  changedEntities: 1,
  retiredEntities: 1,
  expectedPacks: 2,
  validatedPacks: 1,
  missingPacks: 0,
  failedPacks: 0,
  nonContributingPacks: 1,
  mappingIssues: 0,
  sourceReviewState: "approved",
  provenance: [],
};
export const envelope = (data: unknown) => ({
  data,
  meta: { requestId: "synthetic-catalog-request" },
});
export const list = (items: unknown[], nextCursor: string | null = null) =>
  envelope({ items, nextCursor });
export async function catalogLanguage(page: Page, locale: "ru" | "en" = "en") {
  await switchLanguage(page, locale);
}
/** Optional overrides; omitting them keeps the original synthetic responses unchanged. */
export type CatalogMockOptions = {
  /** Published revisions per game, current first. */
  revisions?: Partial<Record<S["CatalogRevision"]["game"], S["CatalogRevision"][]>>;
  candidate?: Partial<S["CatalogRevision"]>;
  review?: Partial<S["CatalogReview"]>;
  /** Replaces the session capabilities after the staff adjustment. */
  capabilities?: string[];
  /** Pathname suffix (after /api/v1) answered with this HTTP status instead. */
  failures?: Record<string, number>;
  /** Published revision discovery waits for this promise. */
  gate?: Promise<void>;
};
export async function mockCatalogs(page: Page, staff = true, options: CatalogMockOptions = {}) {
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) requests.push(url);
  });
  await page.route("**/api/v1/**", async (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (data: unknown) => route.fulfill({ json: data });
    const failure = Object.entries(options.failures ?? {}).find(([suffix]) =>
      path.endsWith(suffix),
    );
    if (failure)
      return route.fulfill({ status: failure[1], json: { error: { code: "PRIVATE_SENTINEL" } } });
    if (path === "/api/v1/me") {
      const self = accountFixture();
      if (staff) {
        self.data.member.roles = ["deputy_director"];
        self.data.capabilities.push("qualifications.manage");
      }
      if (options.capabilities)
        self.data.capabilities = options.capabilities as typeof self.data.capabilities;
      return json(self);
    }
    if (path === "/api/v1/auth/csrf") return json(envelope({ token: "NONFUNCTIONAL_FIXTURE" }));
    if (path === "/api/v1/catalogs/revisions") {
      if (options.gate) await options.gate;
      const game = url.searchParams.get("game") === "ats" ? "ats" : "ets2";
      return json(
        list(
          options.revisions?.[game] ?? (url.searchParams.get("game") === "ats" ? [] : [revision()]),
        ),
      );
    }
    if (path.startsWith("/api/v1/catalogs/entities")) {
      const historical = path !== "/api/v1/catalogs/entities",
        kind = url.searchParams.get("kind") ?? (path.endsWith(regionId) ? "region" : "city"),
        id = kind === "region" ? regionId : entityId,
        locale = url.searchParams.get("locale") === "ru" ? "ru" : "en";
      const entity = {
        id,
        revisionId: catalogId,
        game: "ets2",
        kind,
        mapNamespace: "base",
        display: {
          entityId: id,
          label: kind === "region" ? "Fictional region" : "Fictional city",
          requestedLocale: locale,
          renderedLocale: "en",
          englishFallback: locale === "ru",
          retired: false,
        },
        relatedEntityIds: kind === "region" ? [] : [regionId],
      };
      return json(
        historical
          ? envelope(entity)
          : list(url.searchParams.get("search") === "absent" ? [] : [entity]),
      );
    }
    if (path === "/api/v1/admin/catalog-import-policy")
      return json(
        envelope({
          enabled: true,
          maxFileBytes: 8388608,
          maxFilesPerReport: 1,
          allowedMimeTypes: ["application/json"],
          policyRevision: 1,
        }),
      );
    if (path === `/api/v1/admin/catalog-revisions/${candidateId}`)
      return route.fulfill({
        json: envelope({ ...revision(candidateId, "draft"), ...options.candidate }),
        headers: { ETag: '"v1"' },
      });
    if (path.endsWith("/review"))
      return route.fulfill({
        json: envelope({ ...review, ...options.review }),
        headers: { ETag: '"v1"' },
      });
    if (path.endsWith("/diff"))
      return json(
        list(
          [
            {
              entityId,
              kind: "city",
              changeKind: "changed",
              fields: [
                { field: "label_en", before: "Fictional old city", after: "Fictional city" },
                { field: "retired", before: false, after: true },
              ],
              reasonCodes: [],
            },
          ],
          url.searchParams.has("cursor") ? null : "synthetic-next",
        ),
      );
    if (path.endsWith("/coverage"))
      return json(
        list([
          {
            packId: "base",
            title: "Fictional base",
            state: "validated",
            contributionKinds: ["city"],
            provenance: [],
            reasonCodes: [],
          },
          {
            packId: "fictional-sounds",
            title: "Fictional sounds",
            state: "non_contributing",
            contributionKinds: [],
            provenance: [],
            reasonCodes: ["no_catalog_facts"],
          },
        ]),
      );
    if (path.endsWith("/mapping-issues")) return json(list([]));
    return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
  });
  return { requests };
}
