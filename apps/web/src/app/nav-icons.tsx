import type { NavItemId } from "./navigation-model.js";

// Project-authored line icons; decorative only, the adjacent label names every control.
const shapes: Record<NavItemId | "plus" | "collapse" | "expand" | "check", string> = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  myTrips:
    "M3 16V7h11v9M14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  drafts: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  events: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
  drivers:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 1 3 3 3 5",
  qualifications: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z",
  dispatch: "M4 5h16v11H4zM9 20h6M12 16v4M8 10l2 2 4-4",
  reconciliation: "M7 7h10l-3-3M17 17H7l3 3M5 7v4M19 17v-4",
  applications: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  members: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20c0-3 3-5 6-5s6 2 6 5M17 8v6M14 11h6",
  catalogs: "M4 5h7v14H4zM13 5h7v14h-7zM6 9h3M15 9h3",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  plus: "M12 5v14M5 12h14",
  collapse: "M15 6l-6 6 6 6",
  expand: "M9 6l6 6-6 6",
  check: "M5 12l5 5 9-10",
};
export function NavIcon({ name }: { name: keyof typeof shapes }) {
  return (
    <svg
      className="nav-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={shapes[name]} />
    </svg>
  );
}
