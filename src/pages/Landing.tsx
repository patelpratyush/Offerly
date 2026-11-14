import { Link } from "react-router";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronDown, Pause, Play } from "lucide-react";
import "../styles/dispatch/public.css";

/* Illustrative sample data only: fictional employers, invented times. The
   board is labeled as a sample on screen and never reads real records. */
type Tone = "move" | "wait" | "late" | "hold" | "ok";
type Row = {
  departs: string;
  company: string;
  role: string;
  gate: string;
  gateWord: string;
  status: string;
  tone: Tone;
};
const scenarios: Record<"Saved" | "Interviewing" | "Offer", Row[]> = {
  Saved: [
    {
      departs: "—",
      company: "Forma",
      role: "Product Designer",
      gate: "SAV",
      gateWord: "Saved",
      status: "YOUR MOVE",
      tone: "move",
    },
    {
      departs: "—",
      company: "Harbor & Vane",
      role: "Design Engineer",
      gate: "SAV",
      gateWord: "Saved",
      status: "YOUR MOVE",
      tone: "move",
    },
    {
      departs: "FRI 17:00",
      company: "Evergreen",
      role: "Senior Designer",
      gate: "PRE",
      gateWord: "Preparing",
      status: "DEADLINE",
      tone: "hold",
    },
    {
      departs: "—",
      company: "Lumen Works",
      role: "UX Researcher",
      gate: "SUB",
      gateWord: "Submitted",
      status: "WAITING 6 D",
      tone: "wait",
    },
  ],
  Interviewing: [
    {
      departs: "THU 10:30",
      company: "Northstar",
      role: "Design Engineer",
      gate: "INT",
      gateWord: "Interviewing",
      status: "YOUR MOVE",
      tone: "move",
    },
    {
      departs: "—",
      company: "Forma",
      role: "Product Designer",
      gate: "ASM",
      gateWord: "Assessment",
      status: "OVERDUE",
      tone: "late",
    },
    {
      departs: "—",
      company: "Lumen Works",
      role: "UX Researcher",
      gate: "REV",
      gateWord: "Under review",
      status: "WAITING 9 D",
      tone: "wait",
    },
    {
      departs: "—",
      company: "Harbor & Vane",
      role: "Design Engineer",
      gate: "SUB",
      gateWord: "Submitted",
      status: "HOLD · 1 REVIEW",
      tone: "hold",
    },
  ],
  Offer: [
    {
      departs: "MON 12:00",
      company: "Evergreen",
      role: "Senior Designer",
      gate: "OFR",
      gateWord: "Offer",
      status: "YOUR MOVE",
      tone: "move",
    },
    {
      departs: "—",
      company: "Northstar",
      role: "Design Engineer",
      gate: "INT",
      gateWord: "Interviewing",
      status: "WAITING 3 D",
      tone: "wait",
    },
    {
      departs: "—",
      company: "Forma",
      role: "Product Designer",
      gate: "REJ",
      gateWord: "Rejected",
      status: "CLOSED",
      tone: "ok",
    },
    {
      departs: "—",
      company: "Lumen Works",
      role: "UX Researcher",
      gate: "WDR",
      gateWord: "Withdrawn",
      status: "CLOSED",
      tone: "ok",
    },
  ],
};
type Scenario = keyof typeof scenarios;
const scenarioOrder = Object.keys(scenarios) as Scenario[];

/** Split-flap text: each character flips in with a 30ms stagger when it changes. */
function Flap({ text }: { text: string }) {
  return (
    <span className="dp-flap" key={text}>
      <span className="dp-sr">{text}</span>
      <span aria-hidden="true">
        {[...text].map((char, i) => (
          <span
            key={i}
            className={char === " " ? "dp-ch dp-ch-gap" : "dp-ch"}
            style={{ "--i": i } as React.CSSProperties}
          >
            {char === " " ? " " : char}
          </span>
        ))}
      </span>
    </span>
  );
}

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function DeparturesBoard() {
  const [scenario, setScenario] = useState<Scenario>("Interviewing");
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(reducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || reduced) return;
    const timer = window.setInterval(
      () =>
        setScenario(
          (current) =>
            scenarioOrder[
              (scenarioOrder.indexOf(current) + 1) % scenarioOrder.length
            ],
        ),
      4800,
    );
    return () => window.clearInterval(timer);
  }, [paused, reduced]);
  const rows = scenarios[scenario];
  return (
    <div className="dp-board" id="workspace-preview">
      <div className="dp-board-bar">
        <span className="dp-board-title">DEPARTURES</span>
        <span className="dp-board-sample">
          SAMPLE · ILLUSTRATIVE DATA · FICTIONAL EMPLOYERS
        </span>
      </div>
      <table className="dp-table">
        <caption className="dp-sr">
          Sample departures board with fictional applications. Your own board
          shows only your records.
        </caption>
        <thead>
          <tr>
            <th scope="col">Departs</th>
            <th scope="col">Service</th>
            <th scope="col">Gate</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={`dp-row dp-tone-${row.tone}`}>
              <td className="dp-departs">
                {row.departs === "—" ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="dp-sr">No date</span>
                  </>
                ) : (
                  <Flap text={row.departs} />
                )}
              </td>
              <td className="dp-service">
                <Flap text={row.company.toUpperCase()} />
                <span className="dp-role">{row.role}</span>
              </td>
              <td className="dp-gate">
                <span className="dp-gate-code">
                  <Flap text={row.gate} />
                </span>
                <span className="dp-gate-word">{row.gateWord}</span>
              </td>
              <td className="dp-status">
                <Flap text={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dp-board-foot">
        <div role="group" aria-label="Explore sample application stages">
          {scenarioOrder.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={scenario === item}
              onClick={() => {
                setScenario(item);
                setPaused(true);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          className="dp-motion"
          type="button"
          aria-label={paused ? "Play page motion" : "Pause page motion"}
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}{" "}
          {paused ? "Play board" : "Pause board"}
        </button>
      </div>
    </div>
  );
}

const lines: [string, string, string, string][] = [
  [
    "APP",
    "Applications",
    "A table or a board of every role. Filters and saved views. Distinct applications stay distinct, even at the same company.",
    "Imports from CSV show a preview before anything is saved.",
  ],
  [
    "PPL",
    "People",
    "Who you met, what you discussed and which application brought you together. Sources and corrections stay visible.",
    "A verified identity is marked differently from one extracted from text.",
  ],
  [
    "DOC",
    "Documents",
    "Original files and immutable versions. The version you submitted is stamped SUBMITTED.",
    "A new upload never replaces your submission history.",
  ],
  [
    "NXT",
    "Next moves",
    "Tasks, interviews, deadlines and who owns the reply, so you can see what needs you and what is with the employer.",
    "Reminders appear in the app. Offerly sends no email on your behalf.",
  ],
  [
    "REV",
    "Review",
    "Proposed changes arrive with the source evidence beside them. You accept or reject each one.",
    "No automatic stage updates. Any AI-assisted extraction is off by default and needs your consent.",
  ],
  [
    "GML",
    "Gmail, optional",
    "Read-only, and only where it has been configured for your account. Manual tracking works without it.",
    "Imports become proposals for your review.",
  ],
  [
    "DSC",
    "Discover and Prepare",
    "Browse jobs collected from a limited, disclosed set of employer boards, then prepare interview notes, drafts and answers.",
    "Coverage is not the whole market. Nothing here is sample data once you sign in.",
  ],
];

const gates: [string, string][] = [
  ["SAV", "Saved"],
  ["PRE", "Preparing"],
  ["SUB", "Submitted"],
  ["REV", "Under review"],
  ["ASM", "Assessment"],
  ["INT", "Interviewing"],
  ["OFR", "Offer"],
  ["REJ", "Rejected"],
  ["WDR", "Withdrawn"],
];

const legend: [string, Tone, string][] = [
  ["YOUR MOVE", "move", "The next reply, task or step is yours."],
  ["WAITING N D", "wait", "Waiting on the employer, for N days."],
  ["OVERDUE", "late", "A task or follow-up has passed its date."],
  ["HOLD", "hold", "A proposed change is waiting for your review."],
];

export function Landing() {
  return (
    <div className="landing dp-landing">
      <a className="dp-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="dp-header">
        <Link className="dp-brand" to="/" aria-label="Offerly home">
          <span className="dp-brand-mark" aria-hidden="true">
            O
          </span>
          offerly
        </Link>
        <nav className="dp-nav" aria-label="Main navigation">
          <a href="#a-little-clarity">What it keeps</a>
          <a href="#your-pace">How to read it</a>
          <a href="#faq">Questions</a>
        </nav>
        <div className="dp-header-actions">
          <Link className="dp-signin" to="/signin">
            Sign in
          </Link>
          <Link className="dp-button dp-button-small" to="/signup">
            Get started <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <main id="landing-content" tabIndex={-1}>
        <section className="dp-hero" aria-labelledby="landing-title">
          <div className="dp-hero-copy">
            <span className="dp-label">
              Personal job-search workspace · Your search, on record
            </span>
            <h1 id="landing-title">
              <span>Your next move.</span>
              <span>All the details.</span>
              <span className="dp-amber">One workspace.</span>
            </h1>
            <p className="dp-lead">
              Every application is a service with a gate, a status and a next
              departure. Offerly keeps applications, people, documents and
              replies on one board, and every change stays in your hands.
            </p>
            <div className="dp-cta">
              <Link className="dp-button" to="/signup">
                Start your workspace <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <span className="dp-note">
                Private by default. Sign-up may ask for an invitation code.
              </span>
            </div>
          </div>
          <DeparturesBoard />
        </section>
        <section
          className="dp-section dp-index"
          id="a-little-clarity"
          aria-labelledby="features-title"
        >
          <header className="dp-section-head">
            <span className="dp-label">01 · What it keeps</span>
            <h2 id="features-title">The whole search, line by line.</h2>
            <p>
              Each line says what Offerly keeps, and what it will not do for
              you.
            </p>
          </header>
          <ol className="dp-lines">
            {lines.map(([code, name, keeps, never]) => (
              <li key={code}>
                <span className="dp-line-code">{code}</span>
                <h3>{name}</h3>
                <p>{keeps}</p>
                <p className="dp-never">{never}</p>
              </li>
            ))}
          </ol>
        </section>
        <section
          className="dp-section dp-route"
          aria-labelledby="gates-title"
        >
          <header className="dp-section-head">
            <span className="dp-label">02 · The line</span>
            <h2 id="gates-title">Nine gates. You move between them.</h2>
            <p>
              Stages are gates. An application changes gate when you change it,
              or when you accept a proposed change with its evidence.
            </p>
          </header>
          <ol className="dp-gates">
            {gates.map(([code, word]) => (
              <li key={code}>
                <span className="dp-node" aria-hidden="true" />
                <span className="dp-gate-code">{code}</span>
                <span className="dp-gate-name">{word}</span>
              </li>
            ))}
          </ol>
        </section>
        <section
          className="dp-section dp-legend-section"
          id="your-pace"
          aria-labelledby="process-title"
        >
          <header className="dp-section-head">
            <span className="dp-label">03 · How to read the board</span>
            <h2 id="process-title">Four words tell you what to do.</h2>
            <p>
              Start with what you have: a few open tabs, a spreadsheet, or a
              single possibility. Add a role, or import a CSV and review the
              preview before saving.
            </p>
          </header>
          <dl className="dp-legend">
            {legend.map(([word, tone, meaning]) => (
              <div key={word} className={`dp-tone-${tone}`}>
                <dt>{word}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section
          className="dp-section dp-faq"
          id="faq"
          aria-labelledby="faq-title"
        >
          <header className="dp-section-head">
            <span className="dp-label">04 · Before you begin</span>
            <h2 id="faq-title">Good questions.</h2>
          </header>
          <div className="dp-faq-list">
            <details>
              <summary>
                What can I organize in Offerly?
                <ChevronDown size={18} aria-hidden="true" />
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
                <ChevronDown size={18} aria-hidden="true" />
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
                <ChevronDown size={18} aria-hidden="true" />
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
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                Create your workspace with your name, email, and a password.
                Depending on how this copy of Offerly is set up, sign-up may ask
                for an invitation code, so have it ready if you were given one.
                Already have an account? Sign in and pick up where you left off.
              </p>
            </details>
          </div>
        </section>
        <section className="dp-final" aria-labelledby="final-title">
          <span className="dp-label">Now boarding</span>
          <h2 id="final-title">Make your next move.</h2>
          <div>
            <Link className="dp-button" to="/signup">
              Start your next chapter <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <p>
              Already have a workspace?{" "}
              <Link to="/signin">Return to your board</Link>
            </p>
          </div>
        </section>
      </main>
      <footer className="dp-footer">
        <Link className="dp-brand" to="/" aria-label="Offerly home">
          <span className="dp-brand-mark" aria-hidden="true">
            O
          </span>
          offerly
        </Link>
        <span>Your job search, on record.</span>
        <Link to="/signin">Back to your workspace</Link>
      </footer>
    </div>
  );
}
