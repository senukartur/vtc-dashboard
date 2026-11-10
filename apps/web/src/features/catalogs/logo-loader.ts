/**
 * Loads company logos for the catalog lists. The API holds a small database pool that does not
 * queue (a busy pool answers 503 with Retry-After), and a page of rows would otherwise ask for
 * every logo at once. Requests therefore go through one shared queue with a few in flight, a
 * logo shown several times (depots of one company) is fetched once, a busy answer is retried
 * after the server's hint, and a request nobody waits for any more never starts.
 *
 * `fetch` keeps the browser HTTP cache, so a versioned logo URL is still read from the cache for
 * the server's max-age. Loaded logos stay as object URLs for the page's lifetime and are not
 * revoked: a few hundred small PNGs exist per game, and a replaced version adds at most one more
 * file of up to 32 KiB. The server authorizes every request it receives; a logo already loaded
 * in this tab is reused without asking again, as the browser cache would.
 */

export type LogoLoaderOptions = {
  fetch: (url: string) => Promise<Response>;
  /** Requests in flight at once; kept below the API's database pool. */
  concurrency?: number;
  /** Total tries for a busy (503/429) answer or a network error. */
  attempts?: number;
  wait?: (ms: number) => Promise<void>;
  toObjectUrl?: (blob: Blob) => string;
  /** Extra delay so retries from many rows do not arrive together. */
  jitter?: () => number;
};

export type LogoRequest = {
  /** Resolves to a displayable URL; rejects when the logo cannot be shown. */
  promise: Promise<string>;
  /** Called when the caller no longer needs the logo (unmount, changed version). */
  release: () => void;
};

type Entry = {
  promise: Promise<string>;
  waiting: number;
  started: boolean;
  start: () => void;
  cancel: () => void;
};

const busy = (status: number) => status === 503 || status === 429;
const maxRetryDelayMs = 10_000;

function retryDelay(response: Response | null, attempt: number): number {
  const header = response?.headers.get("retry-after");
  const seconds = header === null || header === undefined ? Number.NaN : Number(header);
  const hinted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(hinted, maxRetryDelayMs);
}

export class LogoUnavailable extends Error {
  constructor(readonly status: number | null) {
    super("LOGO_UNAVAILABLE");
  }
}

export function createLogoLoader(options: LogoLoaderOptions) {
  const concurrency = options.concurrency ?? 3;
  const attempts = options.attempts ?? 4;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const toObjectUrl = options.toObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const jitter = options.jitter ?? (() => Math.random() * 250);
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  let active = 0;

  const next = () => {
    while (active < concurrency && queue.length > 0) queue.shift()?.start();
  };

  async function download(url: string): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | null = null;
      let body: Blob | null = null;
      try {
        response = await options.fetch(url);
        if (response.ok) body = await response.blob();
      } catch {
        // A network failure, also while reading the body, is retried like a busy answer.
        response = null;
      }
      if (body) return toObjectUrl(body);
      const retryable = response === null || busy(response.status);
      if (!retryable || attempt + 1 >= attempts)
        throw new LogoUnavailable(response?.status ?? null);
      // The slot stays taken while waiting, so a busy server gets fewer requests, not more.
      await wait(retryDelay(response, attempt) + jitter());
    }
  }

  function request(url: string): LogoRequest {
    let entry = entries.get(url);
    if (!entry) {
      let resolve!: (value: string) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Nobody may be listening when a cancelled or failed request settles.
      promise.catch(() => undefined);
      const created: Entry = {
        promise,
        waiting: 0,
        started: false,
        start() {
          created.started = true;
          active += 1;
          download(url)
            .then(resolve, (error: unknown) => {
              // A failed logo may be asked for again later (another mount or page visit).
              if (entries.get(url) === created) entries.delete(url);
              reject(error);
            })
            .finally(() => {
              active -= 1;
              next();
            });
        },
        cancel() {
          const index = queue.indexOf(created);
          if (index >= 0) queue.splice(index, 1);
          if (entries.get(url) === created) entries.delete(url);
          reject(new LogoUnavailable(null));
        },
      };
      entry = created;
      entries.set(url, created);
      queue.push(created);
      next();
    }
    const held = entry;
    held.waiting += 1;
    let released = false;
    return {
      promise: held.promise,
      release() {
        if (released) return;
        released = true;
        held.waiting -= 1;
        if (held.waiting === 0 && !held.started) held.cancel();
      },
    };
  }

  return { request };
}

export const logoLoader = createLogoLoader({
  fetch: (url) => fetch(url, { credentials: "same-origin" }),
});
