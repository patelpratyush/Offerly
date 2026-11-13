import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { pagePaths, routePage, routeAnchor, safeReturnTo } from "./routing";
import {
  ArrowUpRight,
  Plus,
  Search,
  LayoutGrid,
  List,
  Users,
  Settings,
  ArrowRight,
  X,
  Check,
  Upload,
  Download,
  LogOut,
  Leaf,
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
import "./styles/style.css";
import "./styles/workspace.css";
import { ImportDialog } from "./components/workspace/ImportDialog";
import { DuplicateDialog } from "./components/workspace/DuplicateDialog";
import { TrackerActions } from "./components/workspace/TrackerActions";
import { ContactFields } from "./components/workspace/ContactFields";
import { SubmittedDocuments } from "./components/workspace/SubmittedDocuments";
import { OfferFields } from "./components/workspace/OfferFields";
import { ListingSnapshots } from "./components/workspace/ListingSnapshots";
import { RecruitingReview } from "./components/workspace/RecruitingReview";
import { RecruitingAISettings } from "./components/workspace/RecruitingAISettings";
import { GmailSettings } from "./components/workspace/GmailSettings";
import { Reminders } from "./components/workspace/Reminders";
import { Timeline } from "./components/workspace/Timeline";
import { ContactDirectory } from "./components/workspace/ContactDirectory";
import { DocumentLibrary } from "./components/workspace/DocumentLibrary";
import { WorkspaceInsights } from "./components/workspace/WorkspaceInsights";
import { InsightsMetrics } from "./components/workspace/InsightsMetrics";
import { ReminderRulesSettings } from "./components/workspace/ReminderRulesSettings";
import { CalendarExport } from "./components/workspace/CalendarExport";
import { TodayFocus } from "./components/workspace/TodayFocus";
import { PrepareHub } from "./components/workspace/prepare/PrepareHub";
import { Landing } from "./pages/Landing";
import { NotFound } from "./pages/NotFound";
import { useDialogViewport } from "./useDialogViewport";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/martian-mono/wdth.css";
import "./styles/dispatch/tokens.css";
import "./styles/dispatch/core.css";
import { ShellRail, ShellTopbar } from "./components/shell/ShellRail";
import { ShellOverlays, type Overlay } from "./components/shell/ShellOverlays";
import "./styles/dispatch/discover.css";
import "./styles/dispatch/prepare.css";
import "./styles/dispatch/reviews.css";
import "./styles/dispatch/people.css";
import "./styles/dispatch/documents.css";
import "./styles/dispatch/insights.css";
import "./styles/dispatch/settings.css";
import "./styles/dispatch/today.css";
import "./styles/dispatch/applications.css";
import "./styles/dispatch/detail.css";
import {
  GateTag,
  gateCode,
  StatusTag,
  OverdueTag,
  ownerStatus,
  appHasOverdue,
  deriveNextMove,
  type NextMove,
} from "./components/applications/dispatch";
import { DiscoverPage } from "./components/discover/DiscoverPage";
import { CompaniesPage } from "./components/discover/CompaniesPage";
const APPLICATION_PAGE_SIZE = 25;
type Item = { id: string; version: number; [key: string]: any };
type Workspace = {
  user: { name: string; email: string; timezone: string; stages: string[] };
  filePolicy?: { maxBytes: number; exportIncludesFiles: boolean };
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
  const requested = safeReturnTo(
    window.location.pathname + window.location.search + window.location.hash,
  );
  window.history.replaceState(
    null,
    "",
    "/signin?returnTo=" + encodeURIComponent(requested),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
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
  const wasActive = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Capture before React makes the triggering surface inert during commit.
  if (active && !wasActive.current)
    returnFocus.current = document.activeElement as HTMLElement;
  wasActive.current = active;
  useEffect(() => {
    if (!active) return;
    const previous = returnFocus.current;
    const dialogs = document.querySelectorAll<HTMLElement>("[role=dialog]");
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ),
      ).filter(
        (element) =>
          element.getClientRects().length > 0 && !element.closest("[inert]"),
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
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[inert]"))
          previous.focus();
      });
    };
  }, [active]);
}
function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = routePage(location.pathname) || "Not found";
  const entry =
    location.pathname === "/signup"
      ? "signup"
      : location.pathname === "/signin"
        ? "signin"
        : "home";
  const setPage = (name: string) => navigate(pagePaths[name] || "/today");
  const applicationId = /^\/applications\/([^/]+)$/.exec(
    location.pathname,
  )?.[1];
  const useFilter = <T extends string | boolean>(
    key: string,
    fallback: T,
  ): [T, (value: T) => void] => {
    const raw = searchParams.get(key);
    const value = (
      typeof fallback === "boolean" ? raw === "true" : raw || fallback
    ) as T;
    return [
      value,
      (next: T) =>
        setSearchParams(
          (previous) => {
            const params = new URLSearchParams(previous);
            if (next === fallback) params.delete(key);
            else params.set(key, String(next));
            return params;
          },
          { replace: true },
        ),
    ];
  };
  const [stage, setStage] = useFilter("stage", "All stages" as string);
  const [priority, setPriority] = useFilter(
    "priority",
    "Any priority" as string,
  );
  const [owner, setOwner] = useFilter("owner", "Any owner" as string);
  const [view, setView] = useFilter("view", "table" as string);
  const board = view === "board";
  const setBoard = (value: boolean) => setView(value ? "board" : "table");
  const [archived, setArchived] = useFilter("archived", false as boolean);
  const [companyFilter, setCompanyFilter] = useFilter("company", "" as string);
  const [sourceFilter, setSourceFilter] = useFilter("source", "" as string);
  const [arrangement, setArrangement] = useFilter("arrangement", "" as string);
  const [dateFrom, setDateFrom] = useFilter("from", "" as string);
  const [dateTo, setDateTo] = useFilter("to", "" as string);
  const [includeUnknownDates, setIncludeUnknownDates] = useFilter(
    "unknownDates",
    false as boolean,
  );
  const [sort, setSort] = useFilter("sort", "recent" as string);
  const [savedViewId, setSavedViewId] = useFilter("savedView", "" as string);
  useEffect(() => {
    if (["#signin", "#signup"].includes(location.hash))
      navigate("/" + location.hash.slice(1) + location.search, {
        replace: true,
      });
  }, [location.hash, location.search]);
  useEffect(() => {
    document.title =
      (applicationId
        ? "Application"
        : page === "Not found"
          ? entry === "home" && location.pathname === "/"
            ? "Your job search, in order"
            : entry === "signin"
              ? "Sign in"
              : entry === "signup"
                ? "Create account"
                : "Page not found"
          : page) + " · Offerly";
  }, [page, entry, applicationId, location.pathname]);
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const sessionReturnFocus = useRef<HTMLElement | null>(null);
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  const [w, setW] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [navigationOpen, setNavigationOpen] = useState(false),
    [overlay, setOverlay] = useState<Overlay>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<{ kind: string; data: any } | null>(null),
    [detail, setDetailState] = useState<Item | null>(null),
    [events, setEvents] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [applicationPage, setApplicationPage] = useState(0),
    [boardLimits, setBoardLimits] = useState<Record<string, number>>({}),
    [detailTab, setDetailTab] = useState("Overview"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setQuery("");
  }, [page]);
  const account = useRef<string | null>(null);
  const workspaceRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailId = useRef<string | null>(null);
  const activeOperations = useRef(0);
  useEffect(() => {
    if (!loading && !w && entry !== "home") {
      // A late route effect must not interrupt typing/autofill already in progress.
      if (
        document.activeElement?.matches(
          "input,select,textarea,[contenteditable=true]",
        )
      )
        return;
      document.querySelector<HTMLElement>(".auth-form h1")?.focus();
    }
  }, [entry, loading, w]);
  const setDetail = (value: Item | null) => {
    if (!value) {
      const previous = location.state?.detailReturnTo;
      navigate(
        previous ? safeReturnTo(previous) : "/applications" + location.search,
      );
    } else if (applicationId !== value.id) {
      navigate(
        "/applications/" + encodeURIComponent(value.id) + location.search,
      );
    }
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
  useDialogViewport(!!detail || !!modal);
  useEffect(() => {
    setApplicationPage(0);
    setBoardLimits({});
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
    sort,
    board,
    page,
    w?.user.email,
  ]);
  useEffect(() => {
    if (!detail && !modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [!!detail, !!modal]);
  useEffect(() => {
    setNavigationOpen(false);
  }, [page]);
  useDialogFocus(!!detail && !modal && verifiedPath === location.pathname);
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
    setVerifiedPath(currentPath.current);
    return next;
  };
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.message !== "Sign in to continue") setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const target = routeAnchor(location.pathname, location.hash);
    if (!w || verifiedPath !== location.pathname || !target) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, verifiedPath, !!w]);
  const refreshCurrent = useRef(refresh);
  refreshCurrent.current = refresh;
  // Cached private records stay hidden until the destination's session check passes.
  useEffect(() => {
    if (
      !w ||
      !routePage(location.pathname) ||
      verifiedPath === location.pathname
    )
      return;
    setError("");
    void refreshCurrent.current().catch((e) => setError(e.message));
  }, [location.pathname, w?.user.email, verifiedPath]);
  useEffect(() => {
    if (!w?.user.email) return;
    const revalidate = () => {
      if (document.visibilityState === "visible") {
        sessionReturnFocus.current = document.activeElement as HTMLElement;
        setVerifiedPath(null);
      }
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pageshow", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("pageshow", revalidate);
    };
  }, [w?.user.email]);
  useEffect(() => {
    if (verifiedPath !== location.pathname || !sessionReturnFocus.current)
      return;
    const target = sessionReturnFocus.current;
    sessionReturnFocus.current = null;
    requestAnimationFrame(() => {
      if (target.isConnected && !target.closest("[inert]"))
        target.focus({ preventScroll: true });
    });
  }, [verifiedPath, location.pathname]);
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
  useEffect(() => {
    if (!w) return;
    const found = applicationId
      ? w.applications.find((a) => a.id === applicationId)
      : null;
    if (found?.id !== detailId.current) {
      detailRequest.current++;
      detailId.current = found?.id || null;
      setDetailState(found || null);
      setDetailTab("Overview");
      setEvents([]);
      if (found) void loadEvents(found.id).catch((e) => setError(e.message));
    } else if (found) setDetailState(found);
    if (found) document.title = `${found.company} · ${found.title} · Offerly`;
  }, [applicationId, w]);
  const showDetail = async (a: Item) => {
    navigate(
      "/applications/" +
        encodeURIComponent(a.id) +
        (page === "Applications" ? location.search : ""),
      {
        state: {
          detailReturnTo: location.pathname + location.search + location.hash,
        },
      },
    );
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
  const knownPublic = ["/", "/signin", "/signup"].includes(location.pathname);
  if (!loading && !w && !knownPublic && page !== "Not found")
    return (
      <Navigate
        replace
        to={
          "/signin?returnTo=" +
          encodeURIComponent(
            safeReturnTo(location.pathname + location.search + location.hash),
          )
        }
      />
    );
  if (
    (!w && !knownPublic && page === "Not found") ||
    (w && page === "Not found" && !knownPublic)
  )
    return <NotFound signedIn={!!w} />;
  if (w && knownPublic)
    return (
      <Navigate
        replace
        to={
          searchParams.get("gmail") === "connected"
            ? "/settings"
            : safeReturnTo(searchParams.get("returnTo"))
        }
      />
    );
  if (!w && location.pathname === "/") return <Landing />;
  if (!w)
    return (
      <Auth
        mode={entry === "signin" ? "signin" : "signup"}
        error={error}
        onSubmit={(action, data) =>
          run(async () => {
            await api("/auth/" + action, "POST", data);
            sessionChannel?.postMessage("reset");
            await refresh();
            navigate(safeReturnTo(searchParams.get("returnTo")), {
              replace: true,
            });
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
  const pageCount = Math.max(
    1,
    Math.ceil(visible.length / APPLICATION_PAGE_SIZE),
  );
  const currentApplicationPage = Math.min(applicationPage, pageCount - 1);
  const pageOffset = currentApplicationPage * APPLICATION_PAGE_SIZE;
  const tableApplications = visible.slice(
    pageOffset,
    pageOffset + APPLICATION_PAGE_SIZE,
  );
  const stageApplications = new Map<string, Item[]>();
  for (const application of visible) {
    const column = stageApplications.get(application.stage) || [];
    column.push(application);
    stageApplications.set(application.stage, column);
  }
  const changeApplicationPage = (index: number) => {
    setApplicationPage(index);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".application-results")?.focus(),
    );
  };
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
  const applyView = (v: typeof filters, viewId = savedViewId) => {
    setQuery(v.query);
    const params = new URLSearchParams();
    const values: Record<string, string | boolean> = {
      stage: v.stage,
      priority: v.priority,
      owner: v.owner,
      company: v.companyFilter,
      source: v.sourceFilter,
      arrangement: v.arrangement,
      from: v.dateFrom,
      to: v.dateTo,
      unknownDates: v.includeUnknownDates,
      archived: v.archived,
      view: v.board ? "board" : "table",
      sort: v.sort,
    };
    for (const [key, value] of Object.entries(values))
      if (value !== false && value !== "") params.set(key, String(value));
    if (viewId) params.set("savedView", viewId);
    setSearchParams(params, { replace: true });
    setSelected({});
  };
  const resetFilters = () =>
    applyView({
      ...filters,
      query: "",
      stage: "All stages",
      priority: "Any priority",
      owner: "Any owner",
      companyFilter: "",
      sourceFilter: "",
      arrangement: "",
      dateFrom: "",
      dateTo: "",
      includeUnknownDates: false,
    });
  const filterCount = [
    query,
    stage !== "All stages",
    priority !== "Any priority",
    owner !== "Any owner",
    companyFilter,
    sourceFilter,
    arrangement,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;
  const selectApplication = (a: Item, checked: boolean) =>
    setSelected((previous) => {
      const next = { ...previous };
      if (checked && Object.keys(next).length < 100) next[a.id] = a.version;
      else if (!checked) delete next[a.id];
      return next;
    });
  const selectionBox = (a: Item) => (
    <label className="selection-target">
      <input
        type="checkbox"
        aria-label={`Select ${a.company} · ${a.title}`}
        checked={Object.hasOwn(selected, a.id)}
        disabled={
          busy ||
          (!Object.hasOwn(selected, a.id) &&
            Object.keys(selected).length >= 100)
        }
        onChange={(e) => selectApplication(a, e.target.checked)}
      />
    </label>
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
  const applicationsById = new Map(w.applications.map((a) => [a.id, a]));
  const appName = (id: string) => {
    const a = applicationsById.get(id);
    return a ? `${a.company} · ${a.title}` : "Personal task";
  };
  const nextActions = new Map<string, { title: string; date: string }>();
  const actionItems = [
    ...tasks.map((t) => ({
      applicationId: t.applicationId,
      title: t.title,
      date: t.due,
    })),
    ...assessmentDeadlines.map((a) => ({
      applicationId: a.applicationId,
      title: a.title,
      date: a.due,
    })),
    ...w.rounds
      .filter(
        (r) =>
          ["Scheduled", "Rescheduled"].includes(r.status) && r.date >= today,
      )
      .map((r) => ({
        applicationId: r.applicationId,
        title: r.title,
        date: r.date,
      })),
  ];
  for (const action of actionItems) {
    if (!action.applicationId) continue;
    const current = nextActions.get(action.applicationId);
    if (
      !current ||
      (action.date || "9999").localeCompare(current.date || "9999") < 0
    )
      nextActions.set(action.applicationId, action);
  }
  const nextAction = (id: string) => {
    const due = nextActions.get(id);
    return due
      ? `${due.title} · ${due.date || "No date"}`
      : "No task or deadline set";
  };
  const performMove = (m: NextMove, a: Item) => {
    if (m.kind === "task" && m.record && m.label === "Complete task")
      return run(() => saveRecord("task", { ...m.record, done: true }));
    if (m.kind === "task" && m.record)
      return setModal({ kind: "task", data: m.record });
    if (m.kind === "prepare") return navigate("/prepare");
    return newRecord("task", a.id);
  };
  /** The single primary next move for an application, from recorded data. */
  const moveButton = (a: Item, className = "next-move-btn") => {
    const m = deriveNextMove(a, w, today);
    const inner = (
      <>
        <span>{m.label}</span>
        <small>{m.detail}</small> <ArrowRight size={14} aria-hidden="true" />
      </>
    );
    return m.href ? (
      <a className={className} href={m.href}>
        {inner}
      </a>
    ) : (
      <button
        className={className}
        disabled={busy}
        onClick={() => performMove(m, a)}
      >
        {inner}
      </button>
    );
  };
  const cards = (apps: Item[]) =>
    apps.map((a) => (
      <div key={a.id} className="selectable-card">
        {page === "Applications" && (
          <div className="card-selection">
            {selectionBox(a)} <span>Select application</span>
          </div>
        )}
        <button className="job-card" onClick={() => showDetail(a)}>
          <div className="card-top">
            <GateTag stage={a.stage} />
            {appHasOverdue(a, w, today) && <OverdueTag />}
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
            <StatusTag status={ownerStatus(a)} />
          </div>
          <div className="next-action">
            <small>Next action</small>
            <span>{nextAction(a.id)}</span>
          </div>
          <div className="card-foot">
            <span>{a.location || "Location unknown"}</span>
            <ArrowUpRight size={16} />
          </div>
        </button>
        {page === "Applications" && moveButton(a)}
      </div>
    ));
  const checkingSession = verifiedPath !== location.pathname;
  const goToPage = (name: string) => {
    navigate(pagePaths[name] || "/today");
    setQuery("");
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#workspace-content h1")?.focus(),
    );
  };
  return (
    <>
      {checkingSession && (
        <div className="loading" role="status">
          {error ? (
            <>
              <p>{error}</p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => run(refresh)}
              >
                Retry opening page
              </button>
            </>
          ) : (
            <>
              <Leaf /> Checking your session…
            </>
          )}
        </div>
      )}
      <div
        className="shell"
        style={{ display: checkingSession ? "none" : undefined }}
        inert={checkingSession}
        aria-busy={busy}
        onClickCapture={(event) => {
          // Safari does not focus pointer-clicked buttons. Capture a reliable dialog opener.
          if (event.target instanceof Element)
            event.target
              .closest<HTMLElement>("button")
              ?.focus({ preventScroll: true });
        }}
      >
        <a className="skip-link" href="#workspace-content">
          Skip to workspace
        </a>
        <ShellRail
          page={page}
          applicationCount={active.length}
          userName={w.user.name}
          navigationOpen={navigationOpen}
          inert={!!detail || !!modal}
          onToggleMenu={() => setNavigationOpen(!navigationOpen)}
          onNavigate={() => {
            setNavigationOpen(false);
            setQuery("");
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>("#workspace-content h1")
                ?.focus(),
            );
          }}
          onSearch={() => setOverlay("palette")}
          onSignOut={() =>
            run(async () => {
              await api("/logout", "POST");
              resetSession();
            })
          }
        />
        <main id="workspace-content" tabIndex={-1} inert={!!detail || !!modal}>
          <ShellTopbar page={page} timezone={w.user.timezone} />
          <div className={`content page-${page.toLowerCase()}`}>
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
                    : (
                        {
                          Applications: "02 / THE PIPELINE",
                          Discover: "03 / THE FEED",
                          Companies: "04 / THE COVERAGE",
                          Reviews: "03 / THE EVIDENCE DESK",
                          Connections: "04 / YOUR PEOPLE",
                          Documents: "05 / THE ARCHIVE",
                          Prepare: "05B / GET READY",
                          Insights: "06 / THE BIG PICTURE",
                          Settings: "07 / MAKE IT YOURS",
                        } as Record<string, string>
                      )[page]}
                </div>
                <h1 tabIndex={-1}>
                  {page === "Today"
                    ? `Make your next move, ${w.user.name.split(" ")[0]}.`
                    : page}
                </h1>
                <p>
                  {
                    (
                      {
                        Today:
                          "Tasks, deadlines and interviews that need your attention.",
                        Applications:
                          "Track each role, who replies next, and what needs doing.",
                        Discover:
                          "Roles from the employer boards Offerly covers, with the evidence behind each match.",
                        Companies:
                          "Which employers and boards Offerly checks, and how recently.",
                        Connections:
                          "Recruiters, referrals and the applications you share.",
                        Documents:
                          "Keep original files, versions and submission records distinct.",
                        Prepare:
                          "Answers, interview notes, manual message drafts and contact import. Nothing is sent for you.",
                        Reviews:
                          "Evidence first. Every update stays in your control.",
                        Insights:
                          "A snapshot of where your applications stand today.",
                        Settings:
                          "Workspace preferences, account security and your data.",
                      } as any
                    )[page]
                  }
                </p>
              </div>
              {page !== "Settings" &&
                page !== "Discover" &&
                page !== "Companies" &&
                page !== "Insights" &&
                page !== "Prepare" &&
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
                <TodayFocus
                  workspace={w}
                  today={today}
                  onOpen={showDetail}
                  onSource={(kind, data) => setModal({ kind, data })}
                  onReviews={() => setPage("Reviews")}
                  request={api}
                >
                  <div className="today-grid" id="today-actions">
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
                                run(() =>
                                  saveRecord("task", { ...t, done: true }),
                                )
                              }
                            >
                              <Check size={14} />
                            </button>
                            <div>
                              <button
                                className="task-title"
                                onClick={() =>
                                  setModal({ kind: "task", data: t })
                                }
                              >
                                {t.title}
                                <span className="sr-only"> · Edit task</span>
                              </button>
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
                          title="No open tasks."
                          text="Add a follow-up, a deadline, or one small next step."
                          action="Add your first task"
                          onClick={() => newRecord("task")}
                        />
                      )}
                    </section>
                  </div>
                </TodayFocus>
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
                <div className="section-head space-top today-recent">
                  <h2>Recent applications</h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("Applications")}
                  >
                    View all applications <ArrowRight size={16} />
                  </button>
                </div>
                {active.length ? (
                  <ul className="tt-recent" aria-label="Recent applications">
                    {active
                      .slice(-3)
                      .reverse()
                      .map((a) => (
                        <li key={a.id}>
                          <button onClick={() => showDetail(a)}>
                            <GateTag stage={a.stage} />
                            <span className="tt-service">
                              <strong>
                                {a.company} — {a.title}
                              </strong>
                              <small>{a.location || "Location unknown"}</small>
                            </span>
                            <StatusTag status={ownerStatus(a)} />
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <section className="panel">
                    <Empty
                      title="Add your first application."
                      text="Add your first application or bring over your spreadsheet."
                      action="Add an application"
                      onClick={() => newRecord("application")}
                    />
                  </section>
                )}
              </>
            )}
            {page === "Reviews" && (
              <RecruitingReview
                rounds={w.rounds}
                tasks={w.tasks}
                assessments={w.assessments}
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
            {applicationId &&
              !w.applications.some((a) => a.id === applicationId) && (
                <section className="panel">
                  <h2>Application unavailable</h2>
                  <p>
                    This application was removed or is not part of your
                    workspace.
                  </p>
                  <Link to="/applications">Back to applications</Link>
                </section>
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
                  <div
                    className="filter-status"
                    role="status"
                    aria-label="Application results"
                    aria-live="polite"
                  >
                    <span>
                      {visible.length}{" "}
                      {visible.length === 1 ? "application" : "applications"}
                      {filterCount
                        ? ` · ${filterCount} active ${filterCount === 1 ? "filter" : "filters"}`
                        : " · All results"}
                      {archived ? " · Archived" : ""}
                    </span>
                    {filterCount > 0 && (
                      <button className="text-button" onClick={resetFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                  <TrackerActions
                    views={w.savedViews || []}
                    viewId={savedViewId}
                    setViewId={setSavedViewId}
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
                          {["Remote", "Hybrid", "On-site", "Unknown"].map(
                            (v) => (
                              <option key={v}>{v}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Priority{" "}
                        <select
                          aria-label="Priority filter"
                          value={priority}
                          onChange={(e) => setPriority(e.target.value)}
                        >
                          {["Any priority", "High", "Medium", "Low"].map(
                            (s) => (
                              <option key={s}>{s}</option>
                            ),
                          )}
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
                      <button className="text-button" onClick={resetFilters}>
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
                          aria-label="Select matching applications (up to 100)"
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
                        Select matching (up to 100)
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
                        onClick={() =>
                          setModal({ kind: "duplicates", data: {} })
                        }
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
                        title={
                          filterCount
                            ? "No applications match these filters."
                            : archived
                              ? "No archived applications."
                              : "No applications yet."
                        }
                        text={
                          filterCount
                            ? "Try a different search or clear filters to see all applications."
                            : "Add a role manually or use Import CSV to bring over your spreadsheet."
                        }
                        action={
                          filterCount ? "Clear filters" : "Add application"
                        }
                        onClick={() =>
                          filterCount
                            ? resetFilters()
                            : newRecord("application")
                        }
                      />
                    </section>
                  ) : board ? (
                    <div
                      className="board"
                      tabIndex={0}
                      role="region"
                      aria-label="Application board, scroll to see more stages"
                    >
                      {w.user.stages
                        .filter((s) => stage === "All stages" || stage === s)
                        .map((s) => {
                          const column = stageApplications.get(s) || [];
                          const limit = boardLimits[s] || APPLICATION_PAGE_SIZE;
                          return (
                            <section className="board-column" key={s}>
                              <h3>
                                <b className="platform-code" aria-hidden="true">
                                  {gateCode(s)}
                                </b>
                                <span className="platform-name">{s}</span>{" "}
                                <span className="platform-count">
                                  {column.length}
                                </span>
                              </h3>
                              {cards(column.slice(0, limit))}
                              {!column.length && (
                                <p className="board-empty">No applications</p>
                              )}
                              {column.length > limit && (
                                <div className="board-more">
                                  <span>
                                    {limit} of {column.length} shown
                                  </span>
                                  <button
                                    className="secondary"
                                    aria-label={`Show more ${s} applications`}
                                    onClick={(event) => {
                                      const columnElement =
                                        event.currentTarget.closest(
                                          ".board-column",
                                        );
                                      setBoardLimits((previous) => ({
                                        ...previous,
                                        [s]: limit + APPLICATION_PAGE_SIZE,
                                      }));
                                      // Keep keyboard position when the final Show more button disappears.
                                      requestAnimationFrame(() =>
                                        columnElement
                                          ?.querySelectorAll<HTMLElement>(
                                            ".job-card",
                                          )
                                          [limit]?.focus(),
                                      );
                                    }}
                                  >
                                    Show{" "}
                                    {Math.min(
                                      APPLICATION_PAGE_SIZE,
                                      column.length - limit,
                                    )}{" "}
                                    more
                                  </button>
                                </div>
                              )}
                            </section>
                          );
                        })}
                    </div>
                  ) : (
                    <div
                      className="application-results"
                      tabIndex={-1}
                      role="region"
                      aria-label="Application results"
                    >
                      <div
                        className="table-wrap"
                        tabIndex={0}
                        role="region"
                        aria-label="Applications table, scroll for more columns"
                      >
                        <table className="application-table" role="table">
                          <caption className="sr-only">
                            Applications, current stages and next actions. Open
                            a role to edit its stage without dragging.
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Select</th>
                              <th scope="col">Service</th>
                              <th scope="col">Gate</th>
                              <th scope="col">Status / next move</th>
                              <th scope="col">Location</th>
                              <th scope="col">Priority</th>
                              <th scope="col">Applied</th>
                              <th scope="col">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableApplications.map((a) => (
                              <tr
                                key={a.id}
                                className={
                                  appHasOverdue(a, w, today)
                                    ? "row-overdue"
                                    : ""
                                }
                              >
                                <td data-label="Select">{selectionBox(a)}</td>
                                <td className="role-cell">
                                  <button
                                    className="table-role"
                                    onClick={() => showDetail(a)}
                                  >
                                    <strong>{a.title}</strong>
                                    <small>{a.company}</small>
                                  </button>
                                </td>
                                <td data-label="Gate">
                                  <GateTag stage={a.stage} />
                                </td>
                                <td data-label="Status / next move">
                                  <span className="response-owner">
                                    <StatusTag status={ownerStatus(a)} />
                                    {appHasOverdue(a, w, today) && (
                                      <OverdueTag />
                                    )}
                                  </span>
                                  <small className="table-next-action">
                                    {nextAction(a.id)}
                                  </small>
                                </td>
                                <td data-label="Location">
                                  {a.location || "Unknown"}
                                </td>
                                <td data-label="Priority">
                                  <span
                                    className={
                                      "priority " + a.priority.toLowerCase()
                                    }
                                  >
                                    ●
                                  </span>{" "}
                                  {a.priority}
                                </td>
                                <td data-label="Applied">
                                  {a.appliedDate || "Unknown"}
                                </td>
                                <td className="open-cell">
                                  {moveButton(a)}
                                  <button
                                    aria-label={"Open " + a.title}
                                    onClick={() => showDetail(a)}
                                  >
                                    <span className="mobile-open-label">
                                      Open details
                                    </span>
                                    <ArrowUpRight size={17} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {pageCount > 1 && (
                        <div
                          className="pagination"
                          role="group"
                          aria-label="Application pages"
                        >
                          <span role="status" aria-label="Application page">
                            {pageOffset + 1}–
                            {Math.min(
                              pageOffset + APPLICATION_PAGE_SIZE,
                              visible.length,
                            )}{" "}
                            of {visible.length} applications
                          </span>
                          <div>
                            <button
                              className="secondary"
                              disabled={currentApplicationPage === 0}
                              onClick={() =>
                                changeApplicationPage(
                                  currentApplicationPage - 1,
                                )
                              }
                            >
                              Previous page
                            </button>
                            <button
                              className="secondary"
                              disabled={
                                currentApplicationPage + 1 === pageCount
                              }
                              onClick={() =>
                                changeApplicationPage(
                                  currentApplicationPage + 1,
                                )
                              }
                            >
                              Next page
                            </button>
                          </div>
                        </div>
                      )}
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
                <p className="directory-note">
                  Identity confirmations are your records, not external
                  verification. Open a connection to inspect or correct its
                  sources.
                </p>
                <ContactDirectory
                  contacts={w.contacts.filter((c) =>
                    `${c.name} ${c.company} ${c.email} ${c.agency} ${c.hiringCompany || ""} ${c.role} ${c.phone || ""} ${(c.additionalEmails || []).map((e: any) => e.email).join(" ")}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )}
                  applications={w.applications}
                  onEdit={(c) => setModal({ kind: "contact", data: c })}
                  onOpen={showDetail}
                />
                {!!w.contacts.length &&
                  !w.contacts.some((c) =>
                    `${c.name} ${c.company} ${c.email} ${c.agency} ${c.hiringCompany || ""} ${c.role} ${c.phone || ""} ${(c.additionalEmails || []).map((e: any) => e.email).join(" ")}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  ) && (
                    <p className="panel panel-copy" role="status">
                      No connections match “{query}”. Try a name, email or
                      company.
                    </p>
                  )}
                {!w.contacts.length && (
                  <section className="panel">
                    <Empty
                      title="No connections yet."
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
                <DocumentLibrary
                  documents={w.documents}
                  usages={w.documentUsages || []}
                  applications={w.applications}
                  timezone={w.user.timezone}
                  maxBytes={w.filePolicy?.maxBytes}
                  onOpen={showDetail}
                  onVersion={(d) =>
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
                />
                {!w.documents.length && (
                  <section className="panel">
                    <Empty
                      title="No documents uploaded."
                      text="Upload resumes and cover letters. Keep the exact version used for each application."
                      action="Upload document"
                      onClick={() => newRecord("document")}
                    />
                  </section>
                )}
              </>
            )}
            {page === "Discover" && <DiscoverPage />}
            {page === "Companies" && <CompaniesPage />}
            {page === "Prepare" && (
              <PrepareHub
                applications={w.applications}
                contacts={w.contacts}
                rounds={w.rounds}
                documents={w.documents}
                userName={w.user.name}
                maxBytes={w.filePolicy?.maxBytes}
                onChanged={refresh}
              />
            )}
            {page === "Insights" && (
              <>
                <WorkspaceInsights
                  applications={w.applications}
                  stages={w.user.stages}
                />
                <InsightsMetrics request={api} />
              </>
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
              Your job search, on record.<span>Offerly · Manual workspace</span>
            </footer>
          </div>
        </main>
        {detail && (
          <div className="overlay" onClick={() => setDetail(null)}>
            <section
              className="drawer"
              inert={!!modal}
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
              <header className="ticket">
                <div className="ticket-main">
                  <p className="ticket-company">{detail.company}</p>
                  <h1>{detail.title}</h1>
                  <p className="muted">
                    {detail.location || "Location unknown"}
                  </p>
                </div>
                <dl className="ticket-stub">
                  <div>
                    <dt>Gate</dt>
                    <dd>
                      <GateTag stage={detail.stage} />
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusTag status={ownerStatus(detail)} />
                      {appHasOverdue(detail, w, today) && <OverdueTag />}
                    </dd>
                  </div>
                  <div className="detail-next-action">
                    <dt>Next action</dt>
                    <dd>{nextAction(detail.id)}</dd>
                  </div>
                </dl>
              </header>
              <div className="ticket-move">
                <span className="tiny-label">NEXT MOVE</span>
                {moveButton(detail, "next-move-btn primary-move")}
              </div>
              <div className="detail-actions">
                <button
                  className="primary"
                  onClick={() =>
                    setModal({ kind: "application", data: detail })
                  }
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
                            Original notes and history from the merged
                            application remain available.
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
                    if (
                      file.size > (w.filePolicy?.maxBytes ?? 20 * 1024 * 1024)
                    )
                      throw new Error(
                        `Choose a file smaller than ${(w.filePolicy?.maxBytes ?? 20 * 1024 * 1024) / 1024 / 1024} MB`,
                      );
                    const body = await new Promise<string>(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () =>
                          resolve(String(reader.result).split(",")[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                      },
                    );
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
      <ShellOverlays
        overlay={overlay}
        setOverlay={setOverlay}
        blocked={!!detail || !!modal}
        applications={w.applications}
        onGoPage={goToPage}
        onOpenApplication={(id) => {
          const target = w.applications.find((a) => a.id === id);
          if (target) void showDetail(target);
        }}
        onAddApplication={() => newRecord("application")}
        onAddTask={() => newRecord("task")}
      />
    </>
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
  mode,
  onSubmit,
  error,
  busy,
}: {
  mode: "signin" | "signup";
  onSubmit: (a: string, d: any) => void;
  error: string;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [recovery, setRecovery] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const register = !recovery && mode === "signup";
  const setRegister = (value: boolean) => {
    setRecovery(false);
    setRecoveryError("");
    navigate((value ? "/signup" : "/signin") + location.search);
  };
  const [authConfig, setAuthConfig] = useState<any>(null),
    [configError, setConfigError] = useState("");
  useEffect(() => {
    api("/auth/config")
      .then((c) => {
        setAuthConfig(c);
        if (!c.registrationEnabled) setRegister(false);
      })
      .catch((error: Error) =>
        setConfigError(
          error.message || "Sign-in service unavailable. Refresh to try again.",
        ),
      );
  }, []);
  return (
    <div className="auth">
      <section className="auth-story">
        <Link className="brand" to="/" aria-label="Offerly home">
          <span className="auth-mark" aria-hidden="true">
            O
          </span>
          offerly
        </Link>
        <div>
          <span className="tiny-label">KEEP YOUR SEARCH IN ORDER.</span>
          <h2>
            Your search,
            <br />
            on the board.
          </h2>
          <p>
            Track applications, prepare for interviews, and keep your next
            action in view.
          </p>
        </div>
        <span>Applications · Tasks · Interviews · Documents</span>
      </section>
      <section className="auth-form">
        <span className="auth-stub" aria-hidden="true">
          {recovery ? "RECOVERY" : register ? "NEW SERVICE" : "BOARDING PASS"}
        </span>
        <span className="eyebrow">YOUR PERSONAL JOB SEARCH WORKSPACE</span>
        <h1 tabIndex={-1}>
          {recovery
            ? "Recover your workspace."
            : register
              ? "Make room for what’s next."
              : "Welcome back."}
        </h1>
        <p>
          {recovery
            ? "Use a saved recovery code to choose a new password. This signs out all sessions and invalidates every recovery code."
            : register
              ? "Create your private workspace to get started."
              : "Pick up where you left off."}
        </p>
        <form
          key={recovery ? "recover" : "credentials"}
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            if (recovery) {
              setRecoveryBusy(true);
              setRecoveryError("");
              try {
                await api("/auth/recover", "POST", data);
                setRecovery(false);
                navigate("/signin" + location.search, { replace: true });
                setRecoveryMessage(
                  "Password reset. Sign in, then generate new recovery codes in Settings.",
                );
              } catch (error) {
                setRecoveryError((error as Error).message);
              } finally {
                setRecoveryBusy(false);
              }
              return;
            }
            setRecoveryMessage("");
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
          {recovery && (
            <label>
              Recovery code
              <input
                name="code"
                autoComplete="off"
                required
                maxLength={128}
                spellCheck={false}
                autoCapitalize="none"
              />
            </label>
          )}
          <label>
            {recovery ? "New password" : "Password"}
            <input
              name={recovery ? "newPassword" : "password"}
              type="password"
              minLength={register || recovery ? 15 : 1}
              maxLength={256}
              required
              autoComplete={
                register || recovery ? "new-password" : "current-password"
              }
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
          {recoveryMessage && <p role="status">{recoveryMessage}</p>}
          {recoveryError && (
            <p role="alert" className="form-error">
              {recoveryError}
            </p>
          )}
          {!recovery && !recoveryMessage && error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || recoveryBusy || !authConfig}
          >
            {recoveryBusy
              ? "Resetting password…"
              : recovery
                ? "Reset password"
                : busy
                  ? "Opening workspace…"
                  : register
                    ? "Create workspace"
                    : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        {!register && (
          <button
            className="text-button"
            disabled={recoveryBusy}
            onClick={() => {
              setRecovery(!recovery);
              setRecoveryError("");
              setRecoveryMessage("");
            }}
          >
            {recovery
              ? "Back to sign in"
              : "Forgot password? Use a recovery code"}
          </button>
        )}
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
      <span>
        {label}
        {["title", "company", "name", "timezone"].includes(key) && (
          <span className="required-mark" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </span>
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
          aria-label={label}
          aria-invalid={!!fieldErrors[key] || undefined}
          aria-describedby={fieldErrors[key] ? `error-${key}` : undefined}
          onInvalid={(event) => {
            const input = event.currentTarget;
            setFieldErrors((previous) => ({
              ...previous,
              [key]: input.validity.valueMissing
                ? `${label} is required.`
                : type === "url"
                  ? "Enter a full URL, starting with https:// or http://."
                  : `Check ${label.toLowerCase()}.`,
            }));
          }}
          onInput={() =>
            setFieldErrors((previous) => ({ ...previous, [key]: "" }))
          }
          value={data[key] || ""}
          required={["title", "company", "name", "timezone"].includes(key)}
          onChange={(e) => change(key, e.target.value)}
        />
      )}
      {fieldErrors[key] && (
        <small className="field-error" id={`error-${key}`}>
          {fieldErrors[key]}
        </small>
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
          <p className="form-guidance">
            {modal.kind === "application"
              ? "Fields marked * are required. Leave unknown dates and details blank."
              : "Complete required fields and add the details you know. Leave unknown dates blank."}
          </p>
          <div className="form-fields">
            {modal.kind === "application" && (
              <>
                <fieldset className="form-section wide">
                  <legend>Role & tracking</legend>
                  <div className="form-fields">
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
                  </div>
                </fieldset>
                {field("notes", "Notes")}
                <details
                  className="form-disclosure wide"
                  open={!!modal.data.id || undefined}
                >
                  <summary>
                    Compensation & offer{" "}
                    <span>Advertised pay and confirmed outcomes</span>
                  </summary>
                  <div className="form-fields">
                    <fieldset className="compensation-fields">
                      <legend>Compensation</legend>
                      <p>
                        Use advertised amounts. Leave missing details unknown;
                        base pay and total compensation are different.
                      </p>
                      <div className="filter-grid">
                        {field("compensationMin", "Compensation minimum")}
                        {field("compensationMax", "Compensation maximum")}
                        {field(
                          "compensationCurrency",
                          "Currency code (e.g. USD)",
                        )}
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
                  </div>
                </details>
                <details
                  className="form-disclosure wide"
                  open={!!modal.data.id || undefined}
                >
                  <summary>
                    Listing & source{" "}
                    <span>
                      Original URL, saved description and capture history
                    </span>
                  </summary>
                  <div className="form-fields">
                    {field("requisition", "Requisition ID")}
                    {field("url", "Job URL", undefined, "url")}
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
                      captured. Leave unknown dates blank. Saving changed
                      listing text or capture details preserves a new immutable
                      snapshot; no website is fetched automatically.
                    </p>
                  </div>
                </details>
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
                  File (PDF or DOCX, up to{" "}
                  {(w.filePolicy?.maxBytes ?? 20 * 1024 * 1024) / 1024 / 1024}{" "}
                  MB)
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    required
                    onChange={(e) => setFile(e.target.files?.[0])}
                  />
                </label>
                <p className="muted wide">
                  Documents stay private and download as attachments. Security
                  screening may take up to a minute. Local development files are
                  scanned only when a scanner is configured.
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
function RecoveryCodes({
  run,
  busy,
}: {
  run: (fn: () => Promise<any>) => void;
  busy: boolean;
}) {
  const [codes, setCodes] = useState<string[]>([]);
  return (
    <section className="space-top">
      <h2>Recovery codes</h2>
      <p>
        Save these codes in your password manager. Any one code can reset your
        password without email. Generating new codes invalidates the previous
        set; resetting your password invalidates all codes.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const password = new FormData(form).get("password");
          setCodes([]);
          run(async () => {
            const result = await api("/account/recovery-codes", "POST", {
              password,
            });
            form.reset();
            setCodes(result.codes);
          });
        }}
      >
        <label>
          Current password for recovery codes
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </label>
        <button className="secondary" disabled={busy}>
          Generate new recovery codes
        </button>
      </form>
      {codes.length > 0 && (
        <div role="status">
          <p>
            Shown once. Save privately before dismissing. Anyone with a code and
            your email can reset your password.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {codes.join("\n")}
          </pre>
          <button className="secondary" onClick={() => setCodes([])}>
            I saved these codes — dismiss
          </button>
        </div>
      )}
    </section>
  );
}
const settingsSections: [string, string][] = [
  ["settings-preferences", "Preferences"],
  ["settings-security", "Account and security"],
  ["settings-gmail", "Gmail import"],
  ["settings-ai", "AI extraction"],
  ["settings-reminders", "Reminder rules"],
  ["settings-calendar", "Calendar export"],
  ["settings-data", "Data export"],
  ["settings-delete", "Delete account"],
];
function SettingsIndex() {
  return (
    <nav className="control-index" aria-label="Settings sections">
      <span className="control-index-title">Sections</span>
      <ol>
        {settingsSections.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById(id);
                const calm = window.matchMedia(
                  "(prefers-reduced-motion: reduce)",
                ).matches;
                target?.scrollIntoView({
                  behavior: calm ? "auto" : "smooth",
                  block: "start",
                });
                target?.focus({ preventScroll: true });
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
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
    <div className="control-room">
      <SettingsIndex />
      <section
        id="settings-preferences"
        tabIndex={-1}
        className="panel settings-panel"
      >
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
      <div className="control-panels">
        <section
          id="settings-security"
          tabIndex={-1}
          className="panel settings-panel"
        >
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
            Changing your password signs out every session, including this one,
            and invalidates recovery codes.
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
          <RecoveryCodes run={run} busy={busy} />
        </section>
        <div id="settings-gmail" tabIndex={-1}>
          <GmailSettings request={api} />
        </div>
        <div id="settings-reminders" tabIndex={-1}>
          <ReminderRulesSettings request={api} />
        </div>
        <div id="settings-calendar" tabIndex={-1}>
          <CalendarExport />
        </div>
        <div id="settings-ai" tabIndex={-1}>
          <RecruitingAISettings request={api} />
        </div>
        <section
          id="settings-data"
          tabIndex={-1}
          className="panel settings-panel space-top"
        >
          <h2>Your data belongs to you</h2>
          <p>
            {w.filePolicy?.exportIncludesFiles === false
              ? "Export your workspace and history with private document links. Download each original file from Documents, or export applications as CSV."
              : "Download your full workspace, including history and original files, or export applications as CSV."}
          </p>
          <a className="secondary" href="/api/export.json">
            <Download size={16} />{" "}
            {w.filePolicy?.exportIncludesFiles === false
              ? "Workspace export with document links"
              : "Full workspace export"}
          </a>
          <a className="text-button" href="/api/export.csv">
            Download application CSV
          </a>
        </section>
        <section
          id="settings-delete"
          tabIndex={-1}
          className="panel settings-panel hazard-zone space-top"
        >
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
createRoot(document.getElementById("root")!).render(
  <BrowserRouter useTransitions={false}>
    <SessionRoot />
  </BrowserRouter>,
);
