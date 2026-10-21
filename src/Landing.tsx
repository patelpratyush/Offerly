import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  LayoutGrid,
  Leaf,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Pause,
  Play,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import "./landing.css";
import { WorkspaceScene } from "./WorkspaceScene";

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
        <span>YOUR SPACE TO MOVE FORWARD</span>
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
  const root = useRef<HTMLDivElement>(null);
  const toggleMotion = () => setMotionPaused((value) => !value);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
    );
    const sections = root.current.querySelectorAll<HTMLElement>(
      ".lp-feature-main, .lp-feature-pair > article, .lp-headspace, .lp-process-intro, .lp-steps > li, .lp-faq, .lp-final",
    );
    sections.forEach((section, index) => {
      section.classList.add("lp-reveal");
      section.style.transitionDelay = `${(index % 3) * 60}ms`;
      observer.observe(section);
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={root}
      className={`landing${motionPaused ? " lp-motion-paused" : ""}`}
    >
      <a className="lp-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="lp-header">
        <a className="lp-brand" href="/" aria-label="Offerly home">
          <span>
            <Leaf size={21} strokeWidth={1.8} />
          </span>
          offerly<span className="lp-brand-period">.</span>
        </a>
        <nav className="lp-nav" aria-label="Main navigation">
          <a href="#a-little-clarity">The workspace</a>
          <a href="#your-pace">How it works</a>
        </nav>
        <div className="lp-header-actions">
          <a className="lp-signin" href="#signin">
            Sign in <ArrowUpRight size={14} />
          </a>
          <a className="lp-button lp-button-small" href="#signup">
            Get started <ArrowRight size={15} />
          </a>
        </div>
      </header>

      <main className="lp-main" id="landing-content" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-status-dot" /> LESS CHAOS. MORE POSSIBILITY.
            </span>
            <h1 id="landing-title">
              Your next chapter.
              <br />
              <span>A clearer path.</span>
            </h1>
            <p>
              Your job search has a lot of moving parts.
              <br className="lp-desktop-break" /> Give them one calm place to
              come together.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-button" href="#signup">
                Make room for what’s next <ArrowUpRight size={19} />
              </a>
              <a className="lp-text-link" href="#workspace-preview">
                Take a look <ArrowDown size={15} />
              </a>
            </div>
            <div className="lp-hero-note">
              <LockKeyhole size={13} />
              <span>Private by default. Thoughtfully yours.</span>
              <button
                className="lp-motion-control"
                type="button"
                aria-label={
                  motionPaused ? "Play page motion" : "Pause page motion"
                }
                aria-pressed={motionPaused}
                onClick={toggleMotion}
              >
                {motionPaused ? <Play size={11} /> : <Pause size={11} />}
                {motionPaused ? "Play motion" : "Pause motion"}
              </button>
            </div>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-orbit lp-orbit-one" aria-hidden="true" />
            <div className="lp-orbit lp-orbit-two" aria-hidden="true" />
            <div className="lp-floating-label">
              <Sparkles size={15} /> A little more headspace.
            </div>
            <WorkspacePreview />
            <div className="lp-floating-note">
              <span>
                <CircleCheck size={20} />
              </span>
              <div>
                <strong>You’ve got this.</strong>
                <p>One next step is enough.</p>
              </div>
            </div>
            <span className="lp-handwritten" aria-hidden="true">
              a place for your possibilities{" "}
              <svg viewBox="0 0 72 42" fill="none">
                <path
                  d="M2 4C32 1 55 9 58 35m-10-8 11 10 9-13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </section>

        <div
          className="lp-promises"
          aria-label="What belongs in your workspace"
        >
          <span>
            A little structure.
            <br />
            <strong>A lot more clarity.</strong>
          </span>
          <div>
            <BriefcaseBusiness size={18} /> Every opportunity
          </div>
          <div>
            <Users size={18} /> Every connection
          </div>
          <div>
            <CircleCheck size={18} /> Every next step
          </div>
        </div>

        <section
          className="lp-features"
          id="a-little-clarity"
          aria-labelledby="features-title"
        >
          <div className="lp-section-heading">
            <div>
              <span className="lp-eyebrow">
                THE BIG PICTURE. THE LITTLE DETAILS.
              </span>
              <h2 id="features-title">
                A place for every
                <br />
                <span>moving part.</span>
              </h2>
            </div>
            <p>
              Less switching tabs. Less retracing steps.
              <br />
              More energy for the opportunities that feel right.
            </p>
          </div>
          <article className="lp-feature-main">
            <div className="lp-feature-copy">
              <span className="lp-feature-number">01 / THE POSSIBILITIES</span>
              <h3>
                Keep your options open.
                <br />
                And your tabs closed.
              </h3>
              <p>
                Save roles, track applications, and see exactly where things
                stand. From the first “what if” to the final decision, keep the
                full story in one place.
              </p>
              <a className="lp-text-link" href="#signup">
                Meet your workspace <ArrowUpRight size={16} />
              </a>
            </div>
            <div
              className="lp-pipeline"
              aria-label="Example application pipeline"
            >
              <div className="lp-pipeline-header">
                <span>
                  <LayoutGrid size={14} /> Your possibilities
                </span>
                <span>BOARD VIEW</span>
              </div>
              <div className="lp-pipeline-columns">
                {[
                  {
                    title: "Saved",
                    tone: "saved",
                    company: "Forma",
                    role: "Product Designer",
                    initials: "f",
                    next: "Make it yours",
                  },
                  {
                    title: "Interviewing",
                    tone: "interview",
                    company: "Northstar",
                    role: "Design Engineer",
                    initials: "n",
                    next: "Keep the conversation going",
                  },
                  {
                    title: "Offer",
                    tone: "offer",
                    company: "Evergreen",
                    role: "Senior Designer",
                    initials: "e",
                    next: "A new possibility",
                  },
                ].map((item) => (
                  <div
                    className={`lp-pipeline-column ${item.tone}`}
                    key={item.title}
                  >
                    <span className="lp-column-label">
                      <i />
                      {item.title}
                      <small>1</small>
                    </span>
                    <div className="lp-mini-job">
                      <span className={`lp-company-logo ${item.tone}`}>
                        {item.initials}
                        <span>✳</span>
                      </span>
                      <strong>{item.company}</strong>
                      <p>{item.role}</p>
                      <span className="lp-mini-job-footer">
                        {item.next}
                        <ArrowUpRight size={12} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-pipeline-foot">
                <span className="lp-status-dot" /> A clear view of what’s
                possible.<span>Sample applications</span>
              </div>
            </div>
          </article>
          <div className="lp-feature-pair">
            <article className="lp-feature-people">
              <span className="lp-feature-number">02 / THE PEOPLE</span>
              <h3>
                Good opportunities
                <br />
                start with people.
              </h3>
              <p>
                Remember who you met, what you discussed, and which opportunity
                brought you together.
              </p>
              <div className="lp-contact-example">
                <span className="lp-contact-avatar">AL</span>
                <div>
                  <strong>Alex Lee</strong>
                  <span>Recruiter · Northstar</span>
                </div>
                <MessageCircle size={18} />
                <span className="lp-contact-note">
                  A conversation worth remembering.
                </span>
              </div>
            </article>
            <article className="lp-feature-steps">
              <span className="lp-feature-number">03 / THE NEXT STEP</span>
              <h3>
                A big chapter.
                <br />
                One small step at a time.
              </h3>
              <p>
                Keep interviews, tasks, and reminders close. Know what needs
                your attention, and what can wait.
              </p>
              <div className="lp-task-example">
                <span>
                  <Check size={14} />
                </span>
                <div>
                  <strong>Send Alex a thank-you note</strong>
                  <small>A little follow-through goes a long way.</small>
                </div>
                <span className="lp-today-pill">
                  <Clock3 size={11} /> Today
                </span>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-headspace" aria-labelledby="headspace-title">
          <div className="lp-headspace-copy">
            <span className="lp-eyebrow">A LITTLE MORE HEADSPACE</span>
            <h2 id="headspace-title">
              Less to keep in mind.
              <br />
              <span>More room to be you.</span>
            </h2>
            <p>
              Your search deserves a little breathing room. Put the details in
              their place, take a moment, and come back to your next step with a
              clearer head.
            </p>
            <span className="lp-headspace-note">
              <Leaf size={15} /> Good things grow at their own pace.
            </span>
          </div>
          <WorkspaceScene paused={motionPaused} onToggle={toggleMotion} />
        </section>

        <section
          className="lp-process"
          id="your-pace"
          aria-labelledby="process-title"
        >
          <div className="lp-process-intro">
            <span className="lp-eyebrow">YOUR SEARCH. YOUR PACE.</span>
            <h2 id="process-title">
              A fresh start.
              <br />
              <span>Without starting over.</span>
            </h2>
            <p>
              Bring your search as it is. A few open tabs, an existing
              spreadsheet, or just a possibility.
            </p>
            <a className="lp-text-link" href="#signup">
              Find your starting point <ArrowUpRight size={17} />
            </a>
          </div>
          <ol className="lp-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Bring it all together.</h3>
                <p>
                  Add your first role or import your application spreadsheet.
                  Start with what you have.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Make the picture clearer.</h3>
                <p>
                  Connect the people, notes, and next steps that give each
                  opportunity its context.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Move forward, your way.</h3>
                <p>
                  Check in, follow up, and make your next move. Keep the
                  decisions in your hands.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className="lp-faq" aria-labelledby="faq-title">
          <div>
            <span className="lp-eyebrow">A FEW THINGS TO KNOW</span>
            <h2 id="faq-title">
              Before your
              <br />
              <span>next chapter.</span>
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
                import from CSV. Automatic inbox connections are not currently
                available.
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

        <section className="lp-final" aria-labelledby="final-title">
          <div>
            <span className="lp-eyebrow">THERE’S SOMETHING GOOD AHEAD.</span>
            <h2 id="final-title">
              Make room
              <br />
              for <span>what’s next.</span>
            </h2>
            <a className="lp-button lp-button-light" href="#signup">
              Start your next chapter <ArrowUpRight size={19} />
            </a>
            <p>Have an invitation? Your workspace is waiting.</p>
          </div>
          <div className="lp-final-art" aria-hidden="true">
            <div className="lp-art-ring" />
            <ArrowUpRight strokeWidth={0.8} />
            <span>onward, at your own pace.</span>
            <span className="lp-art-star">✳</span>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <a className="lp-brand" href="/" aria-label="Offerly home">
          <span>
            <Leaf size={18} />
          </span>
          offerly<span className="lp-brand-period">.</span>
        </a>
        <span>A little structure. A lot more possibility.</span>
        <a href="#signin">
          Back to your workspace <ArrowDownRight size={15} />
        </a>
      </footer>
    </div>
  );
}
