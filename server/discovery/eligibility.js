// Deterministic eligibility checks from explicit listing text against the
// person's own eligibility answers. Separate from fit scoring: a restriction
// never changes the fit score and a strong fit never waives a restriction.
// Absence of a stated restriction is reported as such, not as a guarantee.
const COUNTRIES = [
  ["US", /\b(?:united states|u\.s\.a?\.?|usa)\b/i],
  ["GB", /\b(?:united kingdom|u\.k\.|uk)\b/i],
  ["CA", /\bcanada\b/i],
  ["DE", /\bgermany\b/i],
  ["IE", /\bireland\b/i],
];
function snippet(text, index, length) {
  const from = Math.max(0, index - 60);
  return text
    .slice(from, Math.min(text.length, index + length + 80))
    .replace(/\s+/g, " ")
    .trim();
}
function find(text, pattern) {
  const match = pattern.exec(text);
  return match
    ? { evidence: snippet(text, match.index, match[0].length), match }
    : null;
}
const result = (check, status, evidence, detail) => ({
  check,
  status,
  evidence,
  detail,
});
export function checkEligibility(job, profile) {
  const text = `${job.title}\n${job.location || ""}\n${job.description || ""}`;
  const answers = profile.eligibility || {};
  const checks = [];
  const auth = find(
    text,
    /(?:authori[sz]ed|eligible|legally (?:entitled|permitted)|right)\s+to\s+work\s+(?:in|within)\s+(?:the\s+)?([A-Za-z.\s]{2,30})/i,
  );
  if (auth) {
    const country = COUNTRIES.find(([, re]) => re.test(auth.match[1]));
    if (country) {
      const given = answers.workAuthorization?.[country[0]] || "unknown";
      checks.push(
        result(
          "work_authorization",
          given === "yes"
            ? "meets"
            : given === "no"
              ? "does_not_meet"
              : "needs_verification",
          auth.evidence,
          given === "unknown"
            ? `You have not answered work authorization for ${country[0]}.`
            : `Your answer for ${country[0]}: ${given}.`,
        ),
      );
    }
  }
  const sponsor = find(
    text,
    /(?:unable|not able|cannot|can't|do not|does not|will not|won't|not)\s+(?:to\s+)?(?:offer|provide|support|available|eligible for)?\s*(?:visa\s+)?sponsor(?:ship)?|no\s+(?:visa\s+)?sponsorship|without\s+(?:visa\s+)?sponsorship/i,
  );
  if (sponsor) {
    const needs = answers.needsSponsorship || "unknown";
    checks.push(
      result(
        "sponsorship",
        needs === "no"
          ? "meets"
          : needs === "yes"
            ? "does_not_meet"
            : "needs_verification",
        sponsor.evidence,
        needs === "unknown"
          ? "The listing says it does not sponsor; you have not said whether you need it."
          : `You said you ${needs === "yes" ? "need" : "do not need"} sponsorship.`,
      ),
    );
  }
  const citizen = find(text, /\bU\.?S\.?\s+citizen(?:ship)?\b/i);
  if (citizen) {
    const given = answers.usCitizen || "unknown";
    checks.push(
      result(
        "citizenship",
        given === "yes"
          ? "meets"
          : given === "no"
            ? "does_not_meet"
            : "needs_verification",
        citizen.evidence,
        given === "unknown"
          ? "You have not answered whether you are a US citizen."
          : `Your answer: ${given}.`,
      ),
    );
  }
  const clearance = find(
    text,
    /(?:security\s+clearance|ts\/sci|top\s+secret|secret\s+clearance)/i,
  );
  if (clearance) {
    const required =
      /(?:active|current|must\s+(?:have|hold)|requires?|required)/i.test(
        text.slice(
          Math.max(0, clearance.match.index - 80),
          clearance.match.index + 120,
        ),
      );
    const given = answers.securityClearance || "unknown";
    checks.push(
      result(
        "clearance",
        given === "active"
          ? "meets"
          : given === "none" && required
            ? "does_not_meet"
            : "needs_verification",
        clearance.evidence,
        given === "unknown"
          ? "You have not answered about security clearance."
          : given === "none" && !required
            ? "Clearance is mentioned but may not be required; verify."
            : `Your answer: ${given}.`,
      ),
    );
  }
  const grad = find(
    text,
    /(?:graduat\w*|class\s+of)[^.\n]{0,40}?\b(20\d{2})\b/i,
  );
  if (grad) {
    const year = Number(grad.match[1]);
    const given = answers.graduationYear;
    checks.push(
      result(
        "graduation",
        given
          ? given === year
            ? "meets"
            : "does_not_meet"
          : "needs_verification",
        grad.evidence,
        given
          ? `Your stated graduation year: ${given}.`
          : "You have not stated a graduation year.",
      ),
    );
  }
  const status = checks.some((c) => c.status === "does_not_meet")
    ? "does_not_meet"
    : checks.some((c) => c.status === "needs_verification")
      ? "needs_verification"
      : "meets";
  return {
    status,
    checks,
    note: checks.length
      ? ""
      : "No explicit eligibility restriction was found in the listing text. This is not a guarantee; confirm on the employer posting.",
  };
}
