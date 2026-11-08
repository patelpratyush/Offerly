import { Link } from "react-router";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  LayoutGrid,
  Leaf,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Pause,
  Play,
  Search,
  Users,
} from "lucide-react";
import "../styles/landing.css";
import "../styles/flavor-public.css";

const examples = {
  Saved: {
    company: "Forma",
    role: "Product Designer",
    initial: "f",
    className: "forma",
    task: "Tailor your application",
    detail: "A role worth making time for.",
    count: "03",
  },
  Interviewing: {
    company: "Northstar",
    role: "Design Engineer",
    initial: "n",
    className: "northstar",
    task: "Prepare for your conversation",
    detail: "Next conversation · Thursday",
    count: "02",
  },
  Offer: {
    company: "Evergreen",
    role: "Senior Designer",
    initial: "e",
    className: "evergreen",
    task: "Consider your next chapter",
    detail: "An exciting possibility, on paper.",
    count: "01",
  },
};
type ExampleStage = keyof typeof examples;

function WorkspacePreview() {
  const [stage, setStage] = useState<ExampleStage>("Interviewing");
  const example = examples[stage];
  return (
    <div className="lp-preview" id="workspace-preview">
      <div className="lp-preview-top">
        <span>
          <span className="lp-window-dot" />
          <span className="lp-window-dot" />
          <span className="lp-window-dot" />
        </span>
        <span>SAMPLE WORKSPACE · ILLUSTRATIVE DATA</span>
        <LockKeyhole size={12} />
      </div>
      <div className="lp-demo">
        <div className="lp-demo-sidebar" aria-hidden="true">
          <span className="lp-demo-leaf">
            <Leaf size={18} />
          </span>
          <LayoutGrid size={17} />
          <BriefcaseBusiness size={17} />
          <Users size={17} />
          <span className="lp-demo-avatar">J</span>
        </div>
        <div className="lp-demo-content">
          <div className="lp-demo-breadcrumb">
            My workspace <span>/</span> Applications <Search size={13} />
          </div>
          <div className="lp-demo-title">
            <div>
              <span className="lp-mini-label">ONE STEP AT A TIME</span>
              <h3>Good things ahead.</h3>
            </div>
            <span className="lp-demo-add" aria-hidden="true">
              <Plus size={16} />
            </span>
          </div>
          <div
            className="lp-demo-tabs"
            role="group"
            aria-label="Explore sample application stages"
          >
            {(Object.keys(examples) as ExampleStage[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={stage === item}
                onClick={() => setStage(item)}
              >
                {item}
                <span>{examples[item].count}</span>
              </button>
            ))}
          </div>
          <article className="lp-job-card" key={stage}>
            <div className="lp-job-top">
              <span className={`lp-company-logo ${example.className}`}>
                {example.initial}
                <span>✳</span>
              </span>
              <MoreHorizontal size={19} aria-hidden="true" />
            </div>
            <span className="lp-job-company">{example.company}</span>
            <h4>{example.role}</h4>
            <p>
              Remote <span>·</span> Full-time
            </p>
            <div className="lp-job-bottom">
              <span className="lp-stage">
                <span />
                {stage}
              </span>
              <span
                className="lp-mini-avatars"
                aria-label="Two linked contacts"
              >
                <i>AL</i>
                <i>MK</i>
              </span>
            </div>
          </article>
          <div className="lp-next-step">
            <span className="lp-task-check">
              <Check size={12} />
            </span>
            <div>
              <strong>{example.task}</strong>
              <span>{example.detail}</span>
            </div>
            <ArrowUpRight size={15} aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="lp-preview-caption">
        <span className="lp-status-dot" /> Sample workspace{" "}
        <span>Try a stage above ↗</span>
      </div>
    </div>
  );
}

export function Landing() {
  const [motionPaused, setMotionPaused] = useState(false);
  return (
    <div
      className={`landing lp-editorial${motionPaused ? " lp-motion-paused" : ""}`}
    >
      <a className="lp-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="lp-header">
        <Link className="lp-brand" to="/" aria-label="Offerly home">
          <span>
            <ArrowUpRight size={25} />
          </span>
          offerly<span className="lp-brand-period">.</span>
        </Link>
        <nav className="lp-nav" aria-label="Main navigation">
          <a href="#a-little-clarity">The workspace</a>
          <a href="#your-pace">How it works</a>
        </nav>
        <div className="lp-header-actions">
          <Link className="lp-signin" to="/signin">
            Sign in <ArrowUpRight size={15} />
          </Link>
          <Link className="lp-button lp-button-small" to="/signup">
            Get started <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <main className="lp-main" id="landing-content" tabIndex={-1}>
        <section className="lp-editorial-hero" aria-labelledby="landing-title">
          <div className="lp-editorial-kicker">
            <span>PERSONAL JOB-SEARCH WORKSPACE</span>
            <span>YOUR SEARCH. YOUR RECORD.</span>
          </div>
          <h1 id="landing-title">
            <span>Your next move.</span>
            <span>All the details.</span>
            <span>
              One <i>workspace.</i>
            </span>
          </h1>
          <div className="lp-editorial-intro">
            <span className="lp-section-index" aria-hidden="true">
              ↗
            </span>
            <p>
              Applications, conversations, documents and next steps. A personal
              workspace that keeps your job search moving, with you in control.
            </p>
            <div>
              <Link className="lp-button" to="/signup">
                Start your workspace <ArrowUpRight size={20} />
              </Link>
              <span className="lp-invite-note">
                <LockKeyhole size={13} /> Private by default. Invitation
                required.
              </span>
            </div>
          </div>
        </section>
        <section
          className="lp-product-spread"
          aria-label="Explore the sample workspace"
        >
          <div className="lp-product-caption">
            <span className="lp-section-number">01 / THE WORKSPACE</span>
            <h2>
              Less retracing.
              <br />
              More <i>forward.</i>
            </h2>
            <p>
              A role is more than a row. Keep its people, history, documents and
              next action connected.
            </p>
            <a className="lp-spread-link" href="#workspace-preview">
              Try the sample <ArrowDown size={20} />
            </a>
            <span className="lp-product-disclaimer">
              Illustrative data. Your actual workspace starts with your records.
            </span>
          </div>
          <div className="lp-product-demo">
            <WorkspacePreview />
          </div>
        </section>
        <div className="lp-record-strip">
          <div className="lp-record-track" aria-hidden="true">
            {[0, 1].map((group) => (
              <span key={group}>
                APPLICATIONS <b>↗</b> PEOPLE <b>↗</b> EVIDENCE <b>↗</b> NEXT
                STEPS <b>↗</b>
              </span>
            ))}
          </div>
          <button
            className="lp-motion-control"
            type="button"
            aria-label={motionPaused ? "Play page motion" : "Pause page motion"}
            aria-pressed={motionPaused}
            onClick={() => setMotionPaused((v) => !v)}
          >
            {motionPaused ? <Play size={13} /> : <Pause size={13} />}{" "}
            {motionPaused ? "Play motion" : "Pause motion"}
          </button>
        </div>
        <section
          className="lp-editorial-capabilities"
          id="a-little-clarity"
          aria-labelledby="features-title"
        >
          <div className="lp-editorial-section-head">
            <span className="lp-section-number">02 / EVERY MOVING PART</span>
            <h2 id="features-title">
              The whole search.
              <br />
              <i>Within reach.</i>
            </h2>
          </div>
          <div className="lp-capability-ledger">
            <article>
              <span className="lp-ledger-number">01</span>
              <BriefcaseBusiness size={25} />
              <div>
                <h3>A clear view of every role.</h3>
                <p>
                  Table or board. Filters and saved views. Distinct applications
                  stay distinct, even at the same company.
                </p>
              </div>
              <span className="lp-ledger-tag">APPLICATIONS</span>
            </article>
            <article>
              <span className="lp-ledger-number">02</span>
              <Users size={25} />
              <div>
                <h3>People with context.</h3>
                <p>
                  Remember who you met, what you discussed, and which
                  opportunity brought you together. Keep sources and corrections
                  visible.
                </p>
              </div>
              <span className="lp-ledger-tag">CONNECTIONS</span>
            </article>
            <article>
              <span className="lp-ledger-number">03</span>
              <LayoutGrid size={25} />
              <div>
                <h3>The version you actually sent.</h3>
                <p>
                  Original files, immutable versions and submitted-document
                  records. New uploads never replace your submission history.
                </p>
              </div>
              <span className="lp-ledger-tag">DOCUMENTS</span>
            </article>
            <article>
              <span className="lp-ledger-number">04</span>
              <Clock3 size={25} />
              <div>
                <h3>Know your next move.</h3>
                <p>
                  Tasks, interviews, deadlines and response ownership. See what
                  needs your attention and what is with the employer.
                </p>
              </div>
              <span className="lp-ledger-tag">TODAY</span>
            </article>
          </div>
        </section>
        <section
          className="lp-editorial-process"
          id="your-pace"
          aria-labelledby="process-title"
        >
          <div>
            <span className="lp-section-number">03 / START WHERE YOU ARE</span>
            <h2 id="process-title">
              Your search.
              <br />
              Your pace.
              <br />
              <i>Your decisions.</i>
            </h2>
            <p>
              Bring your search as it is. A few open tabs, an existing
              spreadsheet, or just a possibility.
            </p>
          </div>
          <ol className="lp-editorial-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Bring it all together.</h3>
                <p>
                  Add your first role or import your application spreadsheet.
                  Review the preview before saving.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Make the picture clearer.</h3>
                <p>
                  Connect people, notes, documents and next steps to each
                  opportunity. Keep the original evidence close.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Move forward, your way.</h3>
                <p>
                  Check in, follow up and review proposed updates. Every
                  application change stays in your hands.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="lp-faq" aria-labelledby="faq-title">
          <div>
            <span className="lp-section-number">04 / BEFORE YOU BEGIN</span>
            <h2 id="faq-title">
              Good
              <br />
              <i>questions.</i>
            </h2>
          </div>
          <div className="lp-faq-list">
            <details>
              <summary>
                What can I organize in Offerly?
                <ChevronDown size={18} />
              </summary>
              <p>
                Applications, contacts, interviews, tasks, reminders, document
                records, and notes. Keep the details connected to each
                opportunity, with a timeline to help you retrace your steps.
              </p>
            </details>
            <details>
              <summary>
                Do I need to connect my inbox?
                <ChevronDown size={18} />
              </summary>
              <p>
                No. Your workspace works with information you add yourself or
                import from CSV. Optional read-only Gmail is available only when
                configured for your account. Imports create proposals for your
                review; automatic stage updates remain disabled.
              </p>
            </details>
            <details>
              <summary>
                Can I bring my existing spreadsheet?
                <ChevronDown size={18} />
              </summary>
              <p>
                Yes. Import applications from a CSV, map your columns, and
                review the preview before saving. You can also export your
                applications whenever you need them.
              </p>
            </details>
            <details>
              <summary>
                How do I get started?
                <ChevronDown size={18} />
              </summary>
              <p>
                Create your workspace with your name, email, and a password.
                Offerly currently uses invitation codes for signup, so have your
                invitation ready. Already have an account? Sign in and pick up
                where you left off.
              </p>
            </details>
          </div>
        </section>
        <section className="lp-editorial-final" aria-labelledby="final-title">
          <span className="lp-section-number">READY WHEN YOU ARE.</span>
          <h2 id="final-title">
            Make your
            <br />
            <i>next move.</i>
            <ArrowUpRight aria-hidden="true" />
          </h2>
          <div>
            <Link className="lp-button" to="/signup">
              Start your next chapter <ArrowUpRight size={21} />
            </Link>
            <p>Have an invitation? Your workspace is waiting.</p>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <Link className="lp-brand" to="/" aria-label="Offerly home">
          offerly<span className="lp-brand-period">.</span>
        </Link>
        <span>Your job search, on record.</span>
        <Link to="/signin">
          Back to your workspace <ArrowUpRight size={16} />
        </Link>
      </footer>
    </div>
  );
}
