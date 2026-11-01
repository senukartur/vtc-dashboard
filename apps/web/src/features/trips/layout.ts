import { useSyncExternalStore } from "react";

/** The trip side panel needs room beside the table; keep in sync with trips-list.css. */
export const WIDE_QUERY = "(min-width: 1200px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useWideLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}
