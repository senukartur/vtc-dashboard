import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { Readable } from "node:stream";
import { applicationId } from "@vtc/db";

export interface BlobConfig {
  root: string;
  maxFileBytes: number;
  maxPixels: number;
  timeoutMs: number;
}
export interface BlobIdentity {
  id: string;
  generation: string;
}
export interface VerifiedBlob {
  byteLength: number;
  sha256: Buffer;
  contentType: "image/png" | "image/jpeg";
}
export interface PrivateBlobs {
  ready?(): Promise<void>;
  put(
    key: BlobIdentity,
    bytes: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<VerifiedBlob>;
  inspect(key: BlobIdentity, signal?: AbortSignal): Promise<VerifiedBlob | null>;
  read(key: BlobIdentity): Promise<Readable>;
  remove(key: BlobIdentity, staging?: boolean): Promise<void>;
  present(key: BlobIdentity, staging?: boolean): Promise<boolean>;
}
export class BlobFailure extends Error {
  constructor(readonly category: "invalid" | "oversized" | "unavailable" | "cancelled") {
    super(`BLOB_${category.toUpperCase()}`);
  }
}
// The child receives no application environment, credentials or request body. Native
// decoding has its own process lifetime; the original evidence bytes are preserved.
const decoderSource = `
import { pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
try {
 const sharp = (await import(pathToFileURL(process.argv[1]).href)).default;
 sharp.cache(false); sharp.concurrency(1);
 sharp.block({operation:['VipsForeignLoad']});
 sharp.unblock({operation:['VipsForeignLoadJpegFile','VipsForeignLoadPngFile']});
 const pixels=Number(process.argv[3]);
 const image=sharp(process.argv[2],{failOn:'warning',limitInputPixels:pixels,limitInputChannels:4,pages:1});
 const m=await image.metadata();
 if(!['png','jpeg'].includes(m.format)||!m.width||!m.height||m.width*m.height>pixels||(m.pages??1)!==1||(m.channels??5)>4)throw Error();
 let count=0;
 await pipeline(image.toColourspace('srgb').raw({depth:'uchar'}).timeout({seconds:Math.max(1,Math.floor(Number(process.argv[4])/1000))}),new Writable({write(chunk,encoding,done){count+=chunk.length;done(count>pixels*4?Error():undefined)}}));
 if(count!==m.width*m.height*(m.hasAlpha?4:3))throw Error();
 process.stdout.write(m.format==='png'?'image/png':'image/jpeg');
} catch { process.exitCode=1; }
`;
const sharpPath = createRequire(import.meta.url).resolve("sharp");
// A process-local technical admission bound complements byte/pixel/child lifetime
// limits. It bounds native decoder concurrency, not an OS memory sandbox.
let activeDecoders = 0;
export async function validateImage(
  file: string,
  config: Pick<BlobConfig, "maxPixels" | "timeoutMs">,
  signal?: AbortSignal,
): Promise<VerifiedBlob["contentType"]> {
  if (activeDecoders >= 2) throw new BlobFailure("unavailable");
  activeDecoders++;
  try {
    return await new Promise<VerifiedBlob["contentType"]>((accept, reject) => {
      if (signal?.aborted) {
        reject(new BlobFailure("cancelled"));
        return;
      }
      const child = (() => {
        try {
          return spawn(
            process.execPath,
            [
              "--max-old-space-size=128",
              "--input-type=module",
              "-e",
              decoderSource,
              sharpPath,
              file,
              String(config.maxPixels),
              String(config.timeoutMs),
            ],
            {
              stdio: ["ignore", "pipe", "ignore"],
              windowsHide: true,
              env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {},
            },
          );
        } catch {
          throw new BlobFailure("unavailable");
        }
      })();
      let result = "",
        failure: BlobFailure["category"] | undefined,
        settled = false;
      const stop = (category: BlobFailure["category"]) => {
        if (settled || failure) return;
        failure = category;
        if (child.pid !== undefined) child.kill("SIGKILL");
        child.stdout.destroy();
      };
      const abort = () => stop("cancelled");
      const data = (chunk: Buffer) => {
        if (settled || failure) return;
        const text = String(chunk);
        if (result.length + text.length > 32) stop("invalid");
        else result += text;
      };
      const unavailable = () => stop("unavailable");
      const timer = setTimeout(abort, config.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        child.stdout.removeListener("data", data);
        child.stdout.removeListener("error", unavailable);
        child.removeListener("error", unavailable);
      };
      child.stdout.on("data", data);
      child.stdout.once("error", unavailable);
      child.once("error", unavailable);
      signal?.addEventListener("abort", abort, { once: true });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!failure && code === 0 && (result === "image/png" || result === "image/jpeg"))
          accept(result);
        else reject(new BlobFailure(failure ?? "invalid"));
      });
      if (signal?.aborted) abort();
    });
  } finally {
    activeDecoders--;
  }
}
function missing(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
export function createPrivateFilesystem(config: BlobConfig): PrivateBlobs {
  const root = resolve(config.root);
  if (
    !isAbsolute(config.root) ||
    root === parse(root).root ||
    !Number.isInteger(config.maxFileBytes) ||
    config.maxFileBytes < 1 ||
    config.maxFileBytes > 64 * 1024 * 1024 ||
    !Number.isInteger(config.maxPixels) ||
    config.maxPixels < 1 ||
    config.maxPixels > 16_000_000 ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 120000
  )
    throw new Error("INVALID_BLOB_CONFIG");
  let rootIdentity: string | undefined;
  async function safeRoot() {
    try {
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(root)) !== root)
        throw Error();
      if (
        process.platform !== "win32" &&
        ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.())
      )
        throw Error();
      for (let parent = dirname(root); parent !== dirname(parent); parent = dirname(parent))
        if ((await lstat(parent)).isSymbolicLink()) throw Error();
      const identity = `${stat.dev}:${stat.ino}`;
      if (rootIdentity && rootIdentity !== identity) throw Error();
      rootIdentity = identity;
    } catch {
      throw new BlobFailure("unavailable");
    }
  }
  function filename(key: BlobIdentity, staging = false) {
    return join(
      root,
      `${applicationId(key.id)}.${applicationId(key.generation)}.${staging ? "staging" : "blob"}`,
    );
  }
  async function syncDirectory() {
    // Windows does not support opening directories with this Node API. Linux is
    // the supported durability target; no Windows power-loss guarantee is made.
    if (process.platform === "win32") return;
    const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async function regular(path: string) {
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > config.maxFileBytes) throw new BlobFailure("invalid");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async function inspect(key: BlobIdentity, signal?: AbortSignal): Promise<VerifiedBlob | null> {
    await safeRoot();
    const path = filename(key);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await regular(path);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    const hash = createHash("sha256");
    let byteLength = 0;
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted();
        byteLength += chunk.length;
        hash.update(chunk);
      }
    } finally {
      await handle.close();
    }
    return {
      byteLength,
      sha256: hash.digest(),
      contentType: await validateImage(path, config, signal),
    };
  }
  return {
    ready: safeRoot,
    async put(key, bytes, signal) {
      await safeRoot();
      const staged = filename(key, true),
        final = filename(key);
      const handle = await open(
        staged,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      ).catch(() => {
        throw new BlobFailure("unavailable");
      });
      let byteLength = 0;
      const hash = createHash("sha256");
      const deadline = AbortSignal.any([
        AbortSignal.timeout(config.timeoutMs),
        ...(signal ? [signal] : []),
      ]);
      try {
        // Each iterator read is raced with cancellation. Closing the HTTP stream
        // is its caller's responsibility; no detached file writes are launched.
        const iterator = bytes[Symbol.asyncIterator]();
        while (true) {
          deadline.throwIfAborted();
          const next = await new Promise<IteratorResult<Uint8Array>>((accept, reject) => {
            const abort = () => reject(new BlobFailure("cancelled"));
            deadline.addEventListener("abort", abort, { once: true });
            Promise.resolve(iterator.next())
              .then(accept, reject)
              .finally(() => deadline.removeEventListener("abort", abort));
          });
          if (next.done) break;
          const chunk = next.value;
          if (!(chunk instanceof Uint8Array)) throw new BlobFailure("invalid");
          byteLength += chunk.length;
          if (byteLength > config.maxFileBytes) throw new BlobFailure("oversized");
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (byteLength === 0) throw new BlobFailure("invalid");
        await handle.sync();
        await handle.close();
        const contentType = await validateImage(staged, config, deadline);
        await safeRoot();
        deadline.throwIfAborted();
        await link(staged, final);
        await syncDirectory();
        await unlink(staged);
        await syncDirectory();
        return { byteLength, sha256: hash.digest(), contentType };
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(staged).catch(() => {});
        if (error instanceof BlobFailure) throw error;
        if (deadline.aborted) throw new BlobFailure("cancelled");
        throw new BlobFailure("unavailable");
      }
    },
    inspect,
    async read(key) {
      await safeRoot();
      const handle = await regular(filename(key));
      return handle.createReadStream();
    },
    async remove(key, staging = false) {
      await safeRoot();
      const path = filename(key, staging);
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new BlobFailure("unavailable");
        await unlink(path);
        await syncDirectory();
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
    async present(key, staging = false) {
      await safeRoot();
      try {
        const stat = await lstat(filename(key, staging));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new BlobFailure("unavailable");
        return true;
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
  };
}
