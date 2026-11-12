import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Size, discoveryApi, when } from "./api";

type SourceRow = {
  id: string;
  platform: string;
  boardId: string;
  collecting: boolean;
  health: string;
  lastSuccessAt: string | null;
  nextFetchAt: string | null;
  listedCount: number;
  verification: "verified" | "could_not_verify" | "not_collecting";
};
type Company = {
  id: string;
  name: string;
  domain: string;
  size: Size;
  openJobs: number;
  watched: boolean;
  sources: SourceRow[];
};
const PLATFORM: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
};
const STATUS: Record<string, string> = {
  verified: "Verified recently",
  could_not_verify: "Could not verify recently",
  not_collecting: "Not being collected",
};
export function CompaniesPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await discoveryApi("/coverage"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load coverage");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <div className="panel" role="alert">
        <p>{error}</p>
        <button className="secondary" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  if (!data) return <p className="loading-copy">Loading coverage…</p>;
  const companies: Company[] = data.companies;
  return (
    <div className="discover">
      <section
        className="panel discover-coverage"
        aria-label="Coverage summary"
      >
        <p>
          <strong>{data.statement}</strong>
        </p>
        <p className="muted">
          {data.summary.companies} companies · {data.summary.sources} registered
          boards · {data.summary.collectingSources} being collected ·{" "}
          {data.summary.unverifiedSources} not verified recently. A failed check
          marks a listing "could not verify"; it never closes it.
        </p>
      </section>
      {companies.length ? (
        <div className="discover-list">
          {companies.map((c) => (
            <article
              key={c.id}
              className="discover-card"
              aria-labelledby={`co-${c.id}`}
            >
              <header>
                <div>
                  <h3 id={`co-${c.id}`}>{c.name}</h3>
                  <p className="discover-company">{c.domain}</p>
                </div>
                <button
                  className="secondary"
                  aria-pressed={c.watched}
                  onClick={async () => {
                    await discoveryApi(
                      `/companies/${c.id}/watch`,
                      c.watched ? "DELETE" : "PUT",
                    ).catch((e) => setError(e.message));
                    await load();
                  }}
                >
                  {c.watched ? "Watching" : "Watch"}
                  <span className="sr-only"> {c.name}</span>
                </button>
              </header>
              <ul className="discover-badges" aria-label="Company facts">
                <li className={c.size.ambiguous ? "is-warn" : ""}>
                  {c.size.label}
                </li>
                {c.size.entity !== "employer" && (
                  <li>
                    Size describes the {c.size.entity}
                    {c.size.entityName ? `: ${c.size.entityName}` : ""}
                  </li>
                )}
                <li>{c.openJobs} open in catalog</li>
              </ul>
              {c.size.estimate && (
                <p className="muted">
                  Size estimate {c.size.estimate} employees
                  {c.size.asOf ? ` as of ${c.size.asOf}` : ""}
                  {c.size.sourceUrl && (
                    <>
                      {" "}
                      (
                      <a
                        href={c.size.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        source
                      </a>
                      )
                    </>
                  )}
                  .
                </p>
              )}
              {!c.size.estimate && (
                <p className="muted">
                  No cited size estimate; size is not guessed.
                </p>
              )}
              <table className="discover-table">
                <caption className="sr-only">Sources for {c.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last successful check</th>
                    <th scope="col">Next check</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sources.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">
                        {PLATFORM[s.platform]} · {s.boardId}
                      </th>
                      <td>
                        <span className={"discover-pill is-" + s.verification}>
                          {STATUS[s.verification]}
                        </span>
                        {s.collecting && s.health !== "healthy"
                          ? ` (${s.health})`
                          : ""}
                      </td>
                      <td>
                        {s.lastSuccessAt ? when(s.lastSuccessAt) : "Never"}
                      </td>
                      <td>
                        {s.nextFetchAt ? when(s.nextFetchAt) : "Not scheduled"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel discover-empty">
          <h2>No companies registered yet</h2>
          <p>
            Offerly only lists employers an operator has added and approved.
            Nothing here is sample data. You can still track any role manually
            from <Link to="/applications">Applications</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
