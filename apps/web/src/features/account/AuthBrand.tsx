import { type PublicLocale, publicContent } from "../landing/content.js";
import "./auth.css";

const roads = [
  "M-40 700 C 120 640 160 520 280 470 S 470 380 520 240 S 600 60 660 20",
  "M60 120 C 180 160 260 260 300 360 S 360 560 460 640 S 600 720 680 760",
];

// Decorative companion to the entry forms: static, project-authored road lines (no map data),
// hidden from assistive technology, with the existing approved landing copy.
export function AuthBrand({ locale }: { locale: PublicLocale }) {
  const copy = publicContent[locale];
  return (
    <div className="auth-brand" aria-hidden="true">
      <svg
        className="auth-brand-map"
        aria-hidden="true"
        viewBox="0 0 600 800"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <path className="brand-road" d={roads[0]} strokeWidth="34" />
        <path className="brand-lane" d={roads[0]} strokeWidth="2.5" />
        <path className="brand-road" d={roads[1]} strokeWidth="20" />
        <path className="brand-lane" d={roads[1]} strokeWidth="1.5" />
        <circle className="brand-stop" cx="280" cy="470" r="6" />
        <circle className="brand-stop" cx="520" cy="240" r="6" />
        <circle className="brand-stop" cx="300" cy="360" r="5" />
      </svg>
      <div className="auth-brand-copy">
        <p className="eyebrow">{copy.eyebrow}</p>
        <p className="auth-brand-heading">{copy.heading}</p>
      </div>
    </div>
  );
}
