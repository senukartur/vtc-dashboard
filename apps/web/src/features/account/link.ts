export type LinkHandoff = { path: string; token: string | null };
declare global {
  interface Window {
    __vtcLink?: LinkHandoff;
  }
}
// Consume once before rendering. The route owns the remaining memory-only lifetime.
let initial: LinkHandoff | undefined;
if (typeof window !== "undefined") {
  initial = window.__vtcLink;
  delete window.__vtcLink;
}
export function takeLink(): LinkHandoff {
  const link = initial;
  initial = undefined;
  const token = link?.token;
  // Both existing producers prefix the opaque secret with its generation UUID.
  const pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
  return { path: link?.path ?? "", token: token && pattern.test(token) ? token : null };
}
