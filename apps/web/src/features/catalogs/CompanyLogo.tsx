import { useState } from "react";
import type { CatalogLogo } from "../../shared/catalog-selectors/contracts.js";
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

/**
 * The company's logo on a fixed 128x32 light plate, so dark and light artwork both read on the
 * dark page. The name always sits next to it, hence the empty alt. A missing logo and an image
 * that fails to load both fall back to the placeholder, never a broken image.
 */
export function CompanyLogo({
  companyId,
  logo,
}: {
  companyId: string;
  logo: CatalogLogo | null | undefined;
}) {
  const src = logo ? logoSrc(companyId, logo) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src !== null && failed !== src;
  return (
    <span className="company-logo" data-logo={shown ? "image" : "placeholder"}>
      {shown ? (
        <img
          src={src}
          alt=""
          width={128}
          height={32}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
        />
      ) : (
        <Placeholder />
      )}
    </span>
  );
}
