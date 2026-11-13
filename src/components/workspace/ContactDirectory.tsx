import { ArrowUpRight } from "lucide-react";
type Item = { id: string; [key: string]: any };
export function ContactDirectory({
  contacts,
  applications,
  onEdit,
  onOpen,
}: {
  contacts: Item[];
  applications: Item[];
  onEdit: (contact: any) => void;
  onOpen: (application: any) => void;
}) {
  const byId = new Map(applications.map((a) => [a.id, a]));
  return (
    <div className="contact-directory">
      {contacts.map((contact) => {
        const linked = (contact.applicationIds || [])
          .map((id: string) => byId.get(id))
          .filter((a: Item | undefined): a is Item => !!a);
        const source = contact.provenance?.email?.source;
        return (
          <article className="contact-directory-row" key={contact.id}>
            <button
              className="contact-identity"
              onClick={() => onEdit(contact)}
            >
              <span className="avatar" aria-hidden="true">
                {contact.name.charAt(0)}
              </span>
              <span className="dir-name-block">
                <h2>{contact.name}</h2>
                <span className="dir-role">
                  {contact.role || "Role unknown"} ·{" "}
                  {contact.company || "Company unknown"}
                </span>
                <small>
                  {contact.relationshipType || "Unknown relationship"}
                  {contact.agency ? ` · Agency: ${contact.agency}` : ""}
                  {contact.hiringCompany
                    ? ` · Hiring for: ${contact.hiringCompany}`
                    : ""}
                </small>
              </span>
            </button>
            <div className="contact-evidence">
              <span className="dir-email">
                {contact.email || "Email unknown"}
              </span>
              <small>
                {contact.email ? (
                  <span
                    className={`dir-tag ${contact.emailConfirmed ? "is-verified" : "is-extracted"}`}
                  >
                    {contact.emailConfirmed ? (
                      <span aria-hidden="true">✓ </span>
                    ) : null}
                    {contact.emailConfirmed ? "User confirmed" : "Unconfirmed"}
                  </span>
                ) : (
                  "Identity not recorded"
                )}
                {source ? ` · ${source}` : ""}
              </small>
              <small>
                {contact.lastInteraction
                  ? `Last interaction: ${contact.lastInteraction}`
                  : "Last interaction unknown"}
              </small>
            </div>
            <div className="contact-linked">
              <span className="tiny-label">
                {linked.length} LINKED{" "}
                {linked.length === 1 ? "APPLICATION" : "APPLICATIONS"}
              </span>
              {linked.length ? (
                linked.map((a: Item) => (
                  <span className="dir-leader" key={a.id}>
                    <button className="text-button" onClick={() => onOpen(a)}>
                      {a.company} · {a.title}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                    <i aria-hidden="true" />
                    <span className="dir-gate">{a.stage}</span>
                  </span>
                ))
              ) : (
                <small>No linked applications</small>
              )}
            </div>
            <button
              className="secondary contact-edit"
              onClick={() => onEdit(contact)}
              aria-label={`Edit connection ${contact.name}`}
            >
              Edit <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}
