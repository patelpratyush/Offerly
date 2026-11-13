import { useEffect, useRef, useState } from "react";

type Rec = { id: string; [key: string]: any };

const GATES: Record<string, string> = {
  Saved: "SAV",
  Preparing: "PRE",
  Submitted: "SUB",
  "Under review": "REV",
  Review: "REV",
  Assessment: "ASM",
  Interviewing: "INT",
  Interview: "INT",
  Offer: "OFR",
  Rejected: "REJ",
  Withdrawn: "WDR",
};
export function gateCode(stage: string) {
  return (
    GATES[stage] ||
    stage
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase() ||
    "—"
  );
}
/** Gate code tag with the full stage word always present. */
export function GateTag({ stage }: { stage: string }) {
  return (
    <span className={"gate-tag gate-" + gateCode(stage).toLowerCase()}>
      <b aria-hidden="true">{gateCode(stage)}</b>
      <span>{stage}</span>
    </span>
  );
}

export function daysSince(value: unknown, now = Date.now()) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms)
    ? Math.max(0, Math.floor((now - ms) / 86400000))
    : null;
}

export type StatusWord = {
  tone: "move" | "wait" | "over" | "quiet";
  text: string;
  long: string;
};
/** Status words come only from recorded ownership and due dates. */
export function ownerStatus(a: Rec): StatusWord {
  if (a.owner === "You")
    return { tone: "move", text: "YOUR MOVE", long: "Your reply is next" };
  if (a.owner === "Employer") {
    const d = daysSince(a.ownerEffectiveAt);
    return {
      tone: "wait",
      text: d === null ? "WAITING" : `WAITING ${d} D`,
      long:
        "Waiting for employer" +
        (d === null ? "" : ` · ${d} ${d === 1 ? "day" : "days"}`),
    };
  }
  if (a.owner === "Nobody")
    return { tone: "quiet", text: "NO REPLY DUE", long: "No reply needed" };
  return {
    tone: "quiet",
    text: "OWNER UNCLEAR",
    long: "Response owner unclear",
  };
}
export function StatusTag({ status }: { status: StatusWord }) {
  return (
    <span className={"status-word status-" + status.tone}>
      <span aria-hidden="true">{status.text}</span>
      <span className="sr-only">{status.long}</span>
    </span>
  );
}
export function OverdueTag() {
  return <span className="status-word status-over">OVERDUE</span>;
}

export function appHasOverdue(a: Rec, w: any, today: string) {
  return (
    w.tasks.some(
      (t: Rec) =>
        t.applicationId === a.id && !t.done && t.due && t.due < today,
    ) ||
    w.assessments.some(
      (x: Rec) =>
        x.applicationId === a.id &&
        !["Completed", "Canceled"].includes(x.status) &&
        x.due &&
        x.due < today,
    )
  );
}

export type NextMove = {
  kind: "reply" | "task" | "prepare" | "add";
  label: string;
  detail: string;
  record?: Rec;
  href?: string;
};
/** One primary next move, derived only from recorded data. */
export function deriveNextMove(a: Rec, w: any, today: string): NextMove {
  const openTasks = w.tasks
    .filter((t: Rec) => t.applicationId === a.id && !t.done)
    .sort((x: Rec, y: Rec) => (x.due || "9999").localeCompare(y.due || "9999"));
  if (a.owner === "You") {
    const contact = (w.contacts || []).find(
      (c: Rec) =>
        c.email &&
        (c.applicationId === a.id || c.applicationIds?.includes(a.id)),
    );
    if (contact)
      return {
        kind: "reply",
        label: "Open conversation",
        detail: `Reply to ${contact.name}`,
        href: "mailto:" + contact.email,
      };
    if (openTasks[0])
      return {
        kind: "task",
        label: "Open task",
        detail: openTasks[0].title,
        record: openTasks[0],
      };
    return {
      kind: "add",
      label: "Add reply task",
      detail: "Your reply is next",
    };
  }
  const overdue = openTasks.find((t: Rec) => t.due && t.due < today);
  if (overdue)
    return {
      kind: "task",
      label: "Complete task",
      detail: overdue.title,
      record: overdue,
    };
  const round = w.rounds
    .filter(
      (r: Rec) =>
        r.applicationId === a.id &&
        ["Scheduled", "Rescheduled"].includes(r.status) &&
        r.date >= today,
    )
    .sort((x: Rec, y: Rec) => x.date.localeCompare(y.date))[0];
  if (round)
    return {
      kind: "prepare",
      label: "Prepare",
      detail: `${round.title} · ${round.date}`,
      record: round,
    };
  return {
    kind: "add",
    label: "Add next step",
    detail: "No task or deadline set",
  };
}

/** Split-flap text: characters flip (staggered) when the value changes. */
export function Flap({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const previous = useRef(value);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setRun((n) => n + 1);
    }
  }, [value]);
  return (
    <span className={"flap " + className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" key={run} className={run ? "flap-run" : ""}>
        {Array.from(value).map((c, i) => (
          <span key={i} style={{ ["--i" as any]: i }}>
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}
