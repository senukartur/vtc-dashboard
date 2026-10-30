// Only opaque notification IDs and bounded expiry metadata may survive a reload.
const storageKey = "vtc-notification-claims-v1";
export async function claimToast(id: string, current: () => boolean): Promise<boolean> {
  try {
    if (!/^[0-9a-f-]{36}$/.test(id) || !navigator.locks || !current()) return false;
    return await navigator.locks.request(
      storageKey,
      { mode: "exclusive", signal: AbortSignal.timeout(1000) },
      () => {
        if (!current()) return false;
        const now = Date.now(),
          raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        if (!Array.isArray(raw)) return false;
        const claims = raw
          .filter(
            (v): v is { id: string; expires: number } =>
              typeof v === "object" &&
              v !== null &&
              typeof v.id === "string" &&
              /^[0-9a-f-]{36}$/.test(v.id) &&
              typeof v.expires === "number" &&
              Number.isFinite(v.expires) &&
              v.expires > now &&
              v.expires <= now + 600000,
          )
          .map(({ id, expires }) => ({ id, expires }))
          .slice(-255);
        if (claims.some((v) => v.id === id)) return false;
        localStorage.setItem(
          storageKey,
          JSON.stringify([...claims, { id, expires: now + 600000 }]),
        );
        return current();
      },
    );
  } catch {
    return false;
  }
}
