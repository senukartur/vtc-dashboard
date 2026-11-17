// Project-authored flame outline marking Hard Mode; decorative, the adjacent text names it.
export function FlameIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="flame-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 21c-3.9 0-7-2.8-7-6.6 0-2.6 1.5-4.6 3-6.1.3 1.6 1.1 2.7 2.3 3.2C10 8 11 5.3 13.6 3c.2 2.8 1.6 4.4 3 5.9C18 10.3 19 12 19 14.4 19 18.2 15.9 21 12 21z" />
      <path d="M12 21c-1.7 0-3-1.2-3-2.9 0-1.4.9-2.4 1.9-3.3.2.9.7 1.4 1.4 1.6.2-1.2.8-2.2 1.8-3 .5 1.4 1.9 2.4 1.9 4.6 0 1.8-1.3 3-4 3z" />
    </svg>
  );
}
