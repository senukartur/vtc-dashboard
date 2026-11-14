import type { TFunction } from "i18next";
import { promotionReadyCount } from "../features/qualifications/promotion-summary.js";
import type { WorkspaceSummary } from "./workspace-summary.js";

export function navAttention(
  summary: WorkspaceSummary | undefined,
  id: string,
  label: string,
  t: TFunction<"core">,
  locale: string,
) {
  const counts = {
    myTrips: summary?.tripsNeedingFixes?.count,
    events: summary?.unansweredUpcomingEvents?.count,
    dispatch: summary?.reviewQueue?.count,
    applications: summary?.newApplicationsCount,
    promotions: promotionReadyCount(summary?.promotionsReady),
  };
  const key = Object.hasOwn(counts, id) ? (id as keyof typeof counts) : undefined;
  const count = key === undefined ? undefined : counts[key];
  return {
    supported: key !== undefined,
    label:
      key && count
        ? t(`nav.attention.${key}`, { label, total: new Intl.NumberFormat(locale).format(count) })
        : undefined,
    badge: count ? (
      <span className="nav-attention-badge" aria-hidden="true">
        {count > 99 ? "99+" : count}
      </span>
    ) : null,
  };
}
