import { useEffect, useRef, useState } from "react";
import type { CatalogLogo } from "../../shared/catalog-selectors/contracts.js";
import { logoLoader } from "./logo-loader.js";
import { logoSrc } from "./model.js";

/** A neutral drawn mark for a company without a logo; it is not a game asset. */
function Placeholder() {
  return (
    <svg
      aria-hidden="true"
      className="company-logo-placeholder"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20V8l8-4 8 4v12" />
      <path d="M9 20v-6h6v6" />
      <path d="M3 20h18" />
    </svg>
  );
}

type LogoState = { src: string; url: string | null; failed: boolean };

/** Asks for the logo once the plate is near the viewport, like a lazy image. */
function whenNearViewport(element: Element, callback: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => undefined;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      callback();
    },
    { rootMargin: "300px 0px" },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * The company's logo on a fixed 128x32 light plate, so dark and light artwork both read on the
 * dark page. The name always sits next to it, hence the empty alt. The image comes through the
 * shared logo loader (a few requests at a time, busy answers retried); until it arrives the plate
 * stays empty. A missing logo and one that cannot be loaded or decoded both fall back to the
 * placeholder, never a broken image.
 */
export function CompanyLogo({
  companyId,
  logo,
}: {
  companyId: string;
  logo: CatalogLogo | null | undefined;
}) {
  const src = logo ? logoSrc(companyId, logo) : null;
  const plate = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<LogoState | null>(null);
  useEffect(() => {
    const element = plate.current;
    if (src === null || element === null) return;
    let live = true;
    let release: (() => void) | null = null;
    const stop = whenNearViewport(element, () => {
      const request = logoLoader.request(src);
      release = request.release;
      request.promise.then(
        (url) => live && setState({ src, url, failed: false }),
        () => live && setState({ src, url: null, failed: true }),
      );
    });
    return () => {
      live = false;
      stop();
      release?.();
    };
  }, [src]);
  const current = src !== null && state?.src === src ? state : null;
  const shown = current?.url ?? null;
  const mode = src === null || current?.failed ? "placeholder" : shown ? "image" : "loading";
  return (
    <span ref={plate} className="company-logo" data-logo={mode}>
      {mode === "image" && shown ? (
        <img
          src={shown}
          alt=""
          width={128}
          height={32}
          decoding="async"
          onError={() => setState({ src: src as string, url: null, failed: true })}
        />
      ) : mode === "placeholder" ? (
        <Placeholder />
      ) : null}
    </span>
  );
}
