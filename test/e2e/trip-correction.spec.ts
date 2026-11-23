import type { Page, Request, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage, chooseCatalogRow, envelope, list } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { entities, mockReview, reviewIds } from "./support/review-ui.ts";
import {
  acceptedManualCorrectable,
  correctionDriverReason,
  correctionProposal,
  correctionProposalId,
  correctionReturnReason,
  needsFixEvidence,
  needsFixTelemetry,
  pendingCorrection,
  returnedTrip,
  type TripEnvelope,
  tripPageId,
  tripPrivate,
  unlistedCargoCode,
} from "./support/trip-page-fixtures.ts";
import { cargoId, example, mockTrips } from "./support/trip-ui.ts";

// VTC-169: the driver corrects their own trip; staff accept, return or reject. Fictional data only.
type S = components["schemas"];
const tripPath = `/account/trips/${tripPageId}`;
const correctPath = `${tripPath}/correct`;

/** The signed-in fixture member as the author (no staff capability), reading a mutable stub. */
async function author(page: Page, initial: TripEnvelope) {
  await mockTrips(page);
  const self = accountFixture("en");
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: {
        ...self,
        data: { ...self.data, preferences: { locale: "en", displayTimezone: "UTC" } },
      },
    }),
  );
  const state = {
    view: initial,
    proposals: [] as S["TripProposal"][],
    posts: [] as { body: Record<string, unknown>; headers: Record<string, string> }[],
  };
  await page.route(`**/api/v1/trips/${tripPageId}`, (route) =>
    route.fulfill({ json: state.view, headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/v1/trips/${tripPageId}/proposals?*`, (route) =>
    route.fulfill({ json: list(state.proposals) }),
  );
  await page.route(`**/api/v1/trips/${tripPageId}/corrections`, (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    state.posts.push({ body: request.postDataJSON(), headers: request.headers() });
    return route.fulfill({ status: 201, json: example("proposeTripCorrection:success") });
  });
  return state;
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
const banner = (page: Page) => page.locator(".trip-banner");
// The trip page's single status banner (variant A, VTC-170).
const statusBanner = (page: Page, name = "Trip status") =>
  page.getByRole("region", { name, exact: true });

test(
  "a returned telemetry trip names its unconfirmed facts and opens the correction page in both languages",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await author(page, needsFixTelemetry());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await expect(page.locator(".trip-detail-status")).toHaveText("Needs fixes");
    const box = statusBanner(page);
    await expect(box).toHaveAttribute("data-status", "needs_fix");
    await expect(box.locator(".trip-banner-text").first()).toHaveText(
      "Open the correction page, enter the unconfirmed facts and send the trip back.",
    );
    await expect(box).toContainText("What to fix: Whole-trip distance, km, Cargo");
    await expect(box.locator(".trip-detail-quote")).toHaveText(
      `"${correctionReturnReason}" · Whole-trip distance is unknown, Cargo is unknown`,
    );
    await expect(box.locator(".trip-banner-body > .trip-muted")).toContainText(
      "Fictional Stage Four Dispatcher",
    );
    // One action: the banner's button; the header repeats nothing while the trip needs fixes.
    const fix = page.getByRole("link", { name: "Correct the trip", exact: true });
    await expect(fix).toHaveCount(1);
    await expect(box.getByRole("link")).toHaveText("Correct the trip");
    await expect(fix).toHaveAttribute("href", correctPath);
    await expect(page.locator(".trip-correction-unconfirmed")).not.toHaveCount(0);
    await expect(page.locator('.trip-correction-unconfirmed[data-field="cargoId"]')).toContainText(
      "not confirmed",
    );
    await expect(
      page.getByRole("region", { name: "History", exact: true }).getByRole("listitem").last(),
    ).toContainText("Returned for fixes");
    await noOverflow(page);
    await shot(page, info, "trip-needs-fix-en");
    await catalogLanguage(page, "ru");
    await expect(page.locator(".trip-detail-status")).toHaveText("Нужно исправить");
    await expect(
      statusBanner(page, "Статус рейса").getByRole("link", { name: "Исправить рейс", exact: true }),
    ).toBeVisible();
    await expect(page.locator('.trip-correction-unconfirmed[data-field="cargoId"]')).toContainText(
      "не подтверждён",
    );
    await noOverflow(page);
    await shot(page, info, "trip-needs-fix-ru");
    await catalogLanguage(page);

    await fix.click();
    await expect(page).toHaveURL(new RegExp(`${correctPath}$`));
    await expect(page.getByRole("heading", { name: "Trip correction", exact: true })).toBeVisible();
    await expect(banner(page)).toContainText("Fictional Stage Four Dispatcher returned the trip");
    await expect(banner(page)).toContainText(`"${correctionReturnReason}"`);
    const distance = page.getByLabel("Whole-trip distance, km", { exact: true });
    await expect(distance).toHaveValue("251");
    await expect(page.locator("#correction-actualDistanceM-was")).toHaveText("Telemetry: 251 km");
    await expect(page.getByRole("combobox", { name: "Cargo", exact: true })).toHaveValue("");
    await expect(page.locator(".trip-correction-field[data-field=cargoId]")).toContainText(
      `Telemetry: '${unlistedCargoCode}' is not in the catalog`,
    );
    // Confirmed facts stay collapsed and read-only.
    const locked = page.locator(".trip-correction-locked details");
    await expect(locked).not.toHaveAttribute("open", "");
    await expect(locked.locator("summary")).toContainText("they cannot change");
    await expect(page.locator(".trip-correction-locked input")).toHaveCount(0);
    await expect(page.getByText("Screenshot (optional)", { exact: true })).toBeVisible();
    await expect(page.locator(".trip-correction-effective")).toHaveText(
      "The trip returns for review. Until the decision, the previous result stays in effect.",
    );
    await expect(page.getByRole("button", { name: "Send correction", exact: true })).toBeDisabled();
    await noOverflow(page);
    await shot(page, info, "trip-correct-en");

    await catalogLanguage(page, "ru");
    await expect(
      page.getByRole("heading", { name: "Исправление рейса", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#correction-actualDistanceM-was")).toContainText("Телеметрия:");
    await expect(page.locator(".trip-correction-effective")).toHaveText(
      "Рейс вернётся на проверку. До решения действует прежний результат.",
    );
    await expect(
      page.getByRole("button", { name: "Отправить исправление", exact: true }),
    ).toBeDisabled();
    await noOverflow(page);
    await shot(page, info, "trip-correct-ru");
  },
);

test(
  "the driver sends the entered facts with the trip version and sees the pending correction",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await author(page, needsFixTelemetry());
    await page.goto(correctPath);
    await catalogLanguage(page);
    const send = page.getByRole("button", { name: "Send correction", exact: true });
    await page.getByLabel("Whole-trip distance, km", { exact: true }).fill("0");
    await page.locator("#correction-reason").fill(correctionDriverReason);
    // Zero is not a distance: the field explains itself and nothing can be sent.
    await expect(page.locator("#correction-actualDistanceM-error")).toHaveText(
      "Enter a positive number.",
    );
    await expect(send).toBeDisabled();
    await page.getByLabel("Whole-trip distance, km", { exact: true }).fill("312");
    await chooseCatalogRow(page, "Cargo", "Fictional cargo");
    await expect(send).toBeEnabled();
    await send.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Staff will review these values:");
    await expect(dialog.locator("dt:text-is('Whole-trip distance, km') + dd")).toHaveText("312 km");
    await expect(dialog.locator("dt:text-is('Cargo') + dd")).toHaveText("Fictional cargo");
    state.view = pendingCorrection();
    state.proposals = [correctionProposal(cargoId)];
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${tripPath}$`));
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]?.body).toEqual({
      reason: correctionDriverReason,
      evidenceIds: [],
      actualDistanceM: "312000",
      cargoId,
    });
    expect(state.posts[0]?.headers["if-match"]).toBe('"v1"');
    expect(state.posts[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);

    await expect(page.locator(".trip-detail-status")).toHaveText("Pending review");
    const box = statusBanner(page);
    await expect(box).toHaveAttribute("data-status", "pending_review");
    await expect(box.locator(".trip-banner-title strong")).toHaveText("Correction under review");
    await expect(box.locator(".trip-banner-text")).toHaveText(
      "Until the decision, the previous result stays in effect.",
    );
    await expect(
      page.locator('.trip-correction-proposed[data-field="actualDistanceM"]'),
    ).toContainText("312 km · correction under review");
    await expect(page.locator('.trip-correction-proposed[data-field="cargoId"]')).toContainText(
      "Fictional cargo",
    );
    // A pending correction leaves nothing else to send.
    await expect(page.getByRole("link", { name: "Correct the trip", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "History", exact: true }).getByRole("listitem").last(),
    ).toContainText("Correction proposed");
    await page.goto(correctPath);
    await expect(
      page.getByText("This trip cannot be corrected now.", { exact: true }),
    ).toBeVisible();
  },
);

test(
  "an accepted report takes a proposal citing its screenshot; a final rejection offers no action",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await author(page, acceptedManualCorrectable());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await expect(page.locator(".trip-detail-status")).toHaveText("Accepted");
    await expect(statusBanner(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Fix the report", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Propose a correction", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${correctPath}$`));
    await expect(page.locator("#correction-actualDistanceM-was")).toHaveText("Report: 500 km");
    await expect(page.getByLabel("Cargo mass, t", { exact: true })).toHaveValue("18");
    await expect(
      page.getByText("Attach at least one screenshot of the report or a new one.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Cargo mass, t", { exact: true }).fill("19.5");
    await page.locator("#correction-reason").fill(correctionDriverReason);
    await page.getByRole("button", { name: "Send correction", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${tripPath}$`));
    // The report's ready screenshot is cited; prefilled values are proposed as shown.
    expect(state.posts[0]?.body).toEqual({
      reason: correctionDriverReason,
      evidenceIds: [needsFixEvidence.id],
      actualDistanceM: "500000",
      cargoMassKg: "19500",
    });

    // A declined correction reads in the history with the reviewer's comment, in EN and RU.
    state.proposals = [
      {
        ...correctionProposal(cargoId),
        state: "rejected",
        review: {
          decision: "reject",
          reason: "Fictional screenshot shows another cargo",
          decidedAt: "2026-11-12T12:00:00.000Z",
          reviewedRevisionId: "41500000-0000-4000-8000-000000000382",
          reviewerId: "41500000-0000-4000-8000-000000000003",
        },
      },
    ];
    await page.reload();
    const declined = page.locator('.trip-detail-history li[data-kind="correction_declined"]');
    await expect(declined).toContainText("Correction declined");
    await expect(declined.locator(".trip-detail-quote")).toHaveText(
      '"Fictional screenshot shows another cargo"',
    );
    await catalogLanguage(page, "ru");
    await expect(declined).toContainText("Исправление отклонено");
    await catalogLanguage(page);

    // A rejection without a return is final: no banner action and no correction page.
    state.view = returnedTrip();
    await page.reload();
    await expect(page.locator(".trip-detail-status")).toHaveText("Rejected");
    const box = statusBanner(page);
    await expect(box).toHaveAttribute("data-status", "rejected");
    await expect(box.locator(".trip-banner-text")).toHaveText(
      "The rejection is final; the trip does not count.",
    );
    await expect(box.getByRole("link")).toHaveCount(0);
    for (const name of ["Correct the trip", "Propose a correction", "Fix the report"])
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    await page.goto(correctPath);
    await expect(
      page.getByText("This trip cannot be corrected now.", { exact: true }),
    ).toBeVisible();
  },
);

test(
  "reviewers decide a driver's correction against telemetry and read the client's raw reasons",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const mock = await mockReview(page),
      state = mock.states.telemetry,
      trip = state.review.trip,
      telemetry = tripPrivate(needsFixTelemetry());
    trip.pendingProposalId = correctionProposalId;
    if (!telemetry.correction) throw new Error("SYNTHETIC_CORRECTION_REQUIRED");
    trip.correction = { ...telemetry.correction, canPropose: false };
    state.review.correctionReview = {
      blockedOnlyByEditable: true,
      canReturn: true,
      clientReasonCodes: ["trailer-context-unproven", "fixture-unlabelled-reason"],
      proposalAcceptance: { mode: "ordinary", blockedReasonCodes: [] },
    };
    const proposal = {
      ...correctionProposal(entities.lumber, reviewIds.telemetry),
      authorId: trip.summary.owner.id,
    };
    const decisions: Request[] = [];
    await page.route(
      `**/api/v1/trips/${reviewIds.telemetry}/proposals/${correctionProposalId}`,
      (route) => route.fulfill({ json: envelope(proposal), headers: { ETag: '"v1"' } }),
    );
    await page.route(
      `**/api/v1/trips/${reviewIds.telemetry}/proposals/${correctionProposalId}/decisions`,
      (route) => {
        decisions.push(route.request());
        return route.fulfill({
          json: envelope({
            ...proposal,
            state: "rejected",
            review: {
              decision: "reject",
              reviewedRevisionId: proposal.revisionId,
              reviewerId: accountFixture("en").data.member.id,
              reason: "Fictional distance still unproven",
              decidedAt: "2026-11-12T12:00:00.000Z",
            },
          }),
          headers: { ETag: '"v2"' },
        });
      },
    );
    await page.goto(`/account/review/${reviewIds.telemetry}`);
    await catalogLanguage(page);
    const comparison = page.locator(".review-correction");
    await expect(comparison).toBeVisible();
    const distance = comparison.locator("tr[data-field=actualDistanceM]");
    await expect(distance.getByRole("cell").first()).toContainText("251 km");
    await expect(distance.getByRole("cell").last()).toContainText("312 km");
    const cargo = comparison.locator("tr[data-field=cargoId]");
    await expect(cargo.getByRole("cell").first()).toContainText(unlistedCargoCode);
    await expect(cargo.getByRole("cell").last()).toContainText("Fictional lumber");
    await expect(comparison).toContainText(`Driver's reason: ${correctionDriverReason}`);
    const reasons = page.locator(".review-client-reasons");
    await expect(reasons.locator("li[data-code=trailer-context-unproven]")).toContainText(
      "Trailer context is not proven",
    );
    await expect(reasons.locator("li[data-code=fixture-unlabelled-reason]")).toContainText(
      "Unlabelled client code",
    );
    // Accept, return for fixes and a final rejection; the old staff edit block is gone.
    await expect(page.locator(".review-choice-item")).toHaveText([
      "Accept",
      "Return for fixes",
      "Reject",
    ]);
    await expect(page.locator("details.review-corrections")).toHaveCount(0);
    await noOverflow(page);
    await shot(page, info, "review-correction-en");

    await page.locator("#review-choice-return").click();
    await expect(page.locator("[data-help=return]")).toHaveText(
      "The driver can correct the trip and send it back.",
    );
    await page.locator("#review-reason").fill("Fictional distance still unproven");
    await page.getByRole("button", { name: "Return trip", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]?.postDataJSON()).toEqual({
      decision: "reject",
      reviewedRevisionId: proposal.revisionId,
      reason: "Fictional distance still unproven",
      tripDecision: "returned_for_fixes",
    });

    await catalogLanguage(page, "ru");
    await expect(page.locator(".review-choice-item")).toHaveText([
      "Принять",
      "Вернуть на исправление",
      "Отклонить",
    ]);
    await expect(page.locator(".review-client-reasons")).toBeVisible();
    await noOverflow(page);
    await shot(page, info, "review-correction-ru");
  },
);
