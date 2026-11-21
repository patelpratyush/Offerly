import { guardApplicationLink } from "./recruiting-match-guard.js";

// Deterministic proposals only. This is not a validated production AI extractor.
const ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
};
// Single pass over the markup: crafted mail with thousands of unclosed tags
// must not trigger regex backtracking.
const BREAK = /^(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])$/;
export function htmlText(html) {
  const lower = html.toLowerCase();
  let out = "",
    i = 0,
    skip = "";
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) {
      if (!skip) out += html.slice(i);
      break;
    }
    if (!skip) out += html.slice(i, open);
    const close = html.indexOf(">", open);
    if (close < 0) break;
    const name = lower.slice(open + 1, close).match(/^\/?[a-z0-9]+/)?.[0] || "";
    if (skip) {
      if (name === "/" + skip) skip = "";
    } else if (["script", "style", "head"].includes(name)) skip = name;
    else if (BREAK.test(name)) out += "\n";
    i = close + 1;
  }
  return out
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39|apos);/gi,
      (_, e) => ENTITIES[e.toLowerCase()],
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
const ATS =
  /(?:myworkdayjobs|myworkday|workday|icims|smartrecruiters|greenhouse|lever|ashbyhq|jobvite|taleo|successfactors|avature|hackerrank\w*)\./i;
const FREE_MAIL =
  /^(?:gmail|googlemail|outlook|hotmail|yahoo|icloud|aol|proton(?:mail)?)\./i;
const TEAM =
  /\s*(?:[-|@·,]\s*)?(?:@\s*\w+|talent acquisition(?: group| team)?|recruiting(?: team)?|recruitment(?: team)?|hiring team|careers|jobs|hr)\s*$/i;
// Mailbox and host words that never name an employer.
const GENERIC =
  /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|support|jobs?|careers?|talent|recruit(?:ing|ment|er)?|hr|hiring|info|mail|email|system|autoreply|auto|admin|team|apply|applications?|candidates?|www|wd\d*|us|eu|myworkday|myworkdayjobs|workday|icims|smartrecruiters|greenhouse|lever|ashbyhq|jobvite|taleo|successfactors|avature|hackerrank\w*|com|net|org|io|co)$/i;
const label = (v) =>
  v.length <= 4 ? v.toUpperCase() : v[0].toUpperCase() + v.slice(1);
const clean = (value = "") => {
  const v = value
    .replace(/\s+/g, " ")
    .replace(/^(?:the|our)\s+/i, "")
    .replace(/[\s!.,:;*]+$/, "")
    .trim();
  return v.length > 1 && v.length <= 120 && v.split(" ").length <= 10 ? v : "";
};
const first = (text, patterns) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1] && clean(m[1])) return clean(m[1]);
  }
  return "";
};
// Prefill for a new application; the user confirms or edits before it is saved.
export function guessEmployer({ subject = "", current = "", from = "" }) {
  const text = `${subject}\n${current}`;
  const atRole = text.match(
    /(?:for|to) the ([^\n]{2,100}?) (?:role|position|opening) (?:at|with) ([^\n.!,]{2,80})/i,
  );
  const possessive = text.match(
    /applying (?:to|at) ([^\n'’]{2,60})['’]s ([^\n]{2,100}?) (?:opening|position|role)/i,
  );
  let company =
    clean(atRole?.[2]) ||
    clean(possessive?.[1]) ||
    first(text, [
      /(?:applying|applied|application) (?:to|at|with) ([^\n!.,]{2,80})/i,
      /interest in (?:joining )?([^\n!.,]{2,80})/i,
      /^update from ([^\n!.,]{2,80})/im,
      /\b(?:join|joining) ([A-Z][^\n!.,]{1,60})/,
    ]);
  const title =
    clean(atRole?.[1]) ||
    clean(possessive?.[2]) ||
    first(text, [
      /\bposition:\**\s*([^\n]{2,100})/i,
      /position of ([^\n]{2,100}?)(?:\.\s|\.$|\n|$)/im,
      /(?:to|for) the ([^\n]{2,100}?) (?:role|position|opening)\b/i,
      /(?:apply|applying) (?:to|for) our ([^\n]{2,100}?)(?:\.\s|\.$|\n|$)/im,
      /received for ([^\n]{2,100}?)(?:\.\s|\.$|\n|$)/im,
    ]);
  if (!company) {
    const email = (from.match(/<([^>]+)>/)?.[1] || from.trim()).toLowerCase();
    const [local = "", domain = ""] = email.split("@");
    const name = from.includes("<")
      ? from.split("<")[0].trim().replace(/^"|"$/g, "").trim()
      : "";
    const stripped = name.replace(TEAM, "").trim();
    if (stripped && (ATS.test(domain) || stripped !== name))
      company = clean(stripped);
    else if (ATS.test(domain)) {
      // ATS senders often encode the employer: choicehotels@myworkday.com,
      // iridium+autoreply@talent.icims.com, acme.wd5.myworkdayjobs.com.
      const tag = local.split("+")[0];
      const sub = domain.split(".").find((part) => !GENERIC.test(part));
      const pick = [tag, sub].find((v) => v && !GENERIC.test(v));
      if (pick) company = label(pick);
    } else if (domain && !FREE_MAIL.test(domain))
      company = label(domain.split(".").slice(-2)[0]);
  }
  if (company && /^(?:us|you|this|a|an)$/i.test(company)) company = "";
  return { company, title };
}
export function parseGmailMessage(message) {
  const headers = message.payload?.headers || [];
  const header = (name) =>
    headers.find((h) => h.name?.toLowerCase() === name)?.value || "";
  const subject = header("subject").slice(0, 4096);
  let bytes = 0;
  function body(part, mime, depth = 0) {
    if (!part || depth > 12 || bytes > 100000 || part.filename) return "";
    if (part.mimeType === mime && part.body?.data) {
      const text = Buffer.from(part.body.data, "base64url").toString("utf8");
      bytes += text.length;
      return text.slice(0, 100000);
    }
    return (part.parts || [])
      .slice(0, 30)
      .map((p) => body(p, mime, depth + 1))
      .join("\n");
  }
  // Many ATS mails (Workday, iCIMS) are HTML-only; fall back to visible text.
  const plain =
    body(message.payload, "text/plain").trim() ||
    htmlText(body(message.payload, "text/html"));
  const current = plain
    .split(
      /\n\s*(?:On .{1,500}wrote:|[-]{2,}\s*(?:Original|Forwarded) message|Begin forwarded message:)/i,
    )[0]
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .slice(0, 100000);
  const source = `${subject}\n${current}`;
  const timestamp = Number(message.internalDate);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const from = header("from");
  const email = from
    .match(
      /(?:<|^|\s)([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?:>|$)/i,
    )?.[1]
    ?.toLowerCase();
  const contacts =
    email &&
    !/(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon)/i.test(email)
      ? [
          {
            email,
            name: from.includes("<")
              ? from
                  .split("<")[0]
                  .trim()
                  .replace(/^"|"$/g, "")
                  .trim()
                  .slice(0, 200)
              : "",
            verified: false,
            source: "Gmail From header",
          },
        ]
      : [];
  return { subject, current, source, timestamp, contacts, from };
}
export function extractRecruitingMessage(message, applications) {
  const parsed = parseGmailMessage(message);
  if (!parsed) return null;
  const { subject, current, source, timestamp, contacts, from } = parsed;
  const rules = [
    [
      "rejection",
      /(?:not (?:be )?moving forward|(?:will|would) not be proceeding|decided to pursue other candidates|(?:decided|chosen) to (?:move|proceed) forward with other candidates|filled (?:this|the) (?:position|role))/i,
      "Rejected",
      "Nobody",
    ],
    ["offer", /(?:pleased to offer you|offer of employment)/i, "Offer", "You"],
    [
      "assessment",
      /(?:complete (?:the |your |an )?(?:online |technical )?assessment)/i,
      "Assessment",
      "You",
    ],
    [
      "confirmation",
      /(?:thank you for applying|received your application)/i,
      "Submitted",
      "Employer",
    ],
    [
      "availability",
      /(?:please (?:send|share|provide) (?:us )?your availability)/i,
      null,
      "You",
    ],
    [
      "interview",
      /(?:your interview (?:is|has been) (?:scheduled|confirmed))/i,
      "Interviewing",
      "You",
    ],
    [
      "cancellation",
      /(?:your interview (?:has been|is) cancel(?:l)?ed)/i,
      null,
      "Unclear",
    ],
    [
      "reschedule",
      /(?:reschedule your interview|your interview has been rescheduled)/i,
      null,
      "You",
    ],
  ];
  let matched = rules.filter(([, pattern]) => pattern.test(source));
  // Rejections almost always open with "thank you for applying"; the rejection wins.
  if (matched.some(([type]) => type === "rejection"))
    matched = matched.filter(([type]) => type !== "confirmation");
  if (matched.length !== 1) return null;
  const [eventType, , stage, owner] = matched[0];
  const candidates = applications.filter(
    (a) =>
      !a.archived &&
      guardApplicationLink({ subject, body: current, applications }, a.id)
        .applicationId === a.id,
  );
  const application = candidates.length === 1 ? candidates[0] : null;
  return {
    sourceId: `gmail:${message.id}`,
    sourceType: "gmail",
    threadId: message.threadId || "",
    excerpt: source.slice(0, 4000),
    sourceUrl: `https://mail.google.com/mail/u/0/#all/${message.id}`,
    effectiveAt: new Date(timestamp).toISOString(),
    effectiveAtBasis: "message_received",
    ...(application
      ? { company: application.company, title: application.title }
      : guessEmployer({ subject, current, from })),
    requisition: application?.requisition || "",
    ...(application ? { applicationId: application.id } : {}),
    changes: { ...(stage ? { stage } : {}), owner },
    eventType,
    contacts,
    parserVersion: "deterministic-review-v1",
    requiresReview: true,
  };
}
