import type { Readable } from "node:stream";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BlobFailure } from "../blob-storage/filesystem.js";

export const multipartOverhead = 16_384;
export const mediaType = (request: FastifyRequest) =>
  request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();

type HttpError = (status: number, code?: string) => Error;

export function checkImageMultipart(request: FastifyRequest, maxBytes: number, fail: HttpError) {
  if (mediaType(request) !== "multipart/form-data") throw fail(415);
  if (Number(request.headers["content-length"]) > maxBytes + multipartOverhead) throw fail(413);
}

export async function registerImageMultipart(
  app: FastifyInstance,
  maxBytes: number,
  matches: (request: FastifyRequest) => boolean,
  fail: HttpError,
  preserveUploadErrors = false,
) {
  const oversized = new WeakSet<FastifyRequest>();
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: maxBytes,
      fieldSize: 1,
      fieldNameSize: 32,
      headerPairs: 32,
    },
    throwFileSizeLimit: true,
  });
  app.addHook("preParsing", async (request, reply, payload) => {
    if (!matches(request)) return payload;
    let received = 0;
    payload.pause();
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= maxBytes + multipartOverhead || oversized.has(request)) return;
      oversized.add(request);
      payload.pause();
      reply.raw.once("finish", () => payload.destroy());
      void reply.send(fail(413));
    };
    const cleanup = () => payload.removeListener("data", count);
    payload.on("data", count);
    payload.once("end", cleanup);
    payload.once("close", cleanup);
    return payload;
  });

  return async function receive<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    timeoutMs: number,
    invoke: (image: {
      bytes: AsyncIterable<Uint8Array>;
      filename: string;
      contentType: string;
      signal: AbortSignal;
    }) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    let file: Readable | undefined;
    let expired = false;
    let uploadStarted = false;
    const timer = setTimeout(() => {
      expired = true;
      cancel();
      file?.destroy();
      // A raw close rejects pending multipart reads, including before a file part.
      request.raw.destroy();
      request.raw.socket.destroy();
    }, timeoutMs);
    request.raw.once("aborted", cancel);
    try {
      const parts = request.parts();
      const first = await parts.next();
      if (first.done || first.value.type !== "file" || first.value.fieldname !== "file")
        throw fail(422);
      const part = first.value;
      file = part.file;
      abort.signal.throwIfAborted();
      async function* chunks() {
        try {
          for await (const chunk of part.file) {
            if (oversized.has(request)) throw new BlobFailure("oversized");
            yield chunk as Buffer;
          }
          if (part.file.truncated || oversized.has(request)) throw new BlobFailure("oversized");
          if (!(await parts.next()).done) throw new BlobFailure("invalid");
        } catch (error) {
          if (error instanceof BlobFailure) throw error;
          throw new BlobFailure(
            error && typeof error === "object" && "statusCode" in error && error.statusCode === 413
              ? "oversized"
              : "invalid",
          );
        }
      }
      uploadStarted = true;
      return await invoke({
        bytes: chunks(),
        filename: part.filename,
        contentType: part.mimetype,
        signal: abort.signal,
      });
    } catch (error) {
      file?.destroy();
      if (!request.raw.destroyed) reply.raw.once("finish", () => request.raw.destroy());
      if (oversized.has(request)) throw fail(413);
      if (expired && !uploadStarted) throw fail(503, "DEPENDENCY_UNAVAILABLE");
      if (error && typeof error === "object" && "statusCode" in error) throw error;
      if (uploadStarted && preserveUploadErrors) throw error;
      throw fail(422);
    } finally {
      clearTimeout(timer);
      request.raw.removeListener("aborted", cancel);
    }
  };
}
