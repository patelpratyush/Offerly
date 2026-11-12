// Company size categories are product definitions, not facts about a company.
// Nothing here estimates headcount; callers supply cited min/max values.
export const SIZE_CATEGORIES = ["Small", "Mid", "Large"];
export const SIZE_LABELS = {
  Small: "Small (1–199)",
  Mid: "Mid-sized (200–999)",
  Large: "Large (1,000+)",
  Unknown: "Unknown",
};
export function categoryOfCount(count) {
  if (!Number.isInteger(count) || count < 1) return "Unknown";
  return count <= 199 ? "Small" : count <= 999 ? "Mid" : "Large";
}
/**
 * Classify a stored estimate. A range spanning categories is `ambiguous` and has
 * category "Unknown" so it can never match a strict filter by accident.
 */
export function classifySize(min, max) {
  const lo = Number.isInteger(min) && min >= 1 ? min : null;
  const hi = Number.isInteger(max) && max >= 1 ? max : null;
  if (lo === null && hi === null)
    return { category: "Unknown", ambiguous: false, categories: [] };
  const a = lo ?? hi,
    b = hi ?? lo;
  if (a > b) return { category: "Unknown", ambiguous: false, categories: [] };
  const first = categoryOfCount(a),
    last = categoryOfCount(b);
  if (first === last)
    return { category: first, ambiguous: false, categories: [first] };
  const categories = SIZE_CATEGORIES.slice(
    SIZE_CATEGORIES.indexOf(first),
    SIZE_CATEGORIES.indexOf(last) + 1,
  );
  return { category: "Unknown", ambiguous: true, categories };
}
/**
 * Strict by default: only confidently classified companies match selected
 * sizes. Ambiguous ranges need includeUncertain; no-evidence Unknown needs
 * includeUnknown. No filter selected means every company passes.
 */
export function sizeMatches(size, filter = {}) {
  const selected = (filter.sizes || []).filter((s) =>
    SIZE_CATEGORIES.includes(s),
  );
  if (!selected.length && !filter.includeUnknown) return true;
  if (size.ambiguous)
    return (
      !!filter.includeUncertain &&
      size.categories.some((category) => selected.includes(category))
    );
  if (size.category === "Unknown") return !!filter.includeUnknown;
  return selected.includes(size.category);
}
export function describeSize(row) {
  const size = classifySize(row.size_min, row.size_max);
  const range =
    row.size_min && row.size_max && row.size_min !== row.size_max
      ? `${row.size_min}–${row.size_max}`
      : String(row.size_min || row.size_max || "");
  return {
    ...size,
    label: size.ambiguous
      ? `Ambiguous (${range} employees spans ${size.categories.join(" and ")})`
      : SIZE_LABELS[size.category],
    estimate: range,
    entity: row.entity_label || "employer",
    entityName: row.entity_name || "",
    sourceUrl: row.size_source_url || "",
    asOf: row.size_as_of || "",
  };
}
