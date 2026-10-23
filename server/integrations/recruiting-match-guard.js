// This guard only vetoes a proposed link. It never chooses a different application.
const normalize = (value) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const word = /[\p{L}\p{N}_]/u;
const identifier = /[\p{L}\p{N}_\-/]/u;

function contains(text, phrase, requisition = false) {
  const boundary = requisition ? identifier : word;
  let position = text.indexOf(phrase);
  while (position !== -1) {
    const end = position + phrase.length;
    const dottedSuffix =
      requisition && text[end] === "." && word.test(text[end + 1] || "");
    const dottedPrefix =
      requisition &&
      text[position - 1] === "." &&
      word.test(text[position - 2] || "");
    if (
      !dottedSuffix &&
      !dottedPrefix &&
      (!position || !boundary.test(text[position - 1])) &&
      (end === text.length || !boundary.test(text[end]))
    )
      return true;
    position = text.indexOf(phrase, position + 1);
  }
  return false;
}

function currentBody(body) {
  const lines = body.split(/\r?\n/u);
  const current = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*>/u.test(line)) continue;
    if (/^\s*on /iu.test(line)) {
      let header = "";
      for (
        let offset = 0;
        offset < 4 && i + offset < lines.length;
        offset += 1
      ) {
        const next = lines[i + offset];
        if (header.length + next.length + 1 > 1000) break;
        header += ` ${next}`;
        if (/wrote:\s*$/iu.test(header)) return current.join("\n");
      }
    }
    if (
      /^\s*on .{1,500}wrote:\s*$/iu.test(line) ||
      /^\s*-{2,}\s*(?:original message|forwarded message)/iu.test(line) ||
      /^\s*begin forwarded message:\s*$/iu.test(line)
    )
      break;
    // A lone From: line can be current content; a header block marks history.
    if (
      /^\s*from:/iu.test(line) &&
      lines
        .slice(i + 1, i + 5)
        .some((next) => /^\s*(?:sent|date|to|subject):/iu.test(next))
    )
      break;
    current.push(line);
  }
  return current.join("\n");
}

export function guardApplicationLink(input, proposedApplicationId) {
  const result = (reason, applicationId = null) => ({ applicationId, reason });
  if (proposedApplicationId === null || proposedApplicationId === undefined)
    return result("no_proposal");
  if (
    !input ||
    typeof input !== "object" ||
    typeof proposedApplicationId !== "string" ||
    typeof input.subject !== "string" ||
    input.subject.length > 4096 ||
    typeof input.body !== "string" ||
    input.body.length > 100000 ||
    !Array.isArray(input.applications) ||
    input.applications.length > 500
  )
    return result("invalid_input");
  const ids = new Set();
  for (const app of input.applications) {
    if (
      !app ||
      typeof app !== "object" ||
      ["id", "company", "title"].some(
        (key) =>
          typeof app[key] !== "string" ||
          app[key].length > 512 ||
          !normalize(app[key]),
      ) ||
      (app.requisition != null &&
        (typeof app.requisition !== "string" ||
          app.requisition.length > 512)) ||
      ids.has(app.id)
    )
      return result("invalid_input");
    ids.add(app.id);
  }
  if (!ids.has(proposedApplicationId)) return result("unknown_application");
  const source = normalize(`${input.subject}\n${currentBody(input.body)}`);
  const individualized =
    /\b(?:your application|you applied|your interview|application for|thank you for applying|your candidacy)\b/u.test(
      source,
    );
  const bulk =
    /\b(?:newsletter|digest|job alerts?|unsubscribe|reaching out|reach out|opportunit(?:y|ies)|interested in)\b/u.test(
      source,
    );
  if (bulk && !individualized) return result("no_source_evidence");
  const candidates = input.applications.map((app) => {
    const company = normalize(app.company);
    const req = app.requisition ? normalize(app.requisition) : "";
    const score = contains(source, company)
      ? req && contains(source, req, true)
        ? 2
        : contains(source, normalize(app.title))
          ? 1
          : 0
      : 0;
    return { id: app.id, score };
  });
  const best = Math.max(0, ...candidates.map((candidate) => candidate.score));
  if (!best) return result("no_source_evidence");
  const winners = candidates.filter((candidate) => candidate.score === best);
  if (winners.length !== 1) return result("ambiguous_source_evidence");
  if (winners[0].id !== proposedApplicationId)
    return result("proposed_application_not_supported");
  return result(
    best === 2 ? "explicit_requisition" : "explicit_company_title",
    proposedApplicationId,
  );
}
