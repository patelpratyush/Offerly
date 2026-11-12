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
export const placeholderPattern = /\[\[[^\]\n]{1,200}\]\]/g;
export const findPlaceholders = (...parts) => [
  ...new Set(parts.join("\n").match(placeholderPattern) || []),
];
const firstName = (contact) => contact.name.trim().split(/\s+/)[0];
function greeting(contacts) {
  const names = contacts.map(firstName).filter(Boolean);
  if (!names.length) return "Hi [[recipient name]],";
  if (names.length === 1) return `Hi ${names[0]},`;
  return `Hi ${names.slice(0, -1).join(", ")} and ${names.at(-1)},`;
}
export function generateDraft({
  template,
  application,
  contacts = [],
  round,
  userName,
}) {
  if (!templates.includes(template)) throw new Error("Unknown template");
  const role = application.title,
    company = application.company;
  const notes = [];
  const signOff = `Best,\n${userName || "[[your name]]"}`;
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
    lines = [`I'm following up on the ${role} role at ${company}.`];
    if (application.appliedDate)
      lines[0] += ` My application was submitted on ${application.appliedDate}.`;
    else
      notes.push(
        "No applied date is saved, so the draft does not say when you applied.",
      );
    lines.push(
      "[[add the question or update you want to share, such as the status of the process]]",
      "Thank you for your time.",
    );
  } else if (template === "thank_you") {
    subject = round
      ? `Thank you: ${role} ${round.title}`
      : `Thank you: ${role}`;
    if (round) {
      lines = [
        `Thank you for taking the time to speak with me about the ${role} role at ${company} (${round.title}${round.date ? `, ${round.date}` : ""}).`,
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
      "Thank you again for your time.",
    );
  } else if (template === "availability") {
    subject = `Availability: ${role}`;
    lines = [
      `Thank you for reaching out about the ${role} role at ${company}.`,
      "[[add the days, times and time zone you are available]]",
      "Please let me know what works on your side.",
    ];
  } else if (template === "referral") {
    subject = `Introduction request: ${role} at ${company}`;
    lines = [
      `I'm interested in the ${role} role at ${company} and wanted to ask for your help.`,
      "[[describe how you know this person and why you are asking them]]",
      "If you are comfortable doing so, would you be open to referring me or pointing me to the right person? I can send my resume or any other details that would be useful.",
    ];
    notes.push(
      "The draft does not claim an existing referral. Add your relationship in the placeholder.",
    );
  } else {
    subject = `Deadline extension request: ${role}`;
    lines = [
      `I'm writing about the ${role} role at ${company}.`,
      "[[state the current deadline and what it applies to]]",
      "Would it be possible to extend it to [[requested new date]]? [[add a reason, if you want to share one]]",
      "Thank you for considering this.",
    ];
  }
  const body = [greeting(contacts), ...lines, signOff].join("\n\n");
  return {
    subject,
    body,
    placeholders: findPlaceholders(subject, body),
    notes,
  };
}
