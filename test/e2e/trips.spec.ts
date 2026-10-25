import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import { catalogLanguage, entityId, envelope } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import {
  cargoId,
  completeForm,
  evidenceId,
  example,
  id,
  mockTrips,
  trailerId,
} from "./support/trip-ui.ts";

test("controlled trip list preserves zero, bilingual long labels, responsive overflow and keyboard navigation", async ({
  page,
}, info) => {
  await mockTrips(page);
  await page.goto("/account/trips");
  await catalogLanguage(page);
  await expect(page.getByRole("heading", { name: "Trips", exact: true })).toBeVisible();
  await expect(page.getByText("0 km", { exact: true })).toBeVisible();
  for (const locale of ["en", "ru"] as const) {
    await catalogLanguage(page, locale);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`trips-${locale}.png`), fullPage: true });
  }
  await catalogLanguage(page);
  await page.getByRole("combobox", { name: "Game", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Company decision", exact: true })).toBeFocused();
});
test("controlled report validates undated fields and identical uncertain retries versus changed payload", async ({
  page,
}, info) => {
  await mockTrips(page);
  let calls = 0;
  const keys: string[] = [];
  await page.route("**/api/v1/manual-reports", async (route) => {
    calls++;
    keys.push(route.request().headers()["idempotency-key"] as string);
    if (calls <= 2) return route.abort("failed");
    return route.fulfill({ status: 201, json: example("submitManualReport:success") });
  });
  await page.goto("/account/reports/new");
  await catalogLanguage(page);
  await completeForm(page);
  for (const locale of ["en", "ru"] as const) {
    await catalogLanguage(page, locale);
    await expect(page.locator("#manual-game")).toHaveValue("ets2");
    const labels =
      locale === "en"
        ? ["Origin city", "Destination city", "Cargo", "Trailer type"]
        : ["Город отправления", "Город назначения", "Груз", "Тип прицепа"];
    for (const [index, label] of labels.entries())
      await expect(page.getByRole("combobox", { name: label, exact: true })).toHaveValue(
        index === 2 ? cargoId : index === 3 ? trailerId : entityId,
      );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`report-${locale}.png`), fullPage: true });
  }
  await catalogLanguage(page);
  await expect(page.locator('input[type="date"],input[type="datetime-local"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("result is uncertain");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Comment (optional)", { exact: true }).fill("Changed synthetic report");
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => calls).toBe(3);
  expect(keys[2]).not.toBe(keys[1]);
});
test("controlled 409 closes obsolete confirmation, retains reason and requires fresh exact version", async ({
  page,
}) => {
  await mockTrips(page);
  let version = 1,
    decisions = 0;
  const seen: string[] = [];
  const review = example("getTripReview:success");
  review.data.canDecide = true;
  await page.route(`**/api/v1/trips/${id}/review`, (r) => {
    review.data.trip.summary.version = version;
    return r.fulfill({ json: review, headers: { ETag: `"v${version}"` } });
  });
  await page.route(`**/api/v1/trips/${id}/decisions`, (r) => {
    decisions++;
    seen.push(r.request().headers()["if-match"] as string);
    if (decisions === 1) {
      version = 2;
      return r.fulfill({ status: 409, json: { error: { code: "PRIVATE_SENTINEL" } } });
    }
    return r.fulfill({ json: example("decideTrip:success") });
  });
  await page.goto(`/account/review/${id}`);
  await catalogLanguage(page);
  await page.locator("#review-reason").fill("Retained explanation");
  await page.getByRole("button", { name: "Reject trip", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#review-reason")).toHaveValue("Retained explanation");
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
  await page.getByRole("button", { name: "Reject trip", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => decisions).toBe(2);
  expect(seen).toEqual(['"v1"', '"v2"']);
});
test("controlled disabled upload, 429 delay, evidence expiry and permission failures remain safe", async ({
  page,
}) => {
  await mockTrips(page);
  await page.route("**/api/v1/me/upload-policy", (r) =>
    r.fulfill({
      json: envelope({
        enabled: false,
        maxFileBytes: null,
        maxFilesPerReport: null,
        allowedMimeTypes: [],
        policyRevision: 1,
      }),
    }),
  );
  await page.goto("/account/reports/new");
  await catalogLanguage(page);
  await expect(page.getByText("Uploads are unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.route("**/api/v1/me/manual-drafts", (r) =>
    r.fulfill({
      status: 429,
      headers: { "Retry-After": "2" },
      json: { error: { code: "PRIVATE_SENTINEL" } },
    }),
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Retry in");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
  await page.route("**/api/v1/trips?*", (r) =>
    r.fulfill({ status: 403, json: { error: { code: "PRIVATE_SENTINEL" } } }),
  );
  await page.goto("/account/trips");
  await expect(page.getByRole("alert")).toContainText("permissions");
  await expect(page.getByText("Fictional North", { exact: false })).toHaveCount(0);
});

test("controlled private evidence expiry is explicit and unavailable reads retain a safe retry", async ({
  page,
}) => {
  await mockTrips(page);
  const view = example("getTrip:extended-manual-revision");
  view.data.evidence = [
    {
      id: evidenceId,
      state: "ready",
      contentType: "image/png",
      byteLength: pngBytes().length,
      originalName: "synthetic.png",
    },
  ];
  await page.route(`**/api/v1/trips/${id}`, (r) =>
    r.fulfill({ json: view, headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/v1/evidence/${evidenceId}/content`, (r) =>
    r.fulfill({ status: 410, json: { error: { code: "EVIDENCE_EXPIRED" } } }),
  );
  await page.goto(`/account/trips/${id}`);
  await catalogLanguage(page);
  await page.getByRole("button", { name: "Download private image", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Image expired");
  await page.route(`**/api/v1/trips/${id}`, (r) =>
    r.fulfill({
      status: 503,
      headers: { "Retry-After": "2" },
      json: { error: { code: "PRIVATE_SENTINEL" } },
    }),
  );
  await page.reload();
  await catalogLanguage(page);
  await expect(page.getByRole("alert")).toContainText("service is unavailable");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});

test("controlled private refresh403 removes every privileged section without a request loop and401 ends the session", async ({
  page,
}) => {
  await mockTrips(page);
  const view = example("getTrip:extended-manual-revision");
  view.data.manualRevision.fields.comment = "Fictional private retained comment";
  let deny = false,
    calls = 0,
    revoked = false;
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({
      status: revoked ? 401 : 200,
      json: revoked ? { error: { code: "PRIVATE_SENTINEL" } } : accountFixture("en"),
    }),
  );
  await page.route(`**/api/v1/trips/${id}`, (r) => {
    calls++;
    return r.fulfill(
      deny
        ? { status: revoked ? 401 : 403, json: { error: { code: "PRIVATE_SENTINEL" } } }
        : { json: view, headers: { ETag: '"v1"' } },
    );
  });
  await page.goto(`/account/trips/${id}`);
  await expect(page.getByText("Fictional private retained comment", { exact: true })).toBeVisible();
  deny = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("permissions");
  await expect(page.getByText("Fictional private retained comment", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Completion screenshots", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Decision history", exact: true })).toHaveCount(0);
  const deniedCalls = calls;
  await page.waitForTimeout(250);
  expect(calls).toBe(deniedCalls);
  revoked = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("Fictional private retained comment", { exact: true })).toHaveCount(
    0,
  );
});

test("controlled revision conflict preserves input when staff accepted the report and requires the correction path", async ({
  page,
}) => {
  await mockTrips(page);
  let accepted = false;
  const report = example("getManualReport:success").data,
    view = example("getTrip:extended-manual-revision");
  const pin = (entityId: string) => ({
    status: "resolved",
    entityId,
    catalogRevisionId: "61000000-0000-4000-8000-000000000020",
  });
  const fields = {
    game: "ets2",
    origin: pin(entityId),
    destination: pin(entityId),
    cargo: pin(cargoId),
    trailerType: pin(trailerId),
    cargoMassKg: "1000",
    actualDistanceM: "100",
    evidenceIds: [evidenceId],
    eventId: null,
    comment: "Fictional original",
  };
  report.id = id;
  report.tripId = id;
  report.version = 1;
  report.tripVersion = 1;
  report.currentRevision = {
    representation: "extended",
    id: "45000000-0000-4000-8000-000000000030",
    reportId: id,
    number: 1,
    submittedAt: "2026-10-24T12:00:00.000Z",
    fields,
  };
  view.data.manualRevision = report.currentRevision;
  view.data.summary.owner = accountFixture("en").data.member;
  view.data.summary.id = id;
  view.data.evidence = [];
  await page.route(`**/api/v1/manual-reports/${id}`, (r) =>
    r.fulfill({ json: envelope(report), headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/v1/trips/${id}`, (r) => {
    view.data.summary.decision = accepted ? "accepted" : "pending_review";
    view.data.summary.version = accepted ? 2 : 1;
    return r.fulfill({ json: view, headers: { ETag: accepted ? '"v2"' : '"v1"' } });
  });
  await page.route(`**/api/v1/manual-reports/${id}/revisions`, (r) => {
    accepted = true;
    return r.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
  });
  await page.goto(`/account/reports/${id}/edit`);
  await page
    .getByLabel("Comment (optional)", { exact: true })
    .fill("Fictional retained edit after acceptance race");
  await expect(
    page.getByRole("button", { name: "Revise and resubmit", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Revise and resubmit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Comment (optional)", { exact: true })).toHaveValue(
    "Fictional retained edit after acceptance race",
  );
  await expect(page.getByLabel("Comment (optional)", { exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Request correction", exact: true })).toHaveAttribute(
    "href",
    `/account/trips/${id}`,
  );
});

test("controlled delayed upload checksum cannot start CSRF or POST after session loss unmounts its owner", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const state = window as unknown as {
      resumeTripDigest?: () => void;
      tripDigestStarted?: boolean;
      tripDigestSettled?: boolean;
    };
    Object.defineProperty(crypto.subtle, "digest", {
      value: async (algorithm: AlgorithmIdentifier, bytes: BufferSource) => {
        state.tripDigestStarted = true;
        await new Promise<void>((resolve) => {
          state.resumeTripDigest = resolve;
        });
        const result = await original(algorithm, bytes);
        state.tripDigestSettled = true;
        return result;
      },
    });
  });
  await mockTrips(page);
  let ended = false;
  await page.route("**/api/v1/me", (r) =>
    r.fulfill(
      ended
        ? { status: 401, json: { error: { code: "PRIVATE_SENTINEL" } } }
        : { json: accountFixture("en") },
    ),
  );
  await page.goto("/account/reports/new");
  await catalogLanguage(page);
  await page
    .getByLabel("Choose completion screenshot", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
  let commands = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path === "/api/v1/auth/csrf" ||
      (path === "/api/v1/evidence" && request.method() === "POST")
    )
      commands++;
  });
  await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { tripDigestStarted?: boolean }).tripDigestStarted),
    )
    .toBe(true);
  expect(commands).toBe(0);
  ended = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { resumeTripDigest?: () => void }).resumeTripDigest?.(),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { tripDigestSettled?: boolean }).tripDigestSettled),
    )
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(commands).toBe(0);
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
});

test("controlled upload retries bind actual bytes despite identical file metadata", async ({
  page,
}) => {
  await mockTrips(page);
  const keys: string[] = [];
  await page.route("**/api/v1/evidence", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"] as string);
    return route.abort("failed");
  });
  await page.goto("/account/reports/new");
  await catalogLanguage(page);
  const bytes = Array.from(pngBytes()),
    input = page.getByLabel("Choose completion screenshot", { exact: true });
  const choose = async (data: number[]) =>
    input.evaluate((element, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "synthetic.png", {
          type: "image/png",
          lastModified: 1700000000000,
        }),
      );
      (element as HTMLInputElement).files = transfer.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, data);
  await choose(bytes);
  for (let n = 1; n <= 2; n++) {
    await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
    await expect.poll(() => keys.length).toBe(n);
    await expect(page.getByRole("alert").filter({ hasText: "uncertain" })).toBeVisible();
  }
  expect(keys[1]).toBe(keys[0]);
  const different = [...bytes];
  different[different.length - 1] = (different.at(-1) ?? 0) ^ 1;
  await choose(different);
  await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
});

test("controlled checksum failure retains the selected file and shows a safe error before network writes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto.subtle, "digest", {
      value: async () => {
        throw Error("SYNTHETIC_FILE_READ_FAILURE");
      },
    }),
  );
  await mockTrips(page);
  await page.goto("/account/reports/new");
  await catalogLanguage(page);
  const input = page.getByLabel("Choose completion screenshot", { exact: true });
  await input.setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: pngBytes() });
  let commands = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path === "/api/v1/auth/csrf" ||
      (path === "/api/v1/evidence" && request.method() === "POST")
    )
      commands++;
  });
  await page.getByRole("button", { name: "Upload screenshot", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the required fields" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload screenshot", exact: true })).toBeEnabled();
  expect(await input.evaluate((element) => (element as HTMLInputElement).files?.length)).toBe(1);
  expect(commands).toBe(0);
  await expect(page.locator("body")).not.toContainText("SYNTHETIC_FILE_READ_FAILURE");
});
