import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  GateTag,
  OverdueTag,
  StatusTag,
  ownerStatus,
} from "../applications/dispatch";

type Rec = { id: string; [key: string]: any };
export type DepartureSource = "application" | "round" | "assessment" | "task";
type Row = {
  key: string;
  rank: number;
  sort: string;
  departs: string;
  departsLong: string;
  app?: Rec;
  title: string;
  status: "overdue" | "move" | "wait" | "scheduled" | "due";
  source: DepartureSource;
  record: Rec;
};

type Props = {
  applications: Rec[];
  tasks: Rec[];
  assessments: Rec[];
  rounds: Rec[];
  today: string;
  onSource: (kind: DepartureSource, record: Rec) => void;
};

const LIMIT = 8;
/** Builds board rows from recorded data only; order is urgency, never a score. */
export function buildDepartures({
  applications,
  tasks,
  assessments,
  rounds,
  today,
}: Omit<Props, "onSource">): Row[] {
  const byId = new Map(applications.map((a) => [a.id, a]));
  const live = (id?: string) => {
    const a = id ? byId.get(id) : undefined;
    return !a || (!a.archived && !["Rejected", "Withdrawn"].includes(a.stage))
      ? a
      : null;
  };
  const rows: Row[] = [];
  const horizon = new Date(Date.parse(today + "T12:00:00Z") + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  for (const t of tasks) {
    if (t.done || !t.due) continue;
    const a = live(t.applicationId);
    if (a === null) continue;
    const late = t.due < today;
    if (!late && t.due > horizon) continue;
    rows.push({
      key: "t" + t.id,
      rank: late ? 0 : t.due === today ? 2 : 3,
      sort: t.due,
      departs: t.due,
      departsLong: "Due " + t.due,
      app: a,
      title: t.title,
      status: late ? "overdue" : "due",
      source: "task",
      record: t,
    });
  }
  for (const x of assessments) {
    if (["Completed", "Canceled"].includes(x.status) || !x.due) continue;
    const a = live(x.applicationId);
    if (a === null) continue;
    const late = x.due < today;
    rows.push({
      key: "a" + x.id,
      rank: late ? 0 : x.due === today ? 2 : 3,
      sort: x.due,
      departs: x.due,
      departsLong: "Due " + x.due,
      app: a,
      title: x.title,
      status: late ? "overdue" : "due",
      source: "assessment",
      record: x,
    });
  }
  for (const r of rounds) {
    if (!["Scheduled", "Rescheduled"].includes(r.status) || r.date < today)
      continue;
    const a = live(r.applicationId);
    if (a === null) continue;
    rows.push({
      key: "r" + r.id,
      rank: r.date === today ? 2 : 3,
      sort: r.date + (r.time || ""),
      departs: `${r.date}${r.time ? " " + r.time : ""}`,
      departsLong: `Departs ${r.date}${r.time ? " at " + r.time : ""}${r.timezone ? " " + r.timezone : ""}`,
      app: a,
      title: r.title,
      status: "scheduled",
      source: "round",
      record: r,
    });
  }
  const active = applications.filter(
    (a) => !a.archived && !["Rejected", "Withdrawn"].includes(a.stage),
  );
  for (const a of active.filter((a) => a.owner === "You"))
    rows.push({
      key: "y" + a.id,
      rank: 1,
      sort: a.ownerEffectiveAt || "",
      departs: "—",
      departsLong: "No time recorded",
      app: a,
      title: a.title,
      status: "move",
      source: "application",
      record: a,
    });
  for (const a of active.filter((a) => a.owner === "Employer"))
    rows.push({
      key: "w" + a.id,
      rank: 4,
      sort: a.ownerEffectiveAt || "9999",
      departs: "—",
      departsLong: "No time recorded",
      app: a,
      title: a.title,
      status: "wait",
      source: "application",
      record: a,
    });
  return rows.sort(
    (x, y) => x.rank - y.rank || x.sort.localeCompare(y.sort),
  );
}

export function Departures(props: Props) {
  const rows = buildDepartures(props);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <div className="dep-board">
      <div className="dep-head" aria-hidden="true">
        <span>Departs</span>
        <span>Service</span>
        <span>Gate</span>
        <span>Status</span>
      </div>
      {rows.length ? (
        <ol className="dep-rows" aria-label="Departures, most urgent first">
          {shown.map((r) => (
            <li key={r.key}>
              <button
                className={"dep-row dep-" + r.status}
                onClick={() => props.onSource(r.source, r.record)}
              >
                <span className="dep-time">
                  <span aria-hidden="true">{r.departs}</span>
                  <span className="sr-only">{r.departsLong}</span>
                </span>
                <span className="dep-service">
                  <strong>
                    {r.app ? `${r.app.company} — ${r.app.title}` : r.title}
                  </strong>
                  {r.source !== "application" && r.app && (
                    <small>{r.title}</small>
                  )}
                  {r.source !== "application" && !r.app && (
                    <small>Personal task</small>
                  )}
                </span>
                <span className="dep-gate">
                  {r.app ? (
                    <GateTag stage={r.app.stage} />
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </span>
                <span className="dep-status">
                  {r.status === "overdue" && <OverdueTag />}
                  {r.status === "move" && (
                    <StatusTag status={ownerStatus(r.app!)} />
                  )}
                  {r.status === "wait" && (
                    <StatusTag status={ownerStatus(r.app!)} />
                  )}
                  {r.status === "scheduled" && (
                    <span className="status-word">
                      {r.source === "round" ? "SCHEDULED" : ""}
                    </span>
                  )}
                  {r.status === "due" && (
                    <span className="status-word">
                      {r.source === "assessment" ? "TEST DUE" : "TASK DUE"}
                    </span>
                  )}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dep-empty">
          No departures. Nothing is overdue, scheduled or waiting on you.
        </p>
      )}
      {rows.length > LIMIT && (
        <button
          className="dep-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer departures" : `Show all ${rows.length} departures`}
        </button>
      )}
    </div>
  );
}
