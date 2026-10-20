import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Plus,
  Search,
  LayoutGrid,
  List,
  Sun,
  BriefcaseBusiness,
  Users,
  Files,
  Settings,
  ChartNoAxesCombined,
  ArrowRight,
  X,
  Check,
  Upload,
  Download,
  LogOut,
  Leaf,
  ChevronRight,
  Clock,
  Archive,
} from "lucide-react";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./style.css";
import "./workspace.css";
import { ImportDialog } from "./ImportDialog";
import { DuplicateDialog } from "./DuplicateDialog";
import { TrackerActions } from "./TrackerActions";
import { ContactFields } from "./ContactFields";
import { SubmittedDocuments } from "./SubmittedDocuments";
import { OfferFields } from "./OfferFields";
import { ListingSnapshots } from "./ListingSnapshots";
import { RecruitingReview } from "./RecruitingReview";
import { Reminders } from "./Reminders";
import { Timeline } from "./Timeline";
type Item = { id: string; version: number; [key: string]: any };
type Workspace = {
  user: { name: string; email: string; timezone: string; stages: string[] };
  applications: Item[];
  savedViews: Item[];
  contacts: Item[];
  tasks: Item[];
  rounds: Item[];
  documents: Item[];
  documentUsages: Item[];
  listingSnapshots: Item[];
  assessments: Item[];
  evidence: Item[];
  recruitingJobs: Item[];
  reviews: Item[];
  fieldLocks: Item[];
  reminders: Item[];
  duplicates: any[];
  duplicateReviews: Item[];
};
let sessionGeneration = 0;
const sessionChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("offerly-session");
function resetSession(notifyOtherTabs = true) {
  sessionGeneration++;
  window.dispatchEvent(new Event("offerly:session-reset"));
  if (notifyOtherTabs) sessionChannel?.postMessage("reset");
}
if (sessionChannel)
  sessionChannel.onmessage = (event) => {
    if (event.data === "reset") resetSession(false);
  };
async function api(path: string, method = "GET", body?: any) {
  const generation = sessionGeneration;
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
    body:
      body === undefined
        ? ["GET", "HEAD"].includes(method)
          ? undefined
          : "{}"
        : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Request failed" }));
  if (generation !== sessionGeneration)
    throw new Error("Session changed. Request discarded.");
  if (!res.ok) {
    if (res.status === 401 && data.code === "SESSION_REQUIRED")
      window.dispatchEvent(new Event("offerly:session-expired"));
    throw new Error(data.error);
  }
  return data;
}
const emptyApp = {
  company: "",
  title: "",
  stage: "Saved",
  priority: "Medium",
  owner: "Unclear",
  workArrangement: "Unknown",
  employmentType: "Unknown",
  compensationMin: "",
  compensationMax: "",
  compensationCurrency: "",
  compensationPeriod: "Unknown",
  compensationBasis: "Unknown",
  location: "",
  source: "",
  url: "",
  requisition: "",
  appliedDate: "",
  notes: "",
  description: "",
  descriptionCapturedDate: "",
  descriptionSourceUrl: "",
  offerOutcome: "Not recorded",
  offerReceivedDate: "",
  offerDecisionDate: "",
  archived: false,
};
function useDialogFocus(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement;
    const dialogs = document.querySelectorAll<HTMLElement>("[role=dialog]");
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const all = focusable(),
        first = all[0],
        last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [active]);
}
function App() {
  const [w, setW] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("Today"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<{ kind: string; data: any } | null>(null),
    [detail, setDetailState] = useState<Item | null>(null),
    [events, setEvents] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [stage, setStage] = useState("All stages"),
    [priority, setPriority] = useState("Any priority"),
    [owner, setOwner] = useState("Any owner"),
    [board, setBoard] = useState(false),
    [archived, setArchived] = useState(false),
    [detailTab, setDetailTab] = useState("Overview"),
    [companyFilter, setCompanyFilter] = useState(""),
    [sourceFilter, setSourceFilter] = useState(""),
    [arrangement, setArrangement] = useState(""),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [includeUnknownDates, setIncludeUnknownDates] = useState(false),
    [sort, setSort] = useState("recent"),
    [busy, setBusy] = useState(false);
  const account = useRef<string | null>(null);
  const workspaceRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailId = useRef<string | null>(null);
  const activeOperations = useRef(0);
  const setDetail = (value: Item | null) => {
    detailRequest.current++;
    detailId.current = value?.id || null;
    setDetailState(value);
    setEvents([]);
  };
  const loadEvents = async (id: string) => {
    const request = ++detailRequest.current;
    try {
      const result = await api("/events/" + id);
      if (request === detailRequest.current && detailId.current === id)
        setEvents(result);
    } catch (e) {
      if (request === detailRequest.current && detailId.current === id) throw e;
    }
  };
  useEffect(() => {
    const expired = () => {
      if (account.current) resetSession();
    };
    window.addEventListener("offerly:session-expired", expired);
    return () => window.removeEventListener("offerly:session-expired", expired);
  }, []);
  const [selected, setSelected] = useState<Record<string, number>>({});
  useEffect(() => {
    setSelected({});
  }, [
    query,
    stage,
    priority,
    owner,
    companyFilter,
    sourceFilter,
    arrangement,
    dateFrom,
    dateTo,
    includeUnknownDates,
    archived,
    page,
    w?.user.email,
  ]);
  useDialogFocus(!!detail && !modal);
  useEffect(() => {
    if (!detail || modal) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [detail, modal]);
  const refresh = async () => {
    const request = ++workspaceRequest.current;
    const next = await api("/workspace");
    if (request !== workspaceRequest.current) return next;
    if (account.current && account.current !== next.user.email) {
      resetSession();
      return next;
    }
    account.current = next.user.email;
    setW(next);
    return next;
  };
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.message !== "Sign in to continue") setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  const refreshCurrent = useRef(refresh);
  refreshCurrent.current = refresh;
  useEffect(() => {
    if (page !== "Today" || !w?.user.email) return;
    const update = () => {
      if (document.visibilityState === "visible")
        void refreshCurrent.current().catch((e) => setError(e.message));
    };
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [page, w?.user.email]);
  const run = async (fn: () => Promise<any>) => {
    activeOperations.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      activeOperations.current--;
      setBusy(activeOperations.current > 0);
    }
  };
  const showDetail = async (a: Item) => {
    setDetail(a);
    setDetailTab("Overview");
    setEvents([]);
    await run(() => loadEvents(a.id));
  };
  const newRecord = (kind: string, applicationId = "") =>
    setModal({
      kind,
      data:
        kind === "assessment"
          ? {
              title: "",
              applicationId,
              status: "Not started",
              due: "",
              completedDate: "",
              score: "",
              url: "",
              notes: "",
            }
          : kind === "application"
            ? { ...emptyApp }
            : kind === "task"
              ? { title: "", applicationId, due: "", done: false }
              : kind === "contact"
                ? {
                    name: "",
                    email: "",
                    company: "",
                    role: "",
                    agency: "",
                    notes: "",
                    applicationIds: applicationId ? [applicationId] : [],
                  }
                : kind === "round"
                  ? {
                      title: "",
                      applicationId,
                      status: "Invited",
                      date: "",
                      time: "",
                      timezone: w?.user.timezone || "UTC",
                      url: "",
                      notes: "",
                    }
                  : {
                      title: "",
                      label: "Resume",
                      applicationIds: applicationId ? [applicationId] : [],
                      documentId: "",
                    },
    });
  const saveRecord = async (kind: string, data: any) => {
    const result = await api(
      "/records/" + kind + (data.id ? "/" + data.id : ""),
      data.id ? "PUT" : "POST",
      data,
    );
    await refresh();
    if (detail) await loadEvents(detail.id);
    setNotice("Saved to your workspace");
    return result;
  };
  if (loading)
    return (
      <div className="loading">
        <Leaf /> Opening your workspace…
      </div>
    );
  if (!w)
    return (
      <Auth
        error={error}
        onSubmit={(action, data) =>
          run(async () => {
            await api("/auth/" + action, "POST", data);
            sessionChannel?.postMessage("reset");
            await refresh();
          })
        }
        busy={busy}
      />
    );
  const active = w.applications.filter((a) => !a.archived);
  const visible = w.applications
    .filter(
      (a) =>
        a.archived === archived &&
        `${a.company} ${a.title} ${a.location} ${a.source}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (stage === "All stages" || a.stage === stage) &&
        (priority === "Any priority" || a.priority === priority) &&
        (owner === "Any owner" || a.owner === owner) &&
        (!companyFilter || a.company === companyFilter) &&
        (!sourceFilter || (a.source || "Unknown") === sourceFilter) &&
        (!arrangement || (a.workArrangement || "Unknown") === arrangement) &&
        ((!dateFrom && !dateTo) ||
          (!a.appliedDate
            ? includeUnknownDates
            : (!dateFrom || a.appliedDate >= dateFrom) &&
              (!dateTo || a.appliedDate <= dateTo))),
    )
    .sort((a, b) =>
      sort === "company"
        ? a.company.localeCompare(b.company) || a.title.localeCompare(b.title)
        : sort === "priority"
          ? ["High", "Medium", "Low"].indexOf(a.priority) -
            ["High", "Medium", "Low"].indexOf(b.priority)
          : (b.appliedDate || "").localeCompare(a.appliedDate || "") ||
            a.company.localeCompare(b.company),
    );
  const filters = {
    query,
    stage,
    priority,
    owner,
    companyFilter,
    sourceFilter,
    arrangement,
    dateFrom,
    dateTo,
    includeUnknownDates,
    archived,
    board,
    sort,
  };
  const applyView = (v: typeof filters) => {
    setQuery(v.query);
    setStage(v.stage);
    setPriority(v.priority);
    setOwner(v.owner);
    setCompanyFilter(v.companyFilter);
    setSourceFilter(v.sourceFilter);
    setArrangement(v.arrangement);
    setDateFrom(v.dateFrom);
    setDateTo(v.dateTo);
    setIncludeUnknownDates(v.includeUnknownDates);
    setArchived(v.archived);
    setBoard(v.board);
    setSort(v.sort);
    setSelected({});
  };
  const selectApplication = (a: Item, checked: boolean) =>
    setSelected((previous) => {
      const next = { ...previous };
      if (checked && Object.keys(next).length < 100) next[a.id] = a.version;
      else if (!checked) delete next[a.id];
      return next;
    });
  const selectionBox = (a: Item) => (
    <input
      type="checkbox"
      aria-label={`Select ${a.company} · ${a.title}`}
      checked={Object.hasOwn(selected, a.id)}
      disabled={
        busy ||
        (!Object.hasOwn(selected, a.id) && Object.keys(selected).length >= 100)
      }
      onChange={(e) => selectApplication(a, e.target.checked)}
    />
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: w.user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const assessmentDeadlines = w.assessments
    .filter((a) => !["Completed", "Canceled"].includes(a.status))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const tasks = w.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const appName = (id: string) => {
    const a = w.applications.find((a) => a.id === id);
    return a ? `${a.company} · ${a.title}` : "Personal task";
  };
  const nav = [
    ["Today", Sun],
    ["Applications", BriefcaseBusiness],
    ["Reviews", Check],
    ["Connections", Users],
    ["Documents", Files],
    ["Insights", ChartNoAxesCombined],
    ["Settings", Settings],
  ] as const;
  const cards = (apps: Item[]) =>
    apps.map((a) => (
      <div key={a.id} className="selectable-card">
        {page === "Applications" && (
          <label className="card-selection">
            {selectionBox(a)} Select application
          </label>
        )}
        <button className="job-card" onClick={() => showDetail(a)}>
          <div className="card-top">
            <span className="company-icon">
              {a.company.slice(0, 2).toUpperCase()}
            </span>
            <span
              className={"badge " + a.stage.toLowerCase().replaceAll(" ", "-")}
            >
              {a.stage}
            </span>
          </div>
          <strong>{a.title}</strong>
          <span>{a.company}</span>
          <div className="job-metadata">
            <span>{a.workArrangement || "Unknown arrangement"}</span>
            <span className={"priority-label " + a.priority.toLowerCase()}>
              {a.priority} priority
            </span>
          </div>
          <div className="response-line">
            <Clock size={13} />
            {a.owner === "You"
              ? "Your reply is next"
              : a.owner === "Employer"
                ? "Waiting for employer"
                : a.owner === "Nobody"
                  ? "No reply needed"
                  : "Response owner unclear"}
          </div>
          <div className="card-foot">
            <span>{a.location || "Location unknown"}</span>
            <ArrowUpRight size={16} />
          </div>
        </button>
      </div>
    ));
  return (
    <div className="shell" aria-busy={busy}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Today");
          }}
        >
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          offerly<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => {
                setPage(name);
                setQuery("");
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Applications" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">ONE STEP AT A TIME</span>
          <p>
            Your next chapter
            <br />
            starts here.
          </p>
          <span>
            Keep the details here.
            <br />
            Keep your focus ahead.
          </span>
        </div>
        <div className="account">
          <span className="avatar">{w.user.name.charAt(0).toUpperCase()}</span>
          <div>
            <strong>{w.user.name}</strong>
            <small>Personal workspace</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() =>
              run(async () => {
                await api("/logout", "POST");
                resetSession();
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} /> <b>{page}</b>
          </span>
          <span className="private-tag">
            <span /> Private workspace
          </span>
        </header>
        <div className="content">
          {error && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "Today"
                  ? new Intl.DateTimeFormat("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: w.user.timezone,
                    }).format(new Date())
                  : "A LITTLE STRUCTURE. A LOT MORE CLARITY."}
              </div>
              <h1>
                {page === "Today"
                  ? `Make your next move, ${w.user.name.split(" ")[0]}.`
                  : page}
              </h1>
              <p>
                {
                  (
                    {
                      Today: "Your job search, with a clear path forward.",
                      Applications:
                        "Every opportunity. Every step. All in one place.",
                      Connections:
                        "Build relationships that open the right doors.",
                      Documents:
                        "The right version, ready for the right opportunity.",
                      Reviews:
                        "Evidence first. Every update stays in your control.",
                      Insights: "A clearer picture of your progress.",
                      Settings: "Make this workspace work for you.",
                    } as any
                  )[page]
                }
              </p>
            </div>
            {page !== "Settings" &&
              page !== "Insights" &&
              page !== "Reviews" && (
                <button
                  className="primary"
                  onClick={() =>
                    newRecord(
                      page === "Connections"
                        ? "contact"
                        : page === "Documents"
                          ? "document"
                          : "application",
                    )
                  }
                >
                  <Plus size={17} />
                  {page === "Connections"
                    ? "Add connection"
                    : page === "Documents"
                      ? "Upload document"
                      : "Add application"}
                </button>
              )}
          </div>
          {page === "Today" && (
            <>
              <section className="stats">
                {[
                  [
                    "Active applications",
                    active.filter(
                      (a) => !["Rejected", "Withdrawn"].includes(a.stage),
                    ).length,
                    "Opportunities in motion",
                  ],
                  [
                    "Interviews",
                    w.rounds.filter((r) =>
                      ["Invited", "Scheduled", "Rescheduled"].includes(
                        r.status,
                      ),
                    ).length,
                    "Your next conversations",
                  ],
                  [
                    "Offers",
                    active.filter((a) => a.stage === "Offer").length,
                    "Something to celebrate",
                  ],
                  ["Open tasks", tasks.length, "Small steps, real progress"],
                ].map(([label, value, sub]) => (
                  <div className="stat" key={label}>
                    <span>{label}</span>
                    <strong>
                      {value}
                      <ArrowUpRight size={21} />
                    </strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </section>
              <div className="today-grid">
                <section className="panel">
                  <div className="section-head">
                    <h2>
                      Your next steps{" "}
                      <span className="count">{tasks.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => newRecord("task")}
                    >
                      <Plus size={16} /> Add task
                    </button>
                  </div>
                  {tasks.length ? (
                    tasks.map((t) => (
                      <div className="task" key={t.id}>
                        <button
                          aria-label={"Complete " + t.title}
                          className="check-button"
                          disabled={busy}
                          onClick={() =>
                            run(() => saveRecord("task", { ...t, done: true }))
                          }
                        >
                          <Check size={14} />
                        </button>
                        <div>
                          <strong>{t.title}</strong>
                          <small>{appName(t.applicationId)}</small>
                        </div>
                        <span
                          className={
                            t.due && t.due < today ? "overdue" : "muted"
                          }
                        >
                          {t.due
                            ? t.due < today
                              ? "Overdue · " + t.due
                              : t.due
                            : "No deadline"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="A little room to breathe."
                      text="Add a follow-up, a deadline, or one small next step."
                      action="Add your first task"
                      onClick={() => newRecord("task")}
                    />
                  )}
                </section>
                <section className="focus-panel deadlines-panel">
                  <div className="section-head">
                    <span className="tiny-label">UP NEXT</span>
                    <Clock size={18} />
                  </div>
                  <h2>
                    Deadlines to watch
                    <span className="count">{assessmentDeadlines.length}</span>
                  </h2>
                  {assessmentDeadlines.length ? (
                    assessmentDeadlines.slice(0, 3).map((a) => (
                      <button
                        className="deadline-item"
                        key={a.id}
                        onClick={() =>
                          setModal({ kind: "assessment", data: a })
                        }
                      >
                        <span
                          className={
                            "deadline-date " +
                            (a.due && a.due < today ? "late" : "")
                          }
                        >
                          <strong>{a.due ? a.due.slice(8) : "—"}</strong>
                          <small>
                            {a.due
                              ? new Date(a.due + "T12:00:00Z").toLocaleString(
                                  "en-US",
                                  { month: "short", timeZone: "UTC" },
                                )
                              : "No date"}
                          </small>
                        </span>
                        <span>
                          <strong>{a.title}</strong>
                          <small>{appName(a.applicationId)}</small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))
                  ) : (
                    <div className="deadline-empty">
                      <Check size={26} />
                      <strong>No assessment deadlines.</strong>
                      <p>
                        Add an assessment from any application. Its deadline
                        appears here.
                      </p>
                    </div>
                  )}
                  <button
                    className="light-button"
                    onClick={() => setPage("Applications")}
                  >
                    Open your applications <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <section className="panel review-shortcut">
                <div>
                  <h2>Updates to review</h2>
                  <p>
                    {w.reviews.filter((r) => r.status === "pending").length}{" "}
                    pending · Evidence never changes applications without your
                    decision.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setPage("Reviews")}
                >
                  Open reviews
                </button>
              </section>
              <Reminders
                applications={w.applications}
                rounds={w.rounds}
                assessments={w.assessments}
                tasks={w.tasks}
                reminders={w.reminders}
                request={api}
                onChanged={async () => {
                  await refresh();
                }}
              />
              <div className="section-head space-top">
                <h2>Opportunities in motion</h2>
                <button
                  className="text-button"
                  onClick={() => setPage("Applications")}
                >
                  View all applications <ArrowRight size={16} />
                </button>
              </div>
              {active.length ? (
                <div className="card-grid">
                  {cards(active.slice(-3).reverse())}
                </div>
              ) : (
                <section className="panel">
                  <Empty
                    title="Your next chapter is a blank page."
                    text="Add your first application or bring over your spreadsheet."
                    action="Add an application"
                    onClick={() => newRecord("application")}
                  />
                </section>
              )}
              <section className="panel space-top">
                <div className="section-head">
                  <h2>Upcoming conversations</h2>
                  <Clock size={18} />
                </div>
                {w.rounds.filter(
                  (r) =>
                    ["Scheduled", "Rescheduled"].includes(r.status) &&
                    r.date >= today,
                ).length ? (
                  w.rounds
                    .filter(
                      (r) =>
                        ["Scheduled", "Rescheduled"].includes(r.status) &&
                        r.date >= today,
                    )
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((r) => (
                      <div className="task" key={r.id}>
                        <span className="company-icon">
                          <Users size={18} />
                        </span>
                        <div>
                          <strong>{r.title}</strong>
                          <small>{appName(r.applicationId)}</small>
                        </div>
                        <span>
                          {r.date} {r.time} · {r.timezone}
                        </span>
                      </div>
                    ))
                ) : (
                  <p className="muted panel-copy">
                    No upcoming interviews scheduled. Add rounds from an
                    application.
                  </p>
                )}
              </section>
            </>
          )}
          {page === "Reviews" && (
            <RecruitingReview
              applications={w.applications}
              evidence={w.evidence}
              recruitingJobs={w.recruitingJobs}
              reviews={w.reviews}
              fieldLocks={w.fieldLocks}
              stages={w.user.stages}
              request={api}
              onChanged={refresh}
            />
          )}
          {page === "Applications" && (
            <>
              <div
                className="pipeline-strip"
                aria-label="Filter by current stage"
              >
                {["All stages", ...w.user.stages].map((name, i) => (
                  <button
                    key={name}
                    aria-pressed={stage === name}
                    className={stage === name ? "selected" : ""}
                    onClick={() =>
                      setStage(stage === name ? "All stages" : name)
                    }
                  >
                    <span className={"pipeline-mark stage-" + i} />
                    <strong>
                      {
                        w.applications.filter(
                          (a) =>
                            a.archived === archived &&
                            (name === "All stages" || a.stage === name),
                        ).length
                      }
                    </strong>
                    <span>
                      {name === "All stages" ? "All applications" : name}
                    </span>
                  </button>
                ))}
              </div>
              <div className="tracker-surface">
                <div className="toolbar">
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search applications"
                      placeholder="Search company, role, location…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Stage filter"
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                  >
                    {["All stages", ...w.user.stages].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort applications"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recent">Recently applied</option>
                    <option value="company">Company A–Z</option>
                    <option value="priority">Highest priority</option>
                  </select>
                  <div className="view-toggle">
                    <button
                      aria-label="Table view"
                      aria-pressed={!board}
                      className={!board ? "selected" : ""}
                      onClick={() => setBoard(false)}
                    >
                      <List size={18} />
                    </button>
                    <button
                      aria-label="Board view"
                      aria-pressed={board}
                      className={board ? "selected" : ""}
                      onClick={() => setBoard(true)}
                    >
                      <LayoutGrid size={18} />
                    </button>
                  </div>
                </div>
                <TrackerActions
                  views={w.savedViews || []}
                  filters={filters}
                  applyView={applyView}
                  api={api}
                  run={run}
                  busy={busy}
                  refresh={refresh}
                  selected={selected}
                  clearSelection={() => setSelected({})}
                  stages={w.user.stages}
                  notify={setNotice}
                />
                <details className="advanced-filters">
                  <summary>
                    More filters{" "}
                    <span>Company, dates, source & preferences</span>
                  </summary>
                  <div className="filter-grid">
                    <label>
                      Company
                      <select
                        aria-label="Company filter"
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                      >
                        <option value="">All companies</option>
                        {Array.from(
                          new Set(w.applications.map((a) => a.company)),
                        )
                          .sort()
                          .map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Source
                      <select
                        aria-label="Source filter"
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                      >
                        <option value="">All sources</option>
                        {Array.from(
                          new Set(
                            w.applications.map((a) => a.source || "Unknown"),
                          ),
                        )
                          .sort()
                          .map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Work arrangement
                      <select
                        aria-label="Work arrangement filter"
                        value={arrangement}
                        onChange={(e) => setArrangement(e.target.value)}
                      >
                        <option value="">All arrangements</option>
                        {["Remote", "Hybrid", "On-site", "Unknown"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Priority{" "}
                      <select
                        aria-label="Priority filter"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      >
                        {["Any priority", "High", "Medium", "Low"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Next response{" "}
                      <select
                        aria-label="Response owner filter"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                      >
                        {[
                          "Any owner",
                          "You",
                          "Employer",
                          "Nobody",
                          "Unclear",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Applied from
                      <input
                        aria-label="Applied from"
                        type="date"
                        value={dateFrom}
                        max={dateTo || undefined}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </label>
                    <label>
                      Applied through
                      <input
                        aria-label="Applied through"
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={includeUnknownDates}
                        onChange={(e) =>
                          setIncludeUnknownDates(e.target.checked)
                        }
                      />
                      Include unknown dates in date range
                    </label>
                    <button
                      className="text-button"
                      onClick={() => {
                        setCompanyFilter("");
                        setSourceFilter("");
                        setArrangement("");
                        setDateFrom("");
                        setDateTo("");
                        setIncludeUnknownDates(false);
                        setStage("All stages");
                        setPriority("Any priority");
                        setOwner("Any owner");
                        setQuery("");
                      }}
                    >
                      Reset filters
                    </button>
                  </div>
                  {dateFrom && dateTo && dateFrom > dateTo && (
                    <p role="alert" className="form-error">
                      Start date must be on or before end date.
                    </p>
                  )}
                </details>
                <div className="list-meta">
                  <span>
                    {visible.length} opportunities{" "}
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Select first 100 visible applications"
                        disabled={busy || !visible.length}
                        checked={
                          visible.length > 0 &&
                          visible
                            .slice(0, 100)
                            .every((a) => Object.hasOwn(selected, a.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? Object.fromEntries(
                                  visible
                                    .slice(0, 100)
                                    .map((a) => [a.id, a.version]),
                                )
                              : {},
                          )
                        }
                      />{" "}
                      Select visible (up to 100)
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={archived}
                        onChange={(e) => setArchived(e.target.checked)}
                      />{" "}
                      Show archived
                    </label>
                  </span>
                  <div>
                    <button
                      className="text-button"
                      onClick={() => setModal({ kind: "duplicates", data: {} })}
                    >
                      Review duplicates{" "}
                      <span className="count">{w.duplicates.length}</span>
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        setModal({ kind: "import", data: { csv: "" } })
                      }
                    >
                      <Upload size={15} /> Import CSV
                    </button>
                    <a className="text-button" href="/api/export.csv">
                      <Download size={15} /> Export
                    </a>
                  </div>
                </div>
                {!visible.length ? (
                  <section className="panel">
                    <Empty
                      title="Make room for possibility."
                      text="Add an application or adjust your filters to see your opportunities."
                      action="Add application"
                      onClick={() => newRecord("application")}
                    />
                  </section>
                ) : board ? (
                  <div className="board">
                    {w.user.stages.map((s) => (
                      <section className="board-column" key={s}>
                        <h3>
                          <span className="stage-dot" />
                          {s}{" "}
                          <span>
                            {visible.filter((a) => a.stage === s).length}
                          </span>
                        </h3>
                        {cards(visible.filter((a) => a.stage === s))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Select</th>
                          <th>Company & role</th>
                          <th>Stage</th>
                          <th>Location</th>
                          <th>Next response</th>
                          <th>Priority</th>
                          <th>Applied</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((a) => (
                          <tr key={a.id}>
                            <td>{selectionBox(a)}</td>
                            <td>
                              <button
                                className="table-role"
                                onClick={() => showDetail(a)}
                              >
                                <span className="company-icon">
                                  {a.company.slice(0, 2).toUpperCase()}
                                </span>
                                <span>
                                  <strong>{a.title}</strong>
                                  <small>{a.company}</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <span
                                className={
                                  "badge " +
                                  a.stage.toLowerCase().replaceAll(" ", "-")
                                }
                              >
                                {a.stage}
                              </span>
                            </td>
                            <td>{a.location || "Unknown"}</td>
                            <td>{a.owner}</td>
                            <td>
                              <span
                                className={
                                  "priority " + a.priority.toLowerCase()
                                }
                              >
                                ●
                              </span>{" "}
                              {a.priority}
                            </td>
                            <td>{a.appliedDate || "Unknown"}</td>
                            <td>
                              <button
                                aria-label={"Open " + a.title}
                                onClick={() => showDetail(a)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
          {page === "Connections" && (
            <>
              <label className="search standalone">
                <Search size={17} />
                <input
                  aria-label="Search connections"
                  placeholder="Search people or companies…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="card-grid">
                {w.contacts
                  .filter((c) =>
                    `${c.name} ${c.company} ${c.email} ${c.agency} ${c.hiringCompany || ""} ${c.role} ${c.phone || ""} ${(c.additionalEmails || []).map((e: any) => e.email).join(" ")}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      className="person-card"
                      onClick={() => setModal({ kind: "contact", data: c })}
                    >
                      <span className="avatar">{c.name.charAt(0)}</span>
                      <h2>{c.name}</h2>
                      <p>
                        {c.role || "Role unknown"} ·{" "}
                        {c.company || "Company unknown"}
                      </p>
                      <small>
                        {c.email || "Email unknown"}{" "}
                        {c.email
                          ? c.emailConfirmed
                            ? "· User confirmed"
                            : "· Unconfirmed"
                          : ""}
                      </small>
                      <small>
                        {c.relationshipType || "Unknown relationship"}
                        {c.agency ? ` · Agency: ${c.agency}` : ""}
                      </small>
                      <small>
                        {c.lastInteraction
                          ? `Last interaction: ${c.lastInteraction}`
                          : "Last interaction unknown"}
                      </small>
                      <div className="card-foot">
                        {c.applicationIds.length} linked applications{" "}
                        <ArrowUpRight size={16} />
                      </div>
                    </button>
                  ))}
              </div>
              {!w.contacts.length && (
                <section className="panel">
                  <Empty
                    title="Your people, in one place."
                    text="Keep recruiter details and relationships close to the opportunity."
                    action="Add connection"
                    onClick={() => newRecord("contact")}
                  />
                </section>
              )}
            </>
          )}
          {page === "Documents" && (
            <>
              <p className="subtle-info">
                Each upload creates an immutable version. Previously attached
                documents stay exactly as uploaded.
              </p>
              <div className="card-grid">
                {w.documents.map((d) => (
                  <article className="document-card" key={d.id}>
                    <span className="file-icon">
                      <Files size={26} />
                    </span>
                    <span className="badge">{d.label}</span>
                    <h2>{d.title}</h2>
                    <p>{d.applicationIds.length} linked applications</p>
                    <p>
                      {d.versionNumber
                        ? `Version ${d.versionNumber}`
                        : "Legacy version"}{" "}
                      ·{" "}
                      {d.createdAt
                        ? new Date(d.createdAt).toLocaleDateString("en-US", {
                            timeZone: w.user.timezone,
                          })
                        : "Upload date unknown"}
                    </p>
                    <p>
                      {
                        (w.documentUsages || []).filter(
                          (u) => u.documentVersionId === d.id && !u.retracted,
                        ).length
                      }{" "}
                      recorded submissions
                    </p>
                    <a className="text-button" href={"/api/files/" + d.fileId}>
                      <Download size={16} /> Download original
                    </a>
                    <button
                      className="text-button"
                      onClick={() =>
                        setModal({
                          kind: "document",
                          data: {
                            title: d.title,
                            label: d.label,
                            documentId: d.documentId || d.id,
                            applicationIds: [],
                          },
                        })
                      }
                    >
                      <Plus size={16} /> New version
                    </button>
                  </article>
                ))}
              </div>
              {!w.documents.length && (
                <section className="panel">
                  <Empty
                    title="A home for your best work."
                    text="Upload resumes and cover letters. Keep the exact version used for each application."
                    action="Upload document"
                    onClick={() => newRecord("document")}
                  />
                </section>
              )}
            </>
          )}
          {page === "Insights" && (
            <section className="panel">
              <div className="section-head">
                <h2>Your pipeline today</h2>
                <span className="muted">
                  {w.applications.length} total applications
                </span>
              </div>
              <div className="insights">
                {w.user.stages.map((s) => (
                  <div className="bar-row" key={s}>
                    <span>{s}</span>
                    <div>
                      <i
                        style={{
                          width:
                            (w.applications.filter((a) => a.stage === s)
                              .length /
                              Math.max(w.applications.length, 1)) *
                              100 +
                            "%",
                        }}
                      />
                    </div>
                    <b>{w.applications.filter((a) => a.stage === s).length}</b>
                  </div>
                ))}
              </div>
              <p className="panel-copy muted">
                Current stage counts include archived applications. Historical
                conversion and time-in-stage metrics are planned.
              </p>
              <a className="text-button panel-copy" href="/api/export.csv">
                <Download size={16} /> Export application data
              </a>
            </section>
          )}
          {page === "Settings" && (
            <SettingsPage
              w={w}
              busy={busy}
              run={run}
              refresh={refresh}
              logout={() => resetSession()}
            />
          )}
          <footer>
            Built for your next chapter.<span>Offerly · Manual workspace</span>
          </footer>
        </div>
      </main>
      {detail && (
        <div className="overlay" onClick={() => setDetail(null)}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Application details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-top">
              <span className="eyebrow">APPLICATION DETAILS</span>
              <button
                aria-label="Close details"
                autoFocus
                onClick={() => setDetail(null)}
              >
                <X />
              </button>
            </div>
            <span className="company-icon large">
              {detail.company.slice(0, 2).toUpperCase()}
            </span>
            <h1>{detail.title}</h1>
            <p className="muted">
              {detail.company} · {detail.location || "Location unknown"}
            </p>
            <div className="detail-actions">
              <button
                className="primary"
                onClick={() => setModal({ kind: "application", data: detail })}
              >
                Edit application
              </button>
              {detail.url && (
                <a
                  className="secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={detail.url}
                >
                  View listing <ArrowUpRight size={15} />
                </a>
              )}
              <button
                className="secondary"
                onClick={() =>
                  run(async () => {
                    const a = await saveRecord("application", {
                      ...detail,
                      archived: !detail.archived,
                    });
                    setDetail(a);
                    await loadEvents(a.id);
                  })
                }
              >
                <Archive size={16} />
                {detail.archived ? "Restore" : "Archive"}
              </button>
            </div>
            <div
              className="detail-tabs"
              role="group"
              aria-label="Application sections"
            >
              {["Overview", "Activity", "People & files"].map((tab) => (
                <button
                  aria-pressed={detailTab === tab}
                  key={tab}
                  className={detailTab === tab ? "selected" : ""}
                  onClick={() => setDetailTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            {detailTab === "Overview" && (
              <>
                <div className="detail-summary">
                  <div>
                    <small>Stage</small>
                    <span className="badge">{detail.stage}</span>
                  </div>
                  <div>
                    <small>Next response</small>
                    <strong>{detail.owner}</strong>
                  </div>
                  <div>
                    <small>Priority</small>
                    <strong>{detail.priority}</strong>
                  </div>
                  <div>
                    <small>Applied</small>
                    <strong>{detail.appliedDate || "Unknown"}</strong>
                  </div>
                </div>
                <section className="offer-summary" aria-label="Offer outcome">
                  <h2>Offer outcome</h2>
                  <p>
                    <strong>{detail.offerOutcome || "Not recorded"}</strong>
                  </p>
                  <p>
                    Received: {detail.offerReceivedDate || "Unknown"} ·
                    Decision: {detail.offerDecisionDate || "Not recorded"}
                  </p>
                </section>
                <section
                  className="compensation-summary"
                  aria-label="Compensation"
                >
                  <h2>Compensation</h2>
                  <p>
                    {detail.compensationMin || detail.compensationMax
                      ? `${detail.compensationMin && detail.compensationMax ? detail.compensationMin + "–" + detail.compensationMax : detail.compensationMin ? "From " + detail.compensationMin : "Up to " + detail.compensationMax} · ${detail.compensationCurrency || "Currency unknown"} · ${detail.compensationPeriod && detail.compensationPeriod !== "Unknown" ? "Per " + detail.compensationPeriod.toLowerCase() : "Period unknown"} · ${detail.compensationBasis && detail.compensationBasis !== "Unknown" ? detail.compensationBasis + " compensation" : "Basis unknown"}`
                      : "Not provided"}
                  </p>
                </section>
                {w.duplicateReviews
                  .filter(
                    (r) => r.decision === "merge" && r.targetId === detail.id,
                  )
                  .map((r) => {
                    const original = w.applications.find(
                      (a) => a.id === r.sourceId,
                    );
                    return original ? (
                      <section key={r.id} className="notice">
                        <p>
                          Original notes and history from the merged application
                          remain available.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => showDetail(original)}
                        >
                          View archived original · {original.title}
                        </button>
                      </section>
                    ) : null;
                  })}
                <h2>Notes</h2>
                <p className="notes">
                  {detail.notes ||
                    "No notes yet. Add context with Edit application."}
                </p>
                {detail.description && (
                  <>
                    <h2>Saved job description</h2>
                    <p className="notes">{detail.description}</p>
                  </>
                )}
              </>
            )}
            {detailTab === "Overview" && (
              <ListingSnapshots
                snapshots={(w.listingSnapshots || []).filter(
                  (s) => s.applicationId === detail.id,
                )}
                timezone={w.user.timezone}
              />
            )}
            {detailTab === "People & files" && (
              <SubmittedDocuments
                key={detail.id}
                applicationId={detail.id}
                documents={w.documents}
                usages={w.documentUsages || []}
                request={api}
                onChanged={async () => {
                  await refresh();
                  await loadEvents(detail.id);
                }}
              />
            )}
            {(["round", "assessment", "task", "contact", "document"] as const)
              .filter((kind) =>
                detailTab === "Overview"
                  ? ["round", "assessment", "task"].includes(kind)
                  : detailTab === "People & files"
                    ? ["contact", "document"].includes(kind)
                    : false,
              )
              .map((kind) => {
                const items = (
                  kind === "assessment"
                    ? w.assessments
                    : kind === "round"
                      ? w.rounds
                      : kind === "task"
                        ? w.tasks
                        : kind === "contact"
                          ? w.contacts
                          : w.documents
                ).filter(
                  (v) =>
                    v.applicationId === detail.id ||
                    v.applicationIds?.includes(detail.id),
                );
                return (
                  <section key={kind} className="detail-section">
                    <div className="section-head">
                      <h2>
                        {
                          {
                            assessment: "Assessments",
                            round: "Interview rounds",
                            task: "Tasks",
                            contact: "People",
                            document: "Documents",
                          }[kind]
                        }
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => newRecord(kind, detail.id)}
                      >
                        <Plus size={15} /> Add
                      </button>
                    </div>
                    {items.length ? (
                      items.map((v) =>
                        kind === "document" ? (
                          <a
                            className="detail-item"
                            href={"/api/files/" + v.fileId}
                            key={v.id}
                          >
                            {v.title}
                            <Download size={16} />
                          </a>
                        ) : (
                          <button
                            className="detail-item"
                            key={v.id}
                            onClick={() => setModal({ kind, data: v })}
                          >
                            <span>
                              {v.title || v.name}
                              <small>
                                {v.date || v.due || v.email} {v.time}{" "}
                                {v.timezone}
                              </small>
                            </span>
                            <span className="badge">
                              {v.status ||
                                (kind === "task"
                                  ? v.done
                                    ? "Done"
                                    : "Open"
                                  : "Contact")}
                            </span>
                          </button>
                        ),
                      )
                    ) : (
                      <p className="muted">None added yet.</p>
                    )}
                  </section>
                );
              })}
            {detailTab === "Activity" && (
              <>
                <div className="section-head space-top">
                  <h2>Application activity</h2>
                  <span className="muted">{events.length} events</span>
                </div>
                <Timeline
                  events={events}
                  applicationId={detail.id}
                  timezone={w.user.timezone}
                />
              </>
            )}
          </section>
        </div>
      )}
      {modal && (
        <Editor
          modal={modal}
          w={w}
          busy={busy}
          error={error}
          onClose={() => {
            setModal(null);
          }}
          request={api}
          refresh={refresh}
          onSave={(data, file) =>
            run(async () => {
              if (modal.kind === "import") {
                await refresh();
                setNotice(
                  `Imported ${data.importResult.count} applications · ${data.importResult.skipped} skipped`,
                );
              } else {
                if (modal.kind === "document") {
                  if (!file) throw new Error("Choose a PDF or DOCX file");
                  const body = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve(String(reader.result).split(",")[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                  });
                  const result = await api("/files", "POST", {
                    name: file.name,
                    body,
                  });
                  data.fileId = result.id;
                }
                const result = await saveRecord(modal.kind, data);
                if (
                  detail &&
                  modal.kind === "application" &&
                  detail.id === result.id
                ) {
                  setDetail(result);
                  await loadEvents(result.id);
                }
              }
              setModal(null);
            })
          }
        />
      )}{" "}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Leaf size={26} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="secondary" onClick={onClick}>
        <Plus size={16} />
        {action}
      </button>
    </div>
  );
}
function Auth({
  onSubmit,
  error,
  busy,
}: {
  onSubmit: (a: string, d: any) => void;
  error: string;
  busy: boolean;
}) {
  const [register, setRegister] = useState(true);
  const [authConfig, setAuthConfig] = useState<any>(null),
    [configError, setConfigError] = useState("");
  useEffect(() => {
    api("/auth/config")
      .then((c) => {
        setAuthConfig(c);
        if (!c.registrationEnabled) setRegister(false);
      })
      .catch(() =>
        setConfigError("Sign-in service unavailable. Refresh to try again."),
      );
  }, []);
  return (
    <div className="auth">
      <section className="auth-story">
        <a className="brand" href="#">
          <Leaf />
          offerly.
        </a>
        <div>
          <span className="tiny-label">LESS CHAOS. MORE POSSIBILITY.</span>
          <h1>
            Your next chapter
            <br />
            starts here.
          </h1>
          <p>
            One calm place for your applications, your people,
            <br />
            and your next move.
          </p>
        </div>
        <span>A little structure. A lot more clarity.</span>
      </section>
      <section className="auth-form">
        <span className="eyebrow">YOUR PERSONAL JOB SEARCH WORKSPACE</span>
        <h1>{register ? "Make room for what’s next." : "Welcome back."}</h1>
        <p>
          {register
            ? "Create your private workspace to get started."
            : "Pick up where you left off."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            onSubmit(register ? "register" : "login", {
              ...data,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          }}
        >
          {register && (
            <label>
              Your name
              <input
                name="name"
                autoComplete="name"
                required
                placeholder="Pratyush Patel"
              />
            </label>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={register ? 15 : 1}
              maxLength={256}
              required
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={
                register ? "At least 15 characters" : "Your password"
              }
            />
          </label>
          {register && authConfig?.invitationRequired && (
            <label>
              Invitation code
              <input
                name="invitation"
                type="password"
                autoComplete="off"
                required
                maxLength={256}
              />
            </label>
          )}
          {configError && (
            <p role="alert" className="form-error">
              {configError}
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || !authConfig}>
            {busy
              ? "Opening workspace…"
              : register
                ? "Create workspace"
                : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        {authConfig?.registrationEnabled && (
          <button
            className="text-button"
            onClick={() => setRegister(!register)}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create a workspace"}
          </button>
        )}
        <small className="muted">
          Manual tracking works without connecting your inbox.
        </small>
      </section>
    </div>
  );
}
function Editor({
  modal,
  w,
  busy,
  error,
  onClose,
  onSave,
  request,
  refresh,
}: {
  modal: { kind: string; data: any };
  w: Workspace;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (d: any, f?: File) => void;
  request: typeof api;
  refresh: () => Promise<any>;
}) {
  useDialogFocus(true);
  const [data, setData] = useState({ ...modal.data }),
    [file, setFile] = useState<File>();
  const change = (key: string, v: any) =>
    setData((d: any) => ({ ...d, [key]: v }));
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  if (modal.kind === "import")
    return (
      <ImportDialog
        request={request}
        onClose={onClose}
        onComplete={(result) => onSave({ importResult: result })}
      />
    );
  if (modal.kind === "duplicates")
    return (
      <DuplicateDialog
        w={w}
        request={request}
        refresh={refresh}
        onClose={onClose}
      />
    );
  const field = (
    key: string,
    label: string,
    options?: string[],
    type = "text",
  ) => (
    <label key={key}>
      {label}
      {options ? (
        <select
          aria-label={label}
          value={data[key] || ""}
          onChange={(e) => change(key, e.target.value)}
        >
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : ["notes", "description", "csv"].includes(key) ? (
        <textarea
          rows={key === "csv" ? 8 : 4}
          value={data[key] || ""}
          onChange={(e) => change(key, e.target.value)}
        />
      ) : (
        <input
          type={type}
          value={data[key] || ""}
          required={["title", "company", "name", "timezone"].includes(key)}
          onChange={(e) => change(key, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <div className="overlay modal-overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={modal.kind + " editor"}
      >
        <div className="section-head">
          <h2>
            {modal.data.id
              ? "Edit"
              : modal.kind === "import"
                ? "Import"
                : "Add"}{" "}
            {modal.kind === "import" ? "applications" : modal.kind}
          </h2>
          <button autoFocus aria-label="Close editor" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(data, file);
          }}
        >
          <div className="form-fields">
            {modal.kind === "application" && (
              <>
                {field("company", "Company")}
                {field("title", "Role title")}
                {field("stage", "Stage", w.user.stages)}
                {field("priority", "Priority", ["Low", "Medium", "High"])}
                {field("owner", "Next response", [
                  "Unclear",
                  "You",
                  "Employer",
                  "Nobody",
                ])}
                {field("appliedDate", "Applied date", undefined, "date")}
                {field("location", "Location")}
                {field("source", "Source")}
                {field("workArrangement", "Work arrangement", [
                  "Unknown",
                  "Remote",
                  "Hybrid",
                  "On-site",
                ])}
                {field("employmentType", "Employment type", [
                  "Unknown",
                  "Full-time",
                  "Part-time",
                  "Contract",
                  "Internship",
                  "Temporary",
                ])}
                <fieldset className="compensation-fields">
                  <legend>Compensation</legend>
                  <p>
                    Use advertised amounts. Leave missing details unknown; base
                    pay and total compensation are different.
                  </p>
                  <div className="filter-grid">
                    {field("compensationMin", "Compensation minimum")}
                    {field("compensationMax", "Compensation maximum")}
                    {field("compensationCurrency", "Currency code (e.g. USD)")}
                    {field("compensationPeriod", "Pay period", [
                      "Unknown",
                      "Hour",
                      "Day",
                      "Week",
                      "Month",
                      "Year",
                    ])}
                    {field("compensationBasis", "Pay basis", [
                      "Unknown",
                      "Base",
                      "Total",
                    ])}
                  </div>
                </fieldset>
                <OfferFields data={data} change={change} />
                {field("requisition", "Requisition ID")}
                {field("url", "Job URL", undefined, "url")}
                {field("notes", "Notes")}
                {field("description", "Saved job description")}
                {field(
                  "descriptionCapturedDate",
                  "Listing captured date",
                  undefined,
                  "date",
                )}
                {field(
                  "descriptionSourceUrl",
                  "Listing source URL",
                  undefined,
                  "url",
                )}
                <p className="muted wide">
                  Paste the listing text and record when and where it was
                  captured. Leave unknown dates blank. Saving changed listing
                  text or capture details preserves a new immutable snapshot; no
                  website is fetched automatically.
                </p>
              </>
            )}
            {modal.kind === "contact" && (
              <ContactFields data={data} change={change} />
            )}
            {modal.kind === "task" && (
              <>
                {field("title", "Task")}
                {field("due", "Due date", undefined, "date")}
                <label>
                  Status
                  <select
                    value={String(data.done)}
                    onChange={(e) => change("done", e.target.value === "true")}
                  >
                    <option value="false">Open</option>
                    <option value="true">Done</option>
                  </select>
                </label>
              </>
            )}
            {modal.kind === "round" && (
              <>
                {field("title", "Round name")}
                {field("status", "Status", [
                  "Invited",
                  "Scheduled",
                  "Completed",
                  "Canceled",
                  "Rescheduled",
                ])}
                {field("date", "Date", undefined, "date")}
                {field("time", "Time", undefined, "time")}
                {field("timezone", "Timezone")}
                {field("url", "Meeting link", undefined, "url")}
                {field("notes", "Preparation notes")}
              </>
            )}
            {modal.kind === "assessment" && (
              <>
                {field("title", "Assessment name")}
                {field("status", "Assessment status", [
                  "Not started",
                  "In progress",
                  "Completed",
                  "Canceled",
                ])}
                {field("due", "Assessment deadline", undefined, "date")}
                {field("completedDate", "Completion date", undefined, "date")}
                {field("score", "Result or score (optional)")}
                {field("url", "Assessment link", undefined, "url")}
                {field("notes", "Assessment notes")}
                <p className="helper-text wide">
                  Completion is recorded only when you confirm it. Passing a
                  deadline never completes an assessment.
                </p>
              </>
            )}
            {["task", "round", "assessment"].includes(modal.kind) && (
              <label>
                Application
                <select
                  aria-label="Application"
                  required={modal.kind !== "task"}
                  value={data.applicationId}
                  onChange={(e) => change("applicationId", e.target.value)}
                >
                  <option value="">Select application</option>
                  {w.applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.company} · {a.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal.kind === "document" && (
              <>
                {field("title", "Version name")}
                {field("label", "Type", ["Resume", "Cover letter", "Other"])}
                <label className="wide">
                  File (PDF or DOCX, up to 20 MB)
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    required
                    onChange={(e) => setFile(e.target.files?.[0])}
                  />
                </label>
                <p className="muted wide">
                  Documents download as attachments. Production uploads require
                  malware screening; local development uploads are not scanned
                  unless a scanner is configured.
                </p>
              </>
            )}
            {["contact", "document"].includes(modal.kind) && (
              <fieldset className="wide">
                <legend>Linked applications</legend>
                {w.applications.length ? (
                  w.applications.map((a) => (
                    <label className="checkbox-label" key={a.id}>
                      <input
                        type="checkbox"
                        checked={data.applicationIds?.includes(a.id) || false}
                        onChange={(e) =>
                          change(
                            "applicationIds",
                            e.target.checked
                              ? [...(data.applicationIds || []), a.id]
                              : data.applicationIds.filter(
                                  (id: string) => id !== a.id,
                                ),
                          )
                        }
                      />
                      {a.company} · {a.title}
                    </label>
                  ))
                ) : (
                  <p className="muted">
                    Add an application first to link it here.
                  </p>
                )}
              </fieldset>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save " + modal.kind}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function SettingsPage({
  w,
  busy,
  run,
  refresh,
  logout,
}: {
  w: Workspace;
  busy: boolean;
  run: (fn: () => Promise<any>) => void;
  refresh: () => Promise<any>;
  logout: () => void;
}) {
  const [timezone, setTimezone] = useState(w.user.timezone),
    [stages, setStages] = useState(w.user.stages.join("\n")),
    [confirm, setConfirm] = useState(""),
    [deletePassword, setDeletePassword] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <h2>Workspace preferences</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/settings", "PUT", {
                timezone,
                stages: stages
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              await refresh();
              setSaved(true);
            });
          }}
        >
          <label>
            Timezone
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
            />
          </label>
          <label>
            Application stages
            <textarea
              rows={9}
              value={stages}
              onChange={(e) => setStages(e.target.value)}
            />
          </label>
          <p className="muted">
            One per line, in board order. Stages in use cannot be removed.
          </p>
          <button className="primary" disabled={busy}>
            Save preferences
          </button>
          {saved && <p role="status">Preferences saved.</p>}
        </form>
      </section>
      <div>
        <section className="panel settings-panel">
          <h2>Account</h2>
          <p>{w.user.email}</p>
          <button
            className="secondary"
            onClick={() =>
              run(async () => {
                await api("/logout", "POST");
                logout();
              })
            }
          >
            <LogOut size={16} /> Sign out
          </button>
          <h2 className="space-top">Change password</h2>
          <p>
            Changing your password signs out every session, including this one.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              run(async () => {
                await api("/account/password", "POST", data);
                logout();
              });
            }}
          >
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={15}
                maxLength={256}
              />
            </label>
            <button className="secondary" disabled={busy}>
              Change password and sign out
            </button>
          </form>
          <h2 className="space-top">Email connections</h2>
          <span className="badge">Not connected</span>
          <p>
            Gmail import and automatic updates are planned for the next
            milestone. Your manual workspace is ready now.
          </p>
        </section>
        <section className="panel settings-panel space-top">
          <h2>Your data belongs to you</h2>
          <p>
            Download your full workspace, including history and original files,
            or export applications as CSV.
          </p>
          <a className="secondary" href="/api/export.json">
            <Download size={16} /> Full workspace export
          </a>
          <a className="text-button" href="/api/export.csv">
            Download application CSV
          </a>
        </section>
        <section className="panel settings-panel space-top">
          <h2>Delete account</h2>
          <p>
            Deletes your live workspace, sessions, records, and uploaded files.
            This cannot be undone. Confirm your email and current password.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/account", "DELETE", {
                  confirm,
                  password: deletePassword,
                });
                logout();
              });
            }}
          >
            <label>
              Account email
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={w.user.email}
              />
            </label>
            <label>
              Confirm current password
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </label>
            <button
              className="danger"
              disabled={busy || confirm !== w.user.email}
            >
              Permanently delete account
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
function SessionRoot() {
  const [generation, setGeneration] = useState(sessionGeneration);
  useEffect(() => {
    const reset = () => setGeneration(sessionGeneration);
    window.addEventListener("offerly:session-reset", reset);
    return () => window.removeEventListener("offerly:session-reset", reset);
  }, []);
  return <App key={generation} />;
}
createRoot(document.getElementById("root")!).render(<SessionRoot />);
