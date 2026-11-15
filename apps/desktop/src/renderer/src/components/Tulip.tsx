/** The Hasbihal tulip mark. */
export function Tulip({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 14c-3 0-5-2.5-5-6l2.5 1.5L12 5l2.5 4.5L17 8c0 3.5-2 6-5 6z"
        fill="var(--hb-primary)"
      />
      <path
        d="M12 14v7M12 18.5c-2 0-3.6-1-4.6-2.6M12 18.5c2 0 3.6-1 4.6-2.6"
        fill="none"
        stroke="var(--hb-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
