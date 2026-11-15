import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowRight, Check, CornerDownLeft, Search } from "lucide-react";

/*
 * Landing showreel: four short, looping product scenes built from markup
 * and CSS keyframes (not video), so they stay crisp, weigh almost nothing
 * and respect prefers-reduced-motion (which shows each scene's end frame).
 * Every name and date is fictional sample data. The stage is decorative
 * (aria-hidden) and each scene is described in text for assistive tech.
 */

const SCENE_MS = 7200;
const W = 640;

type Scene = {
  id: string;
  title: string;
  blurb: string;
  label: string;
  Stage: () => ReactElement;
};

function Cursor() {
  return (
    <svg className="sr-cursor" width="22" height="22" viewBox="0 0 22 22">
      <path
        d="M3 2l15 8.2-6.6 1.6L8.6 18z"
        fill="#13201a"
        stroke="#f6f7f2"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Diamond({ tone }: { tone: string }) {
  return <i className={`sr-dia sr-dia-${tone}`} />;
}

function BoardScene() {
  return (
    <div className="sr-scene sr-board">
      {[
        ["Submitted", "2", "2"],
        ["Interviewing", "2", "1"],
        ["Offer", "0", "1"],
      ].map(([name, before, after], i) => (
        <div key={name} className={`sr-col sr-col-${i}`}>
          <div className="sr-col-head">
            <Diamond tone={["ink", "accent", "success"][i]} />
            {name}
            <span className="sr-flipcount">
              <b>{before}</b>
              <b>{after}</b>
            </span>
          </div>
        </div>
      ))}
      <div className="sr-card" style={{ left: 20, top: 66 }}>
        <strong>Halcyon Bio</strong>
        <span>Data Analyst</span>
        <em className="sr-wait">Waiting · 6d</em>
      </div>
      <div className="sr-card" style={{ left: 20, top: 156 }}>
        <strong>Lumen Works</strong>
        <span>Frontend Engineer</span>
        <em className="sr-wait">Waiting · 2d</em>
      </div>
      <div className="sr-card" style={{ left: 224, top: 66 }}>
        <strong>Northwind Labs</strong>
        <span>Senior Product Designer</span>
        <em className="sr-move">Your move</em>
      </div>
      <div className="sr-slot" style={{ left: 428, top: 66 }} />
      <div className="sr-card sr-mover" style={{ left: 224, top: 156 }}>
        <strong>Evergreen Studio</strong>
        <span>UX Researcher</span>
        <span className="sr-swap">
          <em className="sr-move">Your move</em>
          <em className="sr-offer">
            <Check size={11} /> Offer received
          </em>
        </span>
      </div>
      <div className="sr-toast sr-board-toast">
        <Check size={13} /> Moved to Offer · by you
      </div>
      <Cursor />
    </div>
  );
}

function InboxScene() {
  return (
    <div className="sr-scene sr-inbox">
      <div className="sr-mail">
        <span className="sr-mono">recruiting@northwind.example</span>
        <strong>Panel interview · Northwind Labs</strong>
        <p>
          Thanks for applying! We would love to invite you to a{" "}
          <mark>panel interview on Thu at 10:30</mark>. Reply to confirm.
        </p>
      </div>
      <svg className="sr-wire" width="60" height="40" viewBox="0 0 60 40">
        <path d="M2 20 C 22 20, 30 20, 50 20" />
        <path d="M44 13 L52 20 L44 27" />
      </svg>
      <div className="sr-proposal">
        <span className="sr-mono sr-dim">Proposed update · needs you</span>
        <div className="sr-prow">
          <span>Stage</span>
          <b>
            Submitted <ArrowRight size={12} /> Interviewing
          </b>
        </div>
        <div className="sr-prow">
          <span>Round</span>
          <b>Panel · Thu 10:30</b>
        </div>
        <div className="sr-prow">
          <span>Evidence</span>
          <b>Quoted from email</b>
        </div>
        <div className="sr-actions">
          <span className="sr-btn sr-btn-primary">Accept</span>
          <span className="sr-btn">Dismiss</span>
        </div>
        <span className="sr-stamp">Accepted · by you</span>
      </div>
      <div className="sr-strip">
        <strong>Northwind Labs</strong>
        <span>Senior Product Designer</span>
        <span className="sr-swap sr-strip-stage">
          <em className="sr-pill-stage">
            <Diamond tone="ink" /> Submitted
          </em>
          <em className="sr-pill-stage">
            <Diamond tone="accent" /> Interviewing
          </em>
        </span>
      </div>
      <Cursor />
    </div>
  );
}

function PaletteScene() {
  return (
    <div className="sr-scene sr-palette">
      <div className="sr-ghost-app">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="sr-keys">
        <kbd className="sr-k1">Ctrl</kbd>
        <kbd className="sr-k2">K</kbd>
      </div>
      <div className="sr-pal">
        <div className="sr-pal-input">
          <Search size={16} />
          <span className="sr-typed">northw</span>
          <i className="sr-caret" />
        </div>
        <ul>
          <li className="sr-r1">
            <Diamond tone="accent" />
            <b>Northwind Labs</b> Senior Product Designer
          </li>
          <li className="sr-r2">
            <Diamond tone="ink" />
            <b>Northstar Studio</b> Product Engineer
          </li>
          <li className="sr-r3">
            <b>Add application</b>
          </li>
          <li className="sr-r4">
            <b>Go to Insights</b>
          </li>
        </ul>
        <kbd className="sr-enter">
          <CornerDownLeft size={13} />
        </kbd>
      </div>
      <div className="sr-detail">
        <span className="sr-mono sr-dim">Application</span>
        <strong>Senior Product Designer</strong>
        <span>Northwind Labs · New York</span>
        <div>
          <em className="sr-pill-stage">
            <Diamond tone="accent" /> Interviewing
          </em>
          <em className="sr-move">Your move</em>
        </div>
        <p>Next · Panel interview, Thu 10:30</p>
      </div>
    </div>
  );
}

function TodayScene() {
  return (
    <div className="sr-scene sr-today">
      <div className="sr-stats">
        <div className="sr-stat sr-stat-alert">
          <span className="sr-mono">Overdue</span>
          <span className="sr-flipcount sr-big">
            <b>1</b>
            <b>0</b>
          </span>
        </div>
        <div className="sr-stat">
          <span className="sr-mono">Replies owed</span>
          <span className="sr-big">2</span>
        </div>
        <div className="sr-stat">
          <span className="sr-mono">Pending review</span>
          <span className="sr-big">1</span>
        </div>
      </div>
      <div className="sr-tasks">
        <div className="sr-task sr-t1">
          <span className="sr-check">
            <Check size={13} />
          </span>
          <span className="sr-task-text">
            <b>Send portfolio link</b>
            <span>Forma · Design Engineer</span>
          </span>
          <em className="sr-late">Overdue · Nov 5</em>
        </div>
        <div className="sr-task sr-t2">
          <span className="sr-check" />
          <span className="sr-task-text">
            <b>Reply to offer</b>
            <span>Evergreen Studio · UX Researcher</span>
          </span>
          <em className="sr-move">Your move</em>
        </div>
        <div className="sr-task sr-t3">
          <span className="sr-check" />
          <span className="sr-task-text">
            <b>Prepare panel interview</b>
            <span>Northwind Labs · Thu 10:30</span>
          </span>
          <em className="sr-soon">In 2 days</em>
        </div>
      </div>
      <div className="sr-toast sr-today-toast">
        <Check size={13} /> Nothing overdue. Nice.
      </div>
      <Cursor />
    </div>
  );
}

const scenes: Scene[] = [
  {
    id: "board",
    title: "Move a role forward",
    blurb: "Drag a card between stages. Counts and status follow.",
    label:
      "Animated sample: an Evergreen Studio card is dragged from Interviewing to Offer on the board.",
    Stage: BoardScene,
  },
  {
    id: "inbox",
    title: "Email becomes a proposal",
    blurb: "Offerly quotes the evidence. Nothing changes until you accept.",
    label:
      "Animated sample: a recruiter email is highlighted, turned into a proposed stage change, and accepted by the user.",
    Stage: InboxScene,
  },
  {
    id: "palette",
    title: "Jump anywhere",
    blurb: "Ctrl K, a few letters, Enter. You are on the application.",
    label:
      "Animated sample: the command palette opens, the user types northw and opens Northwind Labs.",
    Stage: PaletteScene,
  },
  {
    id: "today",
    title: "Clear what is due",
    blurb: "Tick off a task and Today re-sorts around what is left.",
    label:
      "Animated sample: an overdue task is checked off and the overdue count drops to zero.",
    Stage: TodayScene,
  },
];

export function Showreel() {
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);
  const [held, setHeld] = useState(false);
  const [calm, setCalm] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setCalm(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Scale the fixed 640×400 stage to the frame width.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      el.style.setProperty("--k", String(entry.contentRect.width / W)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Only play while on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return setVisible(true);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const playing = visible && !held && !calm;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setIndex((i) => (i + 1) % scenes.length);
      setRun((r) => r + 1);
    }, SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, run]);

  const scene = scenes[index];
  const Stage = scene.Stage;
  return (
    <section
      ref={root}
      // Reduced motion must not pause: the 1ms animations need to run to
      // their end frame, otherwise the stage freezes on a blank first frame.
      className={"sr" + (playing || calm ? "" : " is-held")}
      aria-labelledby="showreel-title"
      style={{ ["--scene-ms" as string]: `${SCENE_MS}ms` }}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setHeld(false);
      }}
    >
      <header className="fo-section-head sr-head" data-reveal>
        <span className="fo-index" aria-hidden="true">
          §1
        </span>
        <h2 id="showreel-title">See it move</h2>
        <p>Four everyday moments, played on sample data.</p>
      </header>
      <div className="sr-layout">
        <div className="sr-tabs" role="group" aria-label="Choose a scene">
          {scenes.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="sr-tab"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setRun((r) => r + 1);
              }}
            >
              <span className="sr-tab-num" aria-hidden="true">
                0{i + 1}
              </span>
              <span className="sr-tab-text">
                <strong>{item.title}</strong>
                <span>{item.blurb}</span>
              </span>
              <span className="sr-progress" aria-hidden="true">
                {i === index && <i key={run} />}
              </span>
            </button>
          ))}
        </div>
        <figure className="sr-figure">
          <div className="sr-frame" ref={frame}>
            <div className="sr-chrome" aria-hidden="true">
              <span className="fo-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="sr-url">
                offerly · {scene.title.toLowerCase()}
              </span>
            </div>
            <div className="sr-viewport">
              <div
                className="sr-stage"
                key={`${scene.id}-${run}`}
                role="img"
                aria-label={scene.label}
              >
                <div aria-hidden="true">
                  <Stage />
                </div>
              </div>
            </div>
          </div>
          <figcaption>
            Sample data · fictional employers ·{" "}
            {calm ? "motion reduced" : held ? "paused" : "playing"}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
