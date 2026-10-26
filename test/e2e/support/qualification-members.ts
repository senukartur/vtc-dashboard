import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page, Request, Response, TestInfo } from "@playwright/test";
import { type DTO, schema } from "../../../apps/web/src/features/qualifications/transport.ts";
import { expect } from "./fixtures.ts";

type Members = DTO["EnvelopeListMemberSummary"]["data"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const cursorHash = (cursor: string | null) => (cursor === null ? null : digest(cursor));
const rows = (ids: string[], target: string) => ({
  rowCount: ids.length,
  rowHashes: ids.map(digest),
  rowSetHash: digest(JSON.stringify(ids)),
  targetPresent: ids.includes(target),
});
const memberRequest = (request: Request) =>
  request.method() === "GET" &&
  new URL(request.url()).pathname === "/api/v1/admin/qualification-members";

export async function owningMemberPages(
  read: (cursor?: string) => Promise<Members>,
  target: string,
  name: string,
) {
  const pages = [];
  let cursor: string | undefined;
  for (let index = 0; index < 20; index++) {
    const page = await read(cursor),
      item = page.items.find((row) => row.id === target);
    pages.push({
      index,
      cursorHash: cursorHash(cursor ?? null),
      nextCursorHash: cursorHash(page.nextCursor),
      ...rows(
        page.items.map((row) => row.id),
        target,
      ),
      intendedNameMatches: item?.nickname === name,
    });
    if (item || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { pages, targetPage: pages.findIndex((page) => page.targetPresent) + 1 };
}
export type MemberTruth = {
  preflight: Awaited<ReturnType<typeof owningMemberPages>> | null;
  pages: Awaited<ReturnType<typeof owningMemberPages>> | null;
  targetExists: boolean;
  nicknameMatches: boolean;
  activeMember: boolean;
  errorCategory: "owner_read_failed" | null;
};

/** Retain only closed hashes/booleans/timing; signed cursors and public names stay in memory. */
export class QualificationMemberPicker {
  private readonly started = performance.now();
  private readonly requests: {
    index: number;
    phase: string;
    startedMs: number;
    cursorHash: string | null;
    status: number | null;
    endedMs: number | null;
    validDTO: boolean | null;
    page:
      | (ReturnType<typeof rows> & { nextCursorHash: string | null; intendedNameMatches: boolean })
      | null;
  }[] = [];
  private readonly dom: {
    phase: string;
    step: number;
    elapsedMs: number;
    cursorHash: string | null;
    expectedRowSetHash: string;
    actual: ReturnType<typeof rows> | null;
    intendedNameMatches: boolean;
    nextDisabled: boolean | null;
    previousDisabled: boolean | null;
    loadingCount: number | null;
    matched: boolean;
  }[] = [];
  private readonly requestIndex = new Map<Request, number>();
  private readonly pending = new Set<Promise<void>>();
  constructor(
    private readonly page: Page,
    private readonly info: TestInfo,
    private readonly target: string,
    private readonly name: string,
    private readonly phase: () => string,
  ) {
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }
  private readonly onRequest = (request: Request) => {
    if (!memberRequest(request)) return;
    this.requestIndex.set(request, this.requests.length);
    this.requests.push({
      index: this.requests.length,
      phase: this.phase(),
      startedMs: this.elapsed(),
      cursorHash: cursorHash(new URL(request.url()).searchParams.get("cursor")),
      status: null,
      endedMs: null,
      validDTO: null,
      page: null,
    });
  };
  private readonly onResponse = (response: Response) => {
    const index = this.requestIndex.get(response.request());
    if (index === undefined) return;
    const task = (async () => {
      const record = this.requests[index];
      if (!record) return;
      record.status = response.status();
      record.endedMs = this.elapsed();
      try {
        const parsed = schema("EnvelopeListMemberSummary").safeParse(await response.json());
        record.validDTO = parsed.success;
        if (parsed.success)
          record.page = {
            ...rows(
              parsed.data.data.items.map((item) => item.id),
              this.target,
            ),
            nextCursorHash: cursorHash(parsed.data.data.nextCursor),
            intendedNameMatches:
              parsed.data.data.items.find((item) => item.id === this.target)?.nickname ===
              this.name,
          };
      } catch {
        record.validDTO = false;
      }
    })();
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  };
  private elapsed() {
    return Math.round(performance.now() - this.started);
  }
  private async displayed() {
    const select = this.page.getByRole("combobox", { name: "Member", exact: true }),
      picker = select.locator("..");
    const options = await select.locator("option").evaluateAll((elements) =>
      elements
        .map((element) => ({
          id: (element as HTMLOptionElement).value,
          label: (element as HTMLOptionElement).label,
        }))
        .filter((option) => option.id !== ""),
    );
    return {
      ids: options.map((option) => option.id),
      intendedNameMatches: options.find((option) => option.id === this.target)?.label === this.name,
      nextDisabled: await picker
        .getByRole("button", { name: "Next page", exact: true })
        .isDisabled(),
      previousDisabled: await picker
        .getByRole("button", { name: "Previous page", exact: true })
        .isDisabled(),
      loadingCount: await picker.getByRole("status").count(),
    };
  }
  private response(cursor: string | null) {
    return this.page.waitForResponse(
      (response) =>
        memberRequest(response.request()) &&
        new URL(response.url()).searchParams.get("cursor") === cursor,
    );
  }
  async select(navigate: () => Promise<void>) {
    let cursor: string | null = null,
      nextResponse = this.response(cursor);
    await navigate();
    let response = await nextResponse;
    for (let step = 0; step <= 20; step++) {
      expect(response.status()).toBe(200);
      const parsed = schema("EnvelopeListMemberSummary").safeParse(await response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw Error("QUALIFICATION_MEMBER_PAGE_DTO_INVALID");
      const current = parsed.data.data,
        expected = current.items.map((item) => item.id);
      let matched = false,
        failure: unknown;
      try {
        await expect
          .poll(async () => digest(JSON.stringify((await this.displayed()).ids)))
          .toBe(digest(JSON.stringify(expected)));
        matched = true;
      } catch (error) {
        failure = error;
      }
      {
        const actual = await this.displayed().catch(() => null);
        this.dom.push({
          phase: this.phase(),
          step,
          elapsedMs: this.elapsed(),
          cursorHash: cursorHash(cursor),
          expectedRowSetHash: digest(JSON.stringify(expected)),
          actual: actual ? rows(actual.ids, this.target) : null,
          intendedNameMatches: actual?.intendedNameMatches ?? false,
          nextDisabled: actual?.nextDisabled ?? null,
          previousDisabled: actual?.previousDisabled ?? null,
          loadingCount: actual?.loadingCount ?? null,
          matched,
        });
        if (!actual) failure ??= Error("QUALIFICATION_MEMBER_DOM_UNAVAILABLE");
      }
      if (failure) throw failure;
      const select = this.page.getByRole("combobox", { name: "Member", exact: true }),
        picker = select.locator("..");
      await expect(picker.getByRole("status")).toHaveCount(0);
      const previous = picker.getByRole("button", { name: "Previous page", exact: true }),
        next = picker.getByRole("button", { name: "Next page", exact: true });
      if (step === 0) await expect(previous).toBeDisabled();
      else await expect(previous).toBeEnabled();
      if (current.nextCursor === null) await expect(next).toBeDisabled();
      else await expect(next).toBeEnabled();
      if (
        current.items.some((item) => item.id === this.target) ||
        !current.nextCursor ||
        step === 20
      ) {
        const option = select.getByRole("option").filter({ hasText: this.name });
        await expect(option).toHaveCount(1);
        await expect(option).toHaveAttribute("value", this.target);
        await expect(option).toHaveText(this.name);
        await select.selectOption({ label: (await option.textContent()) ?? "" });
        await expect(select).toHaveValue(this.target);
        return step + 1;
      }
      cursor = current.nextCursor;
      nextResponse = this.response(cursor);
      await picker.getByRole("button", { name: "Next page", exact: true }).click();
      response = await nextResponse;
    }
    throw Error("QUALIFICATION_MEMBER_PAGE_BOUND");
  }
  async finish(truth: MemberTruth, failure: unknown) {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    await Promise.all(this.pending);
    const errorCategory = !failure
      ? null
      : failure instanceof Error && failure.name === "TimeoutError"
        ? "timeout"
        : failure instanceof Error && failure.message.startsWith("expect(")
          ? "assertion"
          : "other";
    const ledger = {
      phase: this.phase(),
      completed: !failure,
      errorCategory,
      requests: this.requests,
      dom: this.dom,
      truth,
    };
    await mkdir(this.info.outputDir, { recursive: true });
    await writeFile(
      this.info.outputPath("qualification-member-pages.json"),
      JSON.stringify(ledger),
    );
    await this.info.attach("qualification-member-pages", {
      body: JSON.stringify(ledger),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        event: "qualification_member_pages",
        phase: this.phase(),
        completed: !failure,
        requests: this.requests.length,
        domPages: this.dom.length,
        allMatched: this.dom.every((page) => page.matched),
      }),
    );
  }
}
