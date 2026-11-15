import { Link } from "react-router";
import {
  ArrowRight,
  Check,
  Compass,
  EyeOff,
  Inbox,
  KanbanSquare,
  Lock,
  PenLine,
} from "lucide-react";
import "../styles/dispatch/public.css";

/* Illustrative sample data only: fictional employers and invented dates.
   The preview is labelled as sample data and never reads real records. */
type Stage =
  | "Saved"
  | "Submitted"
  | "Under review"
  | "Assessment"
  | "Interviewing"
  | "Offer";
const stageTone: Record<Stage, string> = {
  Saved: "neutral",
  Submitted: "neutral",
  "Under review": "neutral",
  Assessment: "warning",
  Interviewing: "accent",
  Offer: "success",
};
const sampleRows: {
  company: string;
  role: string;
  stage: Stage;
  next: string;
  updated: string;
  review?: boolean;
}[] = [
  {
    company: "Northwind Labs",
    role: "Senior Product Designer",
    stage: "Interviewing",
    next: "Panel interview · Thu 10:30",
    updated: "2h",
  },
  {
    company: "Evergreen Studio",
    role: "UX Researcher",
    stage: "Offer",
    next: "Reply to offer by Mon",
    updated: "1d",
  },
  {
    company: "Harbor & Vane",
    role: "Product Manager",
    stage: "Under review",
    next: "Recruiter call proposed",
    updated: "1d",
    review: true,
  },
  {
    company: "Forma",
    role: "Design Engineer",
    stage: "Assessment",
    next: "Take-home due Fri",
    updated: "3d",
  },
  {
    company: "Halcyon Bio",
    role: "Data Analyst",
    stage: "Submitted",
    next: "Waiting on employer",
    updated: "6d",
  },
  {
    company: "Lumen Works",
    role: "Frontend Engineer",
    stage: "Saved",
    next: "Tailor résumé",
    updated: "1w",
  },
];

function Brand() {
  return (
    <Link className="pub-brand" to="/" aria-label="Offerly home">
      <span className="pub-mark" aria-hidden="true">
        O
      </span>
      Offerly
    </Link>
  );
}

function StageTag({ stage }: { stage: Stage }) {
  return (
    <span className={`pub-stage pub-tone-${stageTone[stage]}`}>
      <span className="pub-dot" aria-hidden="true" />
      {stage}
    </span>
  );
}

function ProductPreview() {
  return (
    <figure className="pub-preview" id="workspace-preview">
      <div className="pub-window">
        <aside className="pub-window-side" aria-hidden="true">
          <span className="pub-window-brand">
            <span className="pub-mark pub-mark-sm">O</span>
            Offerly
          </span>
          <span>Today</span>
          <span className="is-active">Applications</span>
          <span>
            Reviews <em>1</em>
          </span>
          <span>Connections</span>
          <span>Documents</span>
          <span>Discover</span>
        </aside>
        <div className="pub-window-main">
          <div className="pub-window-head" aria-hidden="true">
            <span className="pub-window-title">
              Applications <span>6 active</span>
            </span>
            <span className="pub-window-tools">
              <span className="pub-fake-input">Filter…</span>
              <span className="pub-fake-toggle">
                <span className="is-on">Table</span>
                <span>Board</span>
              </span>
              <span className="pub-fake-primary">New application</span>
            </span>
          </div>
          <table className="pub-table">
            <caption className="pub-sr">
              Sample applications table with fictional employers.
            </caption>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Stage</th>
                <th scope="col" className="pub-col-next">
                  Next step
                </th>
                <th scope="col" className="pub-col-updated">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((row) => (
                <tr key={row.company}>
                  <td>
                    <span className="pub-company">{row.company}</span>
                    <span className="pub-role">{row.role}</span>
                  </td>
                  <td>
                    <StageTag stage={row.stage} />
                  </td>
                  <td className="pub-col-next">
                    {row.next}
                    {row.review && (
                      <span className="pub-review-flag">1 to review</span>
                    )}
                  </td>
                  <td className="pub-col-updated">{row.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption>Sample data · fictional employers</figcaption>
    </figure>
  );
}

const pipeline: Stage[] = ["Saved", "Submitted", "Interviewing", "Offer"];

export function Landing() {
  return (
    <div className="landing pub">
      <a className="pub-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="pub-header">
        <div className="pub-header-inner">
          <Brand />
          <nav className="pub-nav" aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <div className="pub-header-actions">
            <Link className="pub-link-button" to="/signin">
              Sign in
            </Link>
            <Link className="pub-button pub-button-sm" to="/signup">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section className="pub-hero" aria-labelledby="landing-title">
          <p className="pub-eyebrow">A private workspace for your job search</p>
          <h1 id="landing-title">
            Every application, contact and next step in one place.
          </h1>
          <p className="pub-lead">
            Offerly keeps your pipeline, people, documents and interviews
            together, so you always know what needs you next. You stay in
            control of every change.
          </p>
          <div className="pub-cta">
            <Link className="pub-button" to="/signup">
              Start your workspace <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <a className="pub-button pub-button-secondary" href="#features">
              See how it works
            </a>
          </div>
          <p className="pub-note">
            Manual tracking works without connecting your inbox. Sign-up may ask
            for an invitation code.
          </p>
        </section>

        <div className="pub-preview-wrap">
          <ProductPreview />
        </div>

        <section
          className="pub-section"
          id="features"
          aria-labelledby="features-title"
        >
          <header className="pub-section-head">
            <h2 id="features-title">Built for a focused, honest search</h2>
            <p>
              Three parts that work together, each one predictable and under
              your control.
            </p>
          </header>
          <div className="pub-features">
            <article className="pub-feature">
              <span className="pub-feature-icon" aria-hidden="true">
                <KanbanSquare size={16} />
              </span>
              <h3>Track the whole pipeline</h3>
              <p>
                A table or board of every role, from saved to offer. Tasks,
                deadlines, contacts and document versions stay attached to each
                application.
              </p>
              <div className="pub-mini pub-mini-pipeline" aria-hidden="true">
                {pipeline.map((stage) => (
                  <StageTag key={stage} stage={stage} />
                ))}
              </div>
            </article>
            <article className="pub-feature">
              <span className="pub-feature-icon" aria-hidden="true">
                <Inbox size={16} />
              </span>
              <h3>Gmail import with a review queue</h3>
              <p>
                Optional read-only Gmail is available only when configured for
                your account. Matching emails become proposed updates that wait
                for you to accept or dismiss. Offerly never sends email.
              </p>
              <div className="pub-mini pub-mini-review" aria-hidden="true">
                <span className="pub-mini-meta">
                  recruiting@northwind.example
                </span>
                <span className="pub-mini-line">
                  Move to <strong>Interviewing</strong>
                </span>
                <span className="pub-mini-actions">
                  <span className="pub-fake-primary">Accept</span>
                  <span className="pub-fake-secondary">Dismiss</span>
                </span>
              </div>
            </article>
            <article className="pub-feature">
              <span className="pub-feature-icon" aria-hidden="true">
                <Compass size={16} />
              </span>
              <h3>Deterministic discovery and prep</h3>
              <p>
                Browse roles from a limited, disclosed set of employer boards,
                matched by rules you can read. Prepare notes, drafts and answers
                next to each application.
              </p>
              <div className="pub-mini pub-mini-list" aria-hidden="true">
                <span>
                  <strong>Product Designer</strong> · Remote
                  <em>Title match</em>
                </span>
                <span>
                  <strong>Design Engineer</strong> · Berlin
                  <em>Location match</em>
                </span>
              </div>
            </article>
          </div>
        </section>

        <section
          className="pub-section pub-privacy"
          id="privacy"
          aria-labelledby="privacy-title"
        >
          <header className="pub-section-head">
            <h2 id="privacy-title">Private by default</h2>
            <p>Your search is yours. Nothing happens without you.</p>
          </header>
          <ul className="pub-privacy-list">
            <li>
              <PenLine size={16} aria-hidden="true" />
              <div>
                <h3>Manual-first</h3>
                <p>
                  Everything works with what you add yourself or import from
                  CSV, with a preview before anything is saved.
                </p>
              </div>
            </li>
            <li>
              <Lock size={16} aria-hidden="true" />
              <div>
                <h3>Read-only Gmail</h3>
                <p>
                  Connecting Gmail is optional. Offerly reads, it never sends,
                  replies or deletes on your behalf.
                </p>
              </div>
            </li>
            <li>
              <EyeOff size={16} aria-hidden="true" />
              <div>
                <h3>No AI by default</h3>
                <p>
                  AI-assisted extraction is off unless you opt in, and stages
                  never change automatically.
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section className="pub-final" aria-labelledby="final-title">
          <h2 id="final-title">Bring your search into one place</h2>
          <ul className="pub-checks">
            <li>
              <Check size={14} aria-hidden="true" /> Import a spreadsheet
            </li>
            <li>
              <Check size={14} aria-hidden="true" /> Export any time
            </li>
          </ul>
          <Link className="pub-button" to="/signup">
            Create your workspace <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="pub-footer">
        <div className="pub-footer-inner">
          <Brand />
          <span>A private workspace for your job search.</span>
          <Link to="/signin">Sign in to your workspace</Link>
        </div>
      </footer>
    </div>
  );
}
