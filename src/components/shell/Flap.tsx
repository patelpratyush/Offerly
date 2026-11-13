import { useEffect, useRef } from "react";

/**
 * Split-flap text. Each character flips in (180ms, staggered 30ms) only when the
 * value changes after first paint. The full text stays available to assistive
 * technology as plain text; the flipping characters are hidden from it.
 */
export function Flap({
  value,
  className = "",
}: {
  value: string | number;
  className?: string;
}) {
  const text = String(value);
  const previous = useRef<string | null>(null);
  const changed = previous.current !== null && previous.current !== text;
  useEffect(() => {
    previous.current = text;
  });
  return (
    <span className={"flap " + className}>
      <span className="sr-only">{text}</span>
      <span
        key={text}
        className={changed ? "flap-run" : undefined}
        aria-hidden="true"
      >
        {Array.from(text).map((character, index) => (
          <span
            key={index}
            className="flap-ch"
            style={{ ["--i" as string]: index }}
          >
            {character === " " ? " " : character}
          </span>
        ))}
      </span>
    </span>
  );
}
