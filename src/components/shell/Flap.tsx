/**
 * Formerly a split-flap readout. Now renders the value as plain text; the
 * props are unchanged so existing callers keep working.
 */
export function Flap({
  value,
  className = "",
}: {
  value: string | number;
  className?: string;
}) {
  return <span className={("flap " + className).trim()}>{String(value)}</span>;
}
