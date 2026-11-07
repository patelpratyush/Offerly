import { guardApplicationLink } from "./recruiting-match-guard.js";

// Deterministic proposals only. This is not a validated production AI extractor.
export function parseGmailMessage(message) {
  const headers = message.payload?.headers || [];
  const header = (name) =>
    headers.find((h) => h.name?.toLowerCase() === name)?.value || "";
  const subject = header("subject").slice(0, 4096);
  let bytes = 0;
  function body(part, depth = 0) {
    if (!part || depth > 12 || bytes > 100000 || part.filename) return "";
    if (part.mimeType === "text/plain" && part.body?.data) {
      const text = Buffer.from(part.body.data, "base64url").toString("utf8");
      bytes += text.length;
      return text.slice(0, 100000);
    }
    return (part.parts || [])
      .slice(0, 30)
      .map((p) => body(p, depth + 1))
      .join("\n");
  }
  const current = body(message.payload)
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
              ? from.split("<")[0].replace(/^"|"$/g, "").trim().slice(0, 200)
              : "",
            verified: false,
            source: "Gmail From header",
          },
        ]
      : [];
  return { subject, current, source, timestamp, contacts };
}
export function extractRecruitingMessage(message, applications) {
  const parsed = parseGmailMessage(message);
  if (!parsed) return null;
  const { subject, current, source, timestamp, contacts } = parsed;
  const rules = [
    [
      "rejection",
      /(?:not (?:be )?moving forward|will not be proceeding|decided to pursue other candidates)/i,
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
  const matched = rules.filter(([, pattern]) => pattern.test(source));
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
    company: application?.company || "",
    title: application?.title || "",
    requisition: application?.requisition || "",
    ...(application ? { applicationId: application.id } : {}),
    changes: { ...(stage ? { stage } : {}), owner },
    eventType,
    contacts,
    parserVersion: "deterministic-review-v1",
    requiresReview: true,
  };
}
