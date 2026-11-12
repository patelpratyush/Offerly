// Deterministic message templates (COM 01). No model is involved. Text is built
// only from the selected application, contacts, round and the signed-in user's
// name. Anything unknown becomes an explicit [[placeholder]] the user must fill.
export const templates = [
  "follow_up",
  "thank_you",
  "availability",
  "referral",
  "deadline_extension",
];
export const templateLabels = {
  follow_up: "Follow-up",
  thank_you: "Thank-you",
  availability: "Availability reply",
  referral: "Referral request",
  deadline_extension: "Deadline extension",
};
// Tone only swaps fixed wording; it never adds facts. "standard" is the
// original wording. All variants keep the same [[placeholders]].
export const tones = ["standard", "concise", "warm", "formal"];
export const toneLabels = {
  standard: "Standard",
  concise: "Concise",
  warm: "Warm",
  formal: "Formal",
};
const toneWords = {
  standard: { hi: "Hi", signOff: "Best,", thanks: "Thank you for your time." },
  concise: { hi: "Hi", signOff: "Thanks,", thanks: "Thanks." },
  warm: {
    hi: "Hi",
    signOff: "Warmly,",
    thanks: "Thank you so much for your time. I really appreciate it.",
  },
  formal: {
    hi: "Dear",
    signOff: "Sincerely,",
    thanks: "Thank you for your time and consideration.",
  },
};
export const placeholderPattern = /\[\[[^\]\n]{1,200}\]\]/g;
export const findPlaceholders = (...parts) => [
  ...new Set(parts.join("\n").match(placeholderPattern) || []),
];
const firstName = (contact) => contact.name.trim().split(/\s+/)[0];
function greeting(contacts, hi = "Hi") {
  const names = contacts.map(firstName).filter(Boolean);
  if (!names.length) return `${hi} [[recipient name]],`;
  if (names.length === 1) return `${hi} ${names[0]},`;
  return `${hi} ${names.slice(0, -1).join(", ")} and ${names.at(-1)},`;
}
export function generateDraft({
  template,
  application,
  contacts = [],
  round,
  userName,
  tone = "standard",
}) {
  if (!templates.includes(template)) throw new Error("Unknown template");
  if (!tones.includes(tone)) throw new Error("Unknown tone");
  const words = toneWords[tone];
  const short = tone === "concise",
    formal = tone === "formal",
    warm = tone === "warm";
  const role = application.title,
    company = application.company;
  const notes = [];
  const signOff = `${words.signOff}\n${userName || "[[your name]]"}`;
  let subject, lines;
  if (!contacts.length)
    notes.push("No recipient is selected. Choose at least one contact.");
  for (const contact of contacts)
    if (!contact.email)
      notes.push(
        `${contact.name} has no email address saved, so they cannot be added to the mail client recipients.`,
      );
  if (template === "follow_up") {
    subject = `Following up: ${role}`;
    lines = [
      short
        ? `Following up on the ${role} role at ${company}.`
        : formal
          ? `I am writing to follow up on the ${role} role at ${company}.`
          : warm
            ? `I hope you're doing well. I wanted to follow up on the ${role} role at ${company}.`
            : `I'm following up on the ${role} role at ${company}.`,
    ];
    if (application.appliedDate)
      lines[0] += short
        ? ` Applied ${application.appliedDate}.`
        : ` My application was submitted on ${application.appliedDate}.`;
    else
      notes.push(
        "No applied date is saved, so the draft does not say when you applied.",
      );
    lines.push(
      "[[add the question or update you want to share, such as the status of the process]]",
      words.thanks,
    );
  } else if (template === "thank_you") {
    subject = round
      ? `Thank you: ${role} ${round.title}`
      : `Thank you: ${role}`;
    if (round) {
      const where = `${round.title}${round.date ? `, ${round.date}` : ""}`;
      lines = [
        short
          ? `Thanks for speaking with me about the ${role} role at ${company} (${where}).`
          : formal
            ? `Thank you for taking the time to speak with me regarding the ${role} role at ${company} (${where}).`
            : warm
              ? `Thank you so much for taking the time to speak with me about the ${role} role at ${company} (${where}). I enjoyed our conversation.`
              : `Thank you for taking the time to speak with me about the ${role} role at ${company} (${where}).`,
      ];
      if (round.status !== "Completed")
        notes.push(
          `This round is marked "${round.status}", not Completed. Confirm it took place before sending a thank-you.`,
        );
    } else {
      lines = [
        `Thank you for your time regarding the ${role} role at ${company}.`,
        "[[select the interview round, or describe which conversation you are thanking them for]]",
      ];
      notes.push(
        "No interview round is selected, so the draft does not state that any interview happened.",
      );
    }
    lines.push(
      "[[add one specific topic you discussed]]",
      short
        ? "Thanks again."
        : formal
          ? "Thank you again for your time and consideration."
          : "Thank you again for your time.",
    );
  } else if (template === "availability") {
    subject = `Availability: ${role}`;
    lines = [
      short
        ? `Thanks for reaching out about the ${role} role at ${company}.`
        : warm
          ? `Thank you so much for reaching out about the ${role} role at ${company}. I'm glad to hear from you.`
          : `Thank you for reaching out about the ${role} role at ${company}.`,
      "[[add the days, times and time zone you are available]]",
      short
        ? "Let me know what works."
        : formal
          ? "Please let me know which of these times is convenient for you."
          : "Please let me know what works on your side.",
    ];
  } else if (template === "referral") {
    subject = `Introduction request: ${role} at ${company}`;
    lines = [
      short
        ? `I'm interested in the ${role} role at ${company} and would value your help.`
        : formal
          ? `I am interested in the ${role} role at ${company} and am writing to ask for your assistance.`
          : warm
            ? `I hope you're well. I'm interested in the ${role} role at ${company} and wanted to ask for your help.`
            : `I'm interested in the ${role} role at ${company} and wanted to ask for your help.`,
      "[[describe how you know this person and why you are asking them]]",
      short
        ? "Could you refer me or point me to the right person? I can send my resume."
        : formal
          ? "If you are comfortable doing so, would you be willing to refer me or direct me to the appropriate person? I would be glad to provide my resume or any other details."
          : "If you are comfortable doing so, would you be open to referring me or pointing me to the right person? I can send my resume or any other details that would be useful.",
    ];
    notes.push(
      "The draft does not claim an existing referral. Add your relationship in the placeholder.",
    );
  } else {
    subject = `Deadline extension request: ${role}`;
    lines = [
      short
        ? `Writing about the ${role} role at ${company}.`
        : formal
          ? `I am writing regarding the ${role} role at ${company}.`
          : `I'm writing about the ${role} role at ${company}.`,
      "[[state the current deadline and what it applies to]]",
      short
        ? "Could it be extended to [[requested new date]]? [[add a reason, if you want to share one]]"
        : formal
          ? "Would it be possible to extend this deadline to [[requested new date]]? [[add a reason, if you want to share one]]"
          : "Would it be possible to extend it to [[requested new date]]? [[add a reason, if you want to share one]]",
      short
        ? "Thanks for considering it."
        : formal
          ? "Thank you for considering this request."
          : "Thank you for considering this.",
    ];
  }
  const body = [greeting(contacts, words.hi), ...lines, signOff].join("\n\n");
  return {
    subject,
    body,
    placeholders: findPlaceholders(subject, body),
    notes,
  };
}
