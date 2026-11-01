// Project-authored abstract roads: no map text, game assets or real geography.
const roadA = "40,360 200,280 330,250 460,150 620,60";
const roadB = "180,30 260,130 300,220 430,300 620,360";

/**
 * Decorative hero art. It is static in the prerendered document and under reduced motion;
 * landing.css animates only the markers and pings with transform/opacity.
 */
export function HeroArt() {
  return (
    <div className="landing-hero-art" aria-hidden="true">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 640 400"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="landing-hero-glow" cx="70%" cy="35%" r="70%">
            <stop className="hero-glow-start" offset="0" />
            <stop className="hero-glow-end" offset="1" />
          </radialGradient>
        </defs>
        <rect width="640" height="400" fill="url(#landing-hero-glow)" />
        <g className="hero-grid">
          <path d="M0 100H640M0 200H640M0 300H640M160 0V400M320 0V400M480 0V400" />
        </g>
        <polyline className="hero-road hero-road-a" points={roadA} />
        <polyline className="hero-road hero-road-b" points={roadB} />
        <polyline className="hero-lane hero-lane-a" points={roadA} />
        <polyline className="hero-lane hero-lane-b" points={roadB} />
        <g className="hero-stops">
          <circle cx="330" cy="250" r="5" />
          <circle cx="460" cy="150" r="5" />
          <circle cx="300" cy="220" r="4" />
          <circle cx="430" cy="300" r="4" />
        </g>
        <circle className="hero-ping hero-ping-a landing-motion" cx="330" cy="250" r="5" />
        <circle className="hero-ping hero-ping-b landing-motion" cx="430" cy="300" r="4" />
        <g className="hero-marker hero-marker-a landing-motion">
          <rect x="-11" y="-6" width="22" height="12" rx="3" />
        </g>
        <g className="hero-marker hero-marker-b landing-motion">
          <rect x="-8" y="-5" width="16" height="10" rx="3" />
        </g>
      </svg>
    </div>
  );
}
