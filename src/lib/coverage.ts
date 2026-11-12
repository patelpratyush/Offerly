// Deterministic text-match coverage (DOC 03). It compares words only: it never
// rewrites the resume, scores ATS compatibility, or implies a hiring outcome.
export type Requirement = {
  text: string;
  terms: string[];
  matched: string[];
  missing: string[];
  status: "found" | "partial" | "gap";
};
export type Coverage = {
  requirements: Requirement[];
  keywords: { term: string; count: number; found: boolean }[];
  counts: { found: number; partial: number; gap: number };
};

const stopwords = new Set(
  (
    "a an and are as at be but by can for from has have in into is it its of on or our that the their them they this to " +
    "was we will with you your who what when where which while within without about across all also any more most other " +
    "such than then these those over per via etc including include includes experience experienced years year ability able " +
    "strong excellent good great plus preferred required requirements responsibilities qualifications skills skill work " +
    "working team teams role roles job company candidate candidates looking help helping new join must should would " +
    "knowledge understanding familiarity familiar proven demonstrated like using use used build building make"
  ).split(" "),
);
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}
export function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9+#./-]*[a-z0-9+#]|[a-z0-9]/g)
      ?.map((t) => t.replace(/[./-]+$/, "")) || []
  );
}
const contentTerms = (text: string) =>
  tokens(text).filter(
    (t) =>
      !stopwords.has(t) &&
      (t.length > 2 ||
        ["c", "r", "go", "ai", "ml", "qa", "ui", "ux", "ci", "cd"].includes(t)),
  );

function requirementLines(description: string): string[] {
  const lines = description
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•·•\d.)]+/, "").trim())
    .filter((l) => l.length >= 12 && l.length <= 400);
  const bulleted = description
    .split(/\r?\n/)
    .filter((l) => /^\s*([-*•·•]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^\s*([-*•·•]|\d+[.)])\s+/, "").trim())
    .filter((l) => l.length >= 12 && l.length <= 400);
  const chosen = bulleted.length
    ? bulleted
    : lines.length > 1
      ? lines
      : description
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 12 && s.length <= 400);
  return [...new Set(chosen)].slice(0, 40);
}

export function analyzeCoverage(resume: string, description: string): Coverage {
  const resumeStems = new Set(tokens(resume).map(stem));
  const has = (term: string) => resumeStems.has(stem(term));
  const requirements: Requirement[] = [];
  for (const text of requirementLines(description)) {
    const terms = [...new Set(contentTerms(text))];
    if (!terms.length) continue;
    const matched = terms.filter(has);
    const missing = terms.filter((t) => !has(t));
    requirements.push({
      text,
      terms,
      matched,
      missing,
      status: !missing.length ? "found" : matched.length ? "partial" : "gap",
    });
  }
  const frequency = new Map<string, number>();
  for (const term of contentTerms(description))
    frequency.set(term, (frequency.get(term) || 0) + 1);
  const keywords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([term, count]) => ({ term, count, found: has(term) }));
  const counts = { found: 0, partial: 0, gap: 0 };
  for (const r of requirements) counts[r.status]++;
  return { requirements, keywords, counts };
}
