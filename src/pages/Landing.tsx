import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Check,
  EyeOff,
  Lock,
  PenLine,
  RotateCcw,
} from "lucide-react";
import "../styles/dispatch/public.css";
import "../styles/field/landing.css";

/* Illustrative sample data only: fictional employers and invented dates.
   The preview is labelled as sample data and never reads real records. */
type Stage =
  | "Saved"
  | "Submitted"
  | "Under review"
  | "Assessment"
  | "Interviewing"
  | "Offer";
type Owner = "you" | "them";
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
  owner: Owner;
  review?: boolean;
}[] = [
  {
    company: "Northwind Labs",
    role: "Senior Product Designer",
    stage: "Interviewing",
    next: "Panel interview · Thu 10:30",
    updated: "2h",
    owner: "you",
  },
  {
    company: "Evergreen Studio",
    role: "UX Researcher",
    stage: "Offer",
    next: "Reply to offer by Mon",
    updated: "1d",
    owner: "you",
  },
  {
    company: "Harbor & Vane",
    role: "Product Manager",
    stage: "Under review",
    next: "Recruiter call proposed",
    updated: "1d",
    owner: "them",
    review: true,
  },
  {
    company: "Forma",
    role: "Design Engineer",
    stage: "Assessment",
    next: "Take-home due Fri",
    updated: "3d",
    owner: "you",
  },
  {
    company: "Halcyon Bio",
    role: "Data Analyst",
    stage: "Submitted",
    next: "Waiting on employer",
    updated: "6d",
    owner: "them",
  },
  {
    company: "Lumen Works",
    role: "Frontend Engineer",
    stage: "Saved",
    next: "Tailor résumé",
    updated: "1w",
    owner: "you",
  },
];

const filters: { id: "all" | Owner; label: string }[] = [
  { id: "all", label: "All" },
  { id: "you", label: "Your move" },
  { id: "them", label: "Waiting" },
];

function Brand() {
  return (
    <Link className="pub-brand fo-brand" to="/" aria-label="Offerly home">
      <span className="fo-mark" aria-hidden="true">
        O
      </span>
      Offerly
    </Link>
  );
}

function StageTag({ stage }: { stage: Stage }) {
  return (
    <span className={`fo-stage fo-tone-${stageTone[stage]}`}>
      <span className="fo-dot" aria-hidden="true" />
      {stage}
    </span>
  );
}

/** Tilts its child a few degrees toward the pointer (fine pointers only). */
function useTilt() {
  const ref = useRef<HTMLDivElement>(null);
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || event.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty("--rx", `${(-y * 5).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 7).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${event.clientX - box.left}px`);
    el.style.setProperty("--my", `${event.clientY - box.top}px`);
  };
  const onPointerLeave = () => {
    ref.current?.style.removeProperty("--rx");
    ref.current?.style.removeProperty("--ry");
  };
  return { ref, onPointerMove, onPointerLeave };
}

function ProductPreview() {
  const [filter, setFilter] = useState<"all" | Owner>("all");
  const tilt = useTilt();
  const count = (id: "all" | Owner) =>
    id === "all"
      ? sampleRows.length
      : sampleRows.filter((row) => row.owner === id).length;
  return (
    <figure className="fo-preview" id="workspace-preview">
      <div className="fo-tilt" {...tilt}>
        <div className="fo-window">
          <div className="fo-window-bar">
            <span className="fo-window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="fo-window-title" aria-hidden="true">
              Applications
            </span>
            <div
              className="fo-filter"
              role="group"
              aria-label="Filter sample applications"
            >
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className="fo-filter-count">{count(item.id)}</span>
                </button>
              ))}
            </div>
          </div>
          <ul className="fo-rows" aria-label="Sample applications">
            {sampleRows.map((row, index) => {
              const shown = filter === "all" || row.owner === filter;
              return (
                <li
                  key={row.company}
                  className={"fo-row" + (shown ? "" : " is-out")}
                  style={{ ["--i" as string]: index }}
                  aria-hidden={shown ? undefined : true}
                >
                  <div className="fo-row-inner">
                    <span className="fo-row-who">
                      <span className="fo-company">{row.company}</span>
                      <span className="fo-role">{row.role}</span>
                    </span>
                    <StageTag stage={row.stage} />
                    <span className="fo-next">
                      {row.owner === "you" && (
                        <span className="fo-move">Your move</span>
                      )}
                      {row.next}
                      {row.review && (
                        <span className="fo-review-flag">1 to review</span>
                      )}
                    </span>
                    <span className="fo-updated">{row.updated}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <figcaption>Sample data · fictional employers</figcaption>
    </figure>
  );
}

/** A working miniature of the review queue. Local state only, sample text. */
function ReviewDemo() {
  const [decision, setDecision] = useState<"" | "accepted" | "dismissed">("");
  return (
    <div className="fo-mini fo-mini-review" data-state={decision || "open"}>
      <span className="fo-mini-meta">recruiting@northwind.example</span>
      <span className="fo-mini-line">
        Move to <strong>Interviewing</strong>
      </span>
      {decision ? (
        <span className="fo-mini-result" role="status">
          {decision === "accepted" ? (
            <>
              <Check size={14} aria-hidden="true" /> Accepted. Stage updated by
              you.
            </>
          ) : (
            <>Dismissed. Nothing changed.</>
          )}
          <button
            type="button"
            className="fo-mini-reset"
            onClick={() => setDecision("")}
            aria-label="Reset sample review"
          >
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <span className="fo-mini-actions">
          <button
            type="button"
            className="fo-chip fo-chip-primary"
            onClick={() => setDecision("accepted")}
          >
            Accept
          </button>
          <button
            type="button"
            className="fo-chip"
            onClick={() => setDecision("dismissed")}
          >
            Dismiss
          </button>
          <span className="fo-mini-hint">Try it · sample</span>
        </span>
      )}
    </div>
  );
}

const pipeline: Stage[] = ["Saved", "Submitted", "Interviewing", "Offer"];
const principles = [
  "Reads, never sends",
  "No AI by default",
  "Stages never move on their own",
  "Export any time",
  "Evidence before every change",
  "Your data, your workspace",
];

export function Landing() {
  return (
    <div className="landing pub fo">
      <a className="pub-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="fo-header">
        <div className="fo-header-inner">
          <Brand />
          <nav className="fo-nav" aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <div className="fo-header-actions">
            <Link className="fo-link" to="/signin">
              Sign in
            </Link>
            <Link className="fo-button fo-button-sm" to="/signup">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section className="fo-hero" aria-labelledby="landing-title">
          <div className="fo-hero-copy">
            <p className="fo-eyebrow">
              <span className="fo-eyebrow-dot" aria-hidden="true" />A private
              workspace for your job search
            </p>
            <h1 id="landing-title">
              Every application, contact and{" "}
              <span className="fo-hl">next step</span> in one place.
            </h1>
            <div className="fo-hero-side">
              <p className="fo-lead">
                Offerly keeps your pipeline, people, documents and interviews
                together, so you always know what needs you next. You stay in
                control of every change.
              </p>
              <div className="fo-cta">
                <Link className="fo-button" to="/signup">
                  Start your workspace{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a className="fo-button fo-button-ghost" href="#features">
                  See how it works
                </a>
              </div>
              <p className="fo-note">
                Manual tracking works without connecting your inbox. Sign-up may
                ask for an invitation code.
              </p>
            </div>
          </div>
          <ProductPreview />
        </section>

        <div className="fo-ticker" aria-hidden="true">
          <div className="fo-ticker-track">
            {[0, 1].map((copy) => (
              <span key={copy}>
                {principles.map((item) => (
                  <span key={item} className="fo-ticker-item">
                    {item}
                    <span className="fo-ticker-sep">✳</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <section
          className="fo-section"
          id="features"
          aria-labelledby="features-title"
        >
          <header className="fo-section-head" data-reveal>
            <span className="fo-index" aria-hidden="true">
              §1
            </span>
            <h2 id="features-title">Built for a focused, honest search</h2>
            <p>
              Three parts that work together, each one predictable and under
              your control.
            </p>
          </header>
          <div className="fo-features">
            <article className="fo-card fo-feature" data-reveal>
              <span className="fo-num" aria-hidden="true">
                01
              </span>
              <h3>Track the whole pipeline</h3>
              <p>
                A table or board of every role, from saved to offer. Tasks,
                deadlines, contacts and document versions stay attached to each
                application.
              </p>
              <div className="fo-mini fo-mini-pipeline" aria-hidden="true">
                <span className="fo-track">
                  <span className="fo-track-dot" />
                </span>
                <span className="fo-track-stages">
                  {pipeline.map((stage) => (
                    <StageTag key={stage} stage={stage} />
                  ))}
                </span>
              </div>
            </article>
            <article className="fo-card fo-feature" data-reveal>
              <span className="fo-num" aria-hidden="true">
                02
              </span>
              <h3>Gmail import with a review queue</h3>
              <p>
                Optional read-only Gmail is available only when configured for
                your account. Matching emails become proposed updates that wait
                for you to accept or dismiss. Offerly never sends email.
              </p>
              <ReviewDemo />
            </article>
            <article className="fo-card fo-feature" data-reveal>
              <span className="fo-num" aria-hidden="true">
                03
              </span>
              <h3>Deterministic discovery and prep</h3>
              <p>
                Browse roles from a limited, disclosed set of employer boards,
                matched by rules you can read. Prepare notes, drafts and answers
                next to each application.
              </p>
              <div className="fo-mini fo-mini-list" aria-hidden="true">
                <span>
                  <span>
                    <strong>Product Designer</strong> · Remote
                  </span>
                  <em>Title match</em>
                </span>
                <span>
                  <span>
                    <strong>Design Engineer</strong> · Berlin
                  </span>
                  <em>Location match</em>
                </span>
              </div>
            </article>
          </div>
        </section>

        <section
          className="fo-privacy"
          id="privacy"
          aria-labelledby="privacy-title"
        >
          <div className="fo-privacy-inner">
            <header className="fo-section-head" data-reveal>
              <span className="fo-index" aria-hidden="true">
                §2
              </span>
              <h2 id="privacy-title">Private by default</h2>
              <p>Your search is yours. Nothing happens without you.</p>
            </header>
            <ul className="fo-privacy-list">
              <li data-reveal>
                <span className="fo-privacy-icon" aria-hidden="true">
                  <PenLine size={18} />
                </span>
                <h3>Manual-first</h3>
                <p>
                  Everything works with what you add yourself or import from
                  CSV, with a preview before anything is saved.
                </p>
              </li>
              <li data-reveal>
                <span className="fo-privacy-icon" aria-hidden="true">
                  <Lock size={18} />
                </span>
                <h3>Read-only Gmail</h3>
                <p>
                  Connecting Gmail is optional. Offerly reads, it never sends,
                  replies or deletes on your behalf.
                </p>
              </li>
              <li data-reveal>
                <span className="fo-privacy-icon" aria-hidden="true">
                  <EyeOff size={18} />
                </span>
                <h3>No AI by default</h3>
                <p>
                  AI-assisted extraction is off unless you opt in, and stages
                  never change automatically.
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section className="fo-final" aria-labelledby="final-title" data-reveal>
          <h2 id="final-title">
            Bring your search into <span className="fo-hl">one place</span>
          </h2>
          <ul className="fo-checks">
            <li>
              <Check size={14} aria-hidden="true" /> Import a spreadsheet
            </li>
            <li>
              <Check size={14} aria-hidden="true" /> Export any time
            </li>
          </ul>
          <Link className="fo-button fo-button-lg" to="/signup">
            Create your workspace <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </main>
      <footer className="fo-footer">
        <div className="fo-footer-inner">
          <Brand />
          <span>A private workspace for your job search.</span>
          <Link to="/signin">Sign in to your workspace</Link>
        </div>
      </footer>
    </div>
  );
}
