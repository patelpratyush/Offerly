/** Offerly's decorative bloom: shared artwork, animated with CSS transforms. */
export function PossibilityBloom({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`lp-bloom ${className}`}
      viewBox="0 0 420 420"
      fill="none"
      aria-hidden="true"
    >
      <g className="lp-bloom-petals">
        {Array.from({ length: 8 }, (_, index) => (
          <ellipse
            key={index}
            cx="210"
            cy="128"
            rx="43"
            ry="82"
            transform={`rotate(${index * 45} 210 210)`}
            fill={index % 2 === 0 ? "#d7e9a7" : "#a4c780"}
          />
        ))}
      </g>
      <circle cx="210" cy="210" r="31" fill="#173e34" />
      <path
        d="M210 196v28m-14-14h28m-24-10 20 20m0-20-20 20"
        stroke="#d7e9a7"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
