export function frozenAttempt(
  path: string,
  method: string,
  body: unknown,
  etag: string | null,
  previous: RequestAttempt | null,
): RequestAttempt {
  // An ambiguous write keeps its exact target/body/key/ETag until resolved or explicitly dismissed.
  return (
    previous ?? {
      path,
      method,
      body: body === undefined ? undefined : structuredClone(body),
      etag,
      key: crypto.randomUUID(),
    }
  );
}
export type RequestAttempt = {
  path: string;
  method: string;
  body: unknown;
  etag: string | null;
  key: string;
};
