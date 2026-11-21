// Rules the browser and server must agree on. Keep this file dependency-free.
export const sensitiveCategories = [
  "eligibility",
  "sponsorship",
  "salary",
  "relocation",
  "start_date",
];
export const placeholderPattern = /\[\[[^\]\n]{1,200}\]\]/g;
export const findPlaceholders = (...parts) => [
  ...new Set(parts.join("\n").match(placeholderPattern) || []),
];
