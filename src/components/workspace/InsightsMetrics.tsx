import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import "../../styles/insights-reminders.css";

type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Group = {
  submitted: number;
  interview: number;
  offer: number;
  interviewRate: number | null;
  offerRate: number | null;
  smallSample: boolean;
};
const pct = (v: number | null) =>
  v === null ? "n/a" : `${Math.round(v * 100)}%`;
const days = (v: number | null) =>
  v === null ? "n/a" : `${Math.round(v * 10) / 10} d`;

function Bar({ value }: { value: number | null }) {
  return (
    <span className="pr-bar" aria-hidden="true">
      {value === null ? (
        <em>No data yet</em>
      ) : (
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      )}
    </span>
  );
}

function GroupTable({
  caption,
  label,
  rows,
}: {
  caption: string;
  label: string;
  rows: (Group & { name: string })[];
}) {
  return (
    <div
      className="ir-table-wrap"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="ir-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Submitted (n)</th>
            <th scope="col">Interview</th>
            <th scope="col">Offer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">
                {r.name}
                {r.smallSample && <span className="ir-tag">small sample</span>}
              </th>
              <td>{r.submitted}</td>
              <td>
                {r.interview} / {r.submitted} ({pct(r.interviewRate)})
              </td>
              <td>
                {r.offer} / {r.submitted} ({pct(r.offerRate)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsMetrics({ request }: { request: Request }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalid = !!from && !!to && from > to;
  const query = new URLSearchParams();
  if (from && !invalid) query.set("from", from);
  if (to && !invalid) query.set("to", to);
  const qs = query.size ? `?${query}` : "";
  useEffect(() => {
    if (invalid) return;
    let alive = true;
    setError("");
    request("/insights" + qs)
      .then((v) => alive && setData(v))
      .catch(
        (e) =>
          alive &&
          setError(e instanceof Error ? e.message : "Insights unavailable."),
      );
    return () => {
      alive = false;
    };
  }, [request, qs, invalid]);
  if (error)
    return (
      <p className="ir-error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p className="ir-status">Loading metrics…</p>;
  const t = data.totals,
    c = data.conversion.overall,
    r = data.timeToFirstResponse;
  const excluded = t.excluded.unknownSubmissionDate + t.excluded.outsideRange;
  return (
    <section className="ir-section" aria-labelledby="ir-metrics-heading">
      <div className="section-head">
        <div>
          <span className="tiny-label">SUBMISSION COHORT METRICS</span>
          <h2 id="ir-metrics-heading">What your own records show</h2>
        </div>
      </div>
      <p className="ir-note">{data.note}</p>
      <div className="ir-filters">
        <label>
          Submitted from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Submitted to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {invalid && (
          <span className="ir-error" role="alert">
            Start date must not follow end date.
          </span>
        )}
      </div>
      {t.uniqueSubmittedApplications === 0 ? (
        <div className="panel">
          <h3>No submitted applications with a known date yet</h3>
          <p className="muted">
            Conversion, response time and time in stage need a recorded
            submission date. Record a submission or applied date to begin.
            {excluded > 0 &&
              ` ${excluded} application${excluded === 1 ? " is" : "s are"} excluded by an unknown submission date or the selected range.`}
          </p>
        </div>
      ) : (
        <>
          <dl className="ir-stats">
            <div className="ir-stat">
              <dt>Unique submitted applications</dt>
              <dd>
                {t.uniqueSubmittedApplications}{" "}
                <small>
                  of {t.applications} total · {excluded} excluded (unknown date
                  or range)
                </small>
              </dd>
            </div>
            <div className="ir-stat">
              <dt>Reached interview</dt>
              <dd>
                {c.interview} / {c.submitted}
                <small>
                  {pct(c.interviewRate)} · verified round records only
                </small>
                <Bar value={c.interviewRate} />
              </dd>
            </div>
            <div className="ir-stat">
              <dt>Reached offer</dt>
              <dd>
                {c.offer} / {c.submitted}
                <small>{pct(c.offerRate)} · unique applications</small>
                <Bar value={c.offerRate} />
              </dd>
            </div>
            <div className="ir-stat">
              <dt>Median time to first response</dt>
              <dd>
                {days(r.median)}{" "}
                <small>
                  n = {r.sampleSize} · {r.excluded.noResponseRecorded} without a
                  response · {r.excluded.unknownSubmissionDate} with unknown
                  submission date
                </small>
              </dd>
            </div>
          </dl>
          <p className="panel-copy muted">{data.conversion.definition}</p>
          <div
            className="ir-table-wrap"
            role="region"
            aria-label="Submissions per week"
            tabIndex={0}
          >
            <table className="ir-table">
              <caption>Submissions per week</caption>
              <thead>
                <tr>
                  <th scope="col">Week starting (Monday)</th>
                  <th scope="col">Submissions</th>
                </tr>
              </thead>
              <tbody>
                {data.submissionsPerWeek.map((w: any) => (
                  <tr key={w.weekStart}>
                    <th scope="row">{w.weekStart}</th>
                    <td>{w.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GroupTable
            caption="Conversion by submission-week cohort"
            label="Cohort week"
            rows={data.conversion.byWeek.map((w: any) => ({
              ...w,
              name: w.weekStart,
            }))}
          />
          <p className="panel-copy muted">{r.definition}</p>
          <div
            className="ir-table-wrap"
            role="region"
            aria-label="Time in stage"
            tabIndex={0}
          >
            <table className="ir-table">
              <caption>Time in stage (completed visits)</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Visits (n)</th>
                  <th scope="col">Median</th>
                  <th scope="col">Range</th>
                </tr>
              </thead>
              <tbody>
                {data.timeInStage.stages.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      No completed stage visits recorded yet; nothing is shown
                      as zero.
                    </td>
                  </tr>
                )}
                {data.timeInStage.stages.map((s: any) => (
                  <tr key={s.stage}>
                    <th scope="row">{s.stage}</th>
                    <td>{s.sampleSize}</td>
                    <td>{days(s.median)}</td>
                    <td>
                      {days(s.min)} – {days(s.max)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-copy muted">
            {data.timeInStage.definition}{" "}
            {data.timeInStage.excluded.stillInStage} current stage visit(s)
            excluded.
          </p>
          <GroupTable
            caption="Outcomes by source"
            label="Source"
            rows={data.bySource.map((s: any) => ({ ...s, name: s.source }))}
          />
          <GroupTable
            caption="Outcomes by submitted resume version"
            label="Resume version"
            rows={data.byDocumentVersion.map((s: any) => ({
              ...s,
              name: s.version,
            }))}
          />
          <p className="panel-copy muted">{data.byDocumentVersionNote}</p>
        </>
      )}
      <div className="ir-actions">
        <a
          className="text-button"
          href={`/api/insights.csv${qs}`}
          aria-disabled={invalid}
        >
          <Download size={16} aria-hidden="true" /> Export insights CSV
        </a>
      </div>
    </section>
  );
}
