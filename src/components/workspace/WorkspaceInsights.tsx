import { Download } from "lucide-react";
type Item = { id: string; [key: string]: any };
export function WorkspaceInsights({
  applications,
  stages,
}: {
  applications: Item[];
  stages: string[];
}) {
  const total = applications.length;
  const active = applications.filter((a) => !a.archived);
  const dated = applications.filter((a) => !!a.appliedDate);
  const sources = new Map<string, number>();
  for (const a of applications)
    sources.set(
      a.source || "Not recorded",
      (sources.get(a.source || "Not recorded") || 0) + 1,
    );
  if (!total)
    return (
      <section className="panel insights-empty">
        <span className="tiny-label">YOUR SEARCH, IN PERSPECTIVE</span>
        <span className="pr-nodata">No data yet</span>
        <h2>A clearer picture starts with your first application.</h2>
        <p>
          No application data yet. Stage distribution and source counts appear
          here once you add records.
        </p>
        <p className="muted">
          Conversion, response time and time-in-stage metrics need recorded
          submission dates and will appear below once you have them.
        </p>
      </section>
    );
  return (
    <div className="insight-layout">
      <section className="panel insight-pipeline">
        <div className="section-head">
          <div>
            <span className="tiny-label">CURRENT STAGE DISTRIBUTION</span>
            <h2>Your pipeline today</h2>
          </div>
          <span className="muted">{total} total applications</span>
        </div>
        <p className="panel-copy muted">
          Each bar shows its share of all {total} recorded applications,
          including {total - active.length} archived. Current stages describe a
          snapshot, not conversion rates.
        </p>
        <div className="insights">
          {stages.map((stage) => {
            const count = applications.filter((a) => a.stage === stage).length;
            return (
              <div className="bar-row" key={stage}>
                <span>{stage}</span>
                <div
                  role="img"
                  aria-label={`${stage}: ${count} of ${total} applications`}
                >
                  <i style={{ width: `${(count / total) * 100}%` }} />
                </div>
                <b>
                  {count}
                  <small> / {total}</small>
                </b>
              </div>
            );
          })}
        </div>
        <a className="text-button panel-copy" href="/api/export.csv">
          <Download size={16} aria-hidden="true" /> Export application data
        </a>
      </section>
      <aside className="insight-context">
        <section className="panel">
          <div className="section-head">
            <h2>Where roles came from</h2>
          </div>
          <p className="panel-copy muted">
            User-recorded source · all {total} applications
          </p>
          <dl className="source-breakdown">
            {[...sources.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => (
                <div key={source}>
                  <dt>{source}</dt>
                  <dd>
                    {count} <small>/ {total}</small>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="insight-data-note">
          <span className="tiny-label">READ THE RECORD ACCURATELY</span>
          <h2>Known dates, clear limits.</h2>
          <p>
            {dated.length} of {total} applications have a recorded applied date.{" "}
            {total - dated.length}{" "}
            {total - dated.length === 1 ? "date is" : "dates are"} unknown.
          </p>
          <p>
            Current stage counts do not establish response rates or hiring
            probability. Cohort conversion and time metrics below use recorded
            submission dates and event history, and are descriptive only.
          </p>
        </section>
      </aside>
    </div>
  );
}
