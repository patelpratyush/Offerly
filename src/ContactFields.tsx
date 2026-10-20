const sources = ["Manual entry", "Email signature", "Introduction", "Other"];
const fields = [
  ["name", "Full name", "text"],
  ["email", "Email address", "email"],
  ["company", "Employer", "text"],
  ["role", "Role", "text"],
  ["agency", "Recruiting agency", "text"],
  ["hiringCompany", "Hiring company", "text"],
  ["relationshipType", "Relationship type", "select"],
  ["phone", "Phone", "tel"],
  ["linkedinUrl", "LinkedIn URL", "url"],
  ["lastInteraction", "Last interaction", "date"],
  ["notes", "Notes", "textarea"],
];
type Provenance = {
  source: string;
  evidence: string;
  confirmed: boolean;
  confirmedValue?: string;
  recordedAt?: string;
};
type ExtraEmail = Provenance & { email: string };
export function ContactFields({
  data,
  change,
}: {
  data: Record<string, any>;
  change: (key: string, value: any) => void;
}) {
  const provenance = data.provenance || {};
  const updateProvenance = (key: string, updates: Partial<Provenance>) =>
    change("provenance", {
      ...provenance,
      [key]: {
        source: "Manual entry",
        evidence: "",
        confirmed: false,
        ...provenance[key],
        ...updates,
      },
    });
  const emails: ExtraEmail[] = data.additionalEmails || [];
  const updateEmail = (index: number, updates: Partial<ExtraEmail>) =>
    change(
      "additionalEmails",
      emails.map((email, i) =>
        i === index ? { ...email, ...updates } : email,
      ),
    );
  return (
    <>
      <p className="helper-text wide">
        Keep the agency and hiring company separate. Confirm identities only
        after checking them; saving details never confirms a person
        automatically.
      </p>
      {fields.map(([key, label, type]) => {
        const entry: Provenance = provenance[key] || {
          source: "Manual entry",
          evidence: "",
          confirmed: false,
        };
        const edit = (value: string) => {
          change(key, value);
          updateProvenance(key, {
            source: "Manual entry",
            evidence: "",
            confirmed: false,
            confirmedValue: undefined,
          });
          if (key === "email") {
            change("emailConfirmed", false);
            change("emailConfirmedValue", undefined);
          }
        };
        return (
          <div key={key} className={key === "notes" ? "wide" : undefined}>
            <label>
              {label}
              {type === "select" ? (
                <select
                  aria-label={label}
                  value={data[key] || "Unknown"}
                  onChange={(e) => edit(e.target.value)}
                >
                  {[
                    "Unknown",
                    "Recruiter",
                    "Hiring manager",
                    "Interviewer",
                    "Referral",
                    "Other",
                  ].map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : type === "textarea" ? (
                <textarea
                  aria-label={label}
                  value={data[key] || ""}
                  onChange={(e) => edit(e.target.value)}
                  maxLength={10000}
                />
              ) : (
                <input
                  type={type}
                  value={data[key] || ""}
                  onChange={(e) => edit(e.target.value)}
                  required={key === "name"}
                  maxLength={
                    key === "email"
                      ? 254
                      : key === "phone"
                        ? 100
                        : key === "linkedinUrl"
                          ? 2048
                          : 200
                  }
                />
              )}
            </label>
            {!!data[key] &&
              !(key === "relationshipType" && data[key] === "Unknown") && (
                <details>
                  <summary>
                    {label} source · {entry.source}
                    {(key === "email" ? data.emailConfirmed : entry.confirmed)
                      ? " · Confirmed"
                      : " · Unconfirmed"}
                  </summary>
                  <label>
                    {label} source
                    <select
                      aria-label={`${label} source`}
                      value={entry.source}
                      onChange={(e) => {
                        updateProvenance(key, {
                          source: e.target.value,
                          evidence: "",
                          confirmed: false,
                          confirmedValue: undefined,
                        });
                        if (key === "email") {
                          change("emailConfirmed", false);
                          change("emailConfirmedValue", undefined);
                        }
                      }}
                    >
                      {sources.map((source) => (
                        <option key={source}>{source}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {label} evidence
                    <textarea
                      aria-label={`${label} evidence`}
                      value={entry.evidence}
                      required={entry.source !== "Manual entry"}
                      maxLength={2000}
                      placeholder="Where did this detail come from?"
                      onChange={(e) =>
                        updateProvenance(key, { evidence: e.target.value })
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={
                        key === "email"
                          ? !!data.emailConfirmed
                          : entry.confirmed
                      }
                      onChange={(e) => {
                        updateProvenance(key, {
                          confirmed: e.target.checked,
                          confirmedValue: data[key],
                        });
                        if (key === "email") {
                          change("emailConfirmed", e.target.checked);
                          change("emailConfirmedValue", data.email);
                        }
                      }}
                    />
                    {label} confirmed by me
                  </label>
                  {entry.recordedAt && (
                    <small>
                      Recorded {new Date(entry.recordedAt).toLocaleString()}
                    </small>
                  )}
                </details>
              )}
          </div>
        );
      })}
      <fieldset className="wide compensation-fields">
        <legend>Additional email addresses</legend>
        {emails.map((entry, index) => (
          <fieldset key={index}>
            <legend>Email {index + 2}</legend>
            <label>
              Additional email {index + 1}
              <input
                type="email"
                required
                maxLength={254}
                value={entry.email}
                onChange={(e) =>
                  updateEmail(index, {
                    email: e.target.value,
                    confirmed: false,
                    source: "Manual entry",
                    evidence: "",
                    recordedAt: undefined,
                    confirmedValue: undefined,
                  })
                }
              />
            </label>
            <label>
              Email {index + 2} source
              <select
                aria-label={`Email ${index + 2} source`}
                value={entry.source}
                onChange={(e) =>
                  updateEmail(index, {
                    source: e.target.value,
                    evidence: "",
                    confirmed: false,
                    confirmedValue: undefined,
                  })
                }
              >
                {sources.map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </select>
            </label>
            <label>
              Email {index + 2} evidence
              <textarea
                aria-label={`Email ${index + 2} evidence`}
                value={entry.evidence}
                maxLength={2000}
                required={entry.source !== "Manual entry"}
                onChange={(e) =>
                  updateEmail(index, { evidence: e.target.value })
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={entry.confirmed}
                onChange={(e) =>
                  updateEmail(index, {
                    confirmed: e.target.checked,
                    confirmedValue: entry.email,
                  })
                }
              />
              Email {index + 2} confirmed by me
            </label>
            <button
              type="button"
              onClick={() =>
                change(
                  "additionalEmails",
                  emails.filter((_, i) => i !== index),
                )
              }
            >
              Remove email {index + 2}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={emails.length >= 10}
          onClick={() =>
            change("additionalEmails", [
              ...emails,
              {
                email: "",
                source: "Manual entry",
                evidence: "",
                confirmed: false,
              },
            ])
          }
        >
          Add email address
        </button>
      </fieldset>
    </>
  );
}
