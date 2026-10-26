import { expect, test } from "vitest";
import { createAppQueryClient } from "../../apps/web/src/app/session-cache.ts";
import { fenceQualificationReads } from "../../apps/web/src/features/qualifications/read-fence.ts";

const scope = ["qualification-workspace", "synthetic", 1, 1, "manage"];
const key = (path: string, name = "EnvelopeProgress") => [...scope, path, name];
function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const level = { kind: "level", id: "level", game: "ets2" } as const;

test("synchronous abort replacement cannot be mistaken for the cancelled retryer after its old catch sets idle", async () => {
  const client = createAppQueryClient(),
    queryKey = key("/qualification-levels?game=ets2"),
    old = deferred<number>(),
    newer = deferred<number>();
  let replacement: Promise<unknown> | undefined;
  client.setQueryData(queryKey, 1);
  const pending = client
    .fetchQuery({
      queryKey,
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          replacement = client
            .fetchQuery({ queryKey, queryFn: () => newer.promise })
            .catch(() => undefined);
        });
        return old.promise;
      },
    })
    .catch(() => undefined);
  try {
    await fenceQualificationReads(client, scope, level, "synthetic", false);
    expect(client.getQueryCache().find({ queryKey })?.promise).toBeDefined();
    expect(client.getQueryState(queryKey)?.status).not.toBe("success");
    newer.resolve(4);
    await replacement;
    expect(client.getQueryState(queryKey)).toMatchObject({
      data: 4,
      status: "success",
      error: null,
      fetchStatus: "idle",
    });
    old.resolve(1);
    await pending;
  } finally {
    old.resolve(1);
    newer.resolve(4);
    await replacement;
    client.clear();
  }
});

test("fence preserves newer cached data and timestamps without cancellation errors or stuck fetching; immutable and unrelated reads continue", async () => {
  const client = createAppQueryClient(),
    old = deferred<{ version: number }>(),
    list = key("/qualification-levels?game=ets2", "EnvelopeListQualificationLevel"),
    untouched = [
      key("/qualification-levels?game=ats"),
      key("/qualification-levels/level/rule-versions/immutable"),
      ["other-session", "/qualification-levels?game=ets2", "EnvelopeListQualificationLevel"],
    ];
  let aborted = false;
  const others = untouched.map((queryKey) => ({
    queryKey,
    read: deferred<number>(),
    aborted: false,
  }));
  try {
    client.setQueryData(list, { version: 1 });
    const pending = client
      .fetchQuery({
        queryKey: list,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return old.promise;
        },
      })
      .catch(() => undefined);
    const otherPromises = others.map((item) =>
      client.fetchQuery({
        queryKey: item.queryKey,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            item.aborted = true;
          });
          return item.read.promise;
        },
      }),
    );
    client.setQueryData(list, { version: 3 }, { updatedAt: 12345 });
    await fenceQualificationReads(client, scope, level, "synthetic", false);
    old.resolve({ version: 1 });
    await pending;
    expect(aborted).toBe(true);
    expect(client.getQueryState(list)).toMatchObject({
      data: { version: 3 },
      dataUpdatedAt: 12345,
      status: "success",
      error: null,
      fetchStatus: "idle",
    });
    for (const item of others) {
      expect(item.aborted).toBe(false);
      item.read.resolve(9);
    }
    await Promise.all(otherPromises);
  } finally {
    old.resolve({ version: 1 });
    for (const item of others) item.read.resolve(9);
    client.clear();
  }
});

test("fenced progress and old-cursor history require new reads and ignore even an abort-ignoring old result", async () => {
  const client = createAppQueryClient(),
    change = {
      kind: "member",
      id: "target",
      game: "ets2",
      levelId: "next",
      roleChange: false,
    } as const;
  const reads = [
    "qualification-progress?game=ets2",
    "qualification-action-history?game=ets2&cursor=old",
  ].map((suffix) => ({
    queryKey: key(`/admin/members/target/${suffix}`),
    old: deferred<{ version: number; etag: string }>(),
    aborted: false,
  }));
  try {
    const pending = reads.map((item) => {
      client.setQueryData(item.queryKey, { version: 7, etag: "v7" });
      return client
        .fetchQuery({
          queryKey: item.queryKey,
          queryFn: ({ signal }) => {
            signal.addEventListener("abort", () => {
              item.aborted = true;
            });
            return item.old.promise;
          },
        })
        .catch(() => undefined);
    });
    await fenceQualificationReads(client, scope, change, "synthetic", false);
    for (const item of reads) {
      expect(item.aborted).toBe(true);
      expect(client.getQueryState(item.queryKey)).toMatchObject({
        status: "success",
        error: null,
        fetchStatus: "idle",
      });
      await client.fetchQuery({
        queryKey: item.queryKey,
        queryFn: async () => ({ version: 8, etag: "v8" }),
      });
      item.old.resolve({ version: 7, etag: "v7" });
    }
    await Promise.all(pending);
    for (const item of reads)
      expect(client.getQueryState(item.queryKey)).toMatchObject({
        data: { version: 8, etag: "v8" },
        status: "success",
        error: null,
        fetchStatus: "idle",
      });
  } finally {
    for (const item of reads) item.old.resolve({ version: 7, etag: "v7" });
    client.clear();
  }
});

test("status repair never crosses an intervening new fetch, success, error or cache removal", async () => {
  for (const result of ["success", "error", "removed", "cached-success"] as const) {
    const client = createAppQueryClient(),
      queryKey = key("/qualification-levels?game=ets2"),
      old = deferred<number>(),
      newer = deferred<number>();
    let replacement: Promise<unknown> | undefined,
      started = false;
    client.setQueryData(queryKey, 1);
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (!started && event.type === "updated" && event.action.type === "error") {
        started = true;
        if (result === "removed") client.removeQueries({ queryKey });
        else if (result === "cached-success")
          client.setQueryData(queryKey, 4, { updatedAt: 24680 });
        else
          replacement = client
            .fetchQuery({
              queryKey,
              queryFn: () =>
                result === "error" ? Promise.reject(Error("SYNTHETIC_READ_ERROR")) : newer.promise,
            })
            .catch(() => undefined);
      }
    });
    try {
      const pending = client
        .fetchQuery({
          queryKey,
          queryFn: ({ signal }) => {
            void signal.aborted;
            return old.promise;
          },
        })
        .catch(() => undefined);
      await fenceQualificationReads(client, scope, level, "synthetic", false);
      if (result === "cached-success") {
        expect(client.getQueryState(queryKey)).toMatchObject({
          data: 4,
          dataUpdatedAt: 24680,
          status: "success",
          error: null,
          fetchStatus: "idle",
        });
      } else if (result === "error") {
        await replacement;
        expect(client.getQueryState(queryKey)).toMatchObject({
          data: 1,
          status: "error",
          fetchStatus: "idle",
        });
        expect(client.getQueryState(queryKey)?.error?.message).toBe("SYNTHETIC_READ_ERROR");
      } else if (result !== "removed") {
        expect(client.getQueryState(queryKey)?.fetchStatus).toBe("fetching");
        newer.resolve(4);
        await replacement;
        expect(client.getQueryState(queryKey)).toMatchObject({
          data: 4,
          status: "success",
          error: null,
          fetchStatus: "idle",
        });
      } else expect(client.getQueryState(queryKey)).toBeUndefined();
      old.resolve(1);
      await pending;
    } finally {
      unsubscribe();
      old.resolve(1);
      newer.resolve(4);
      client.clear();
    }
  }
});
