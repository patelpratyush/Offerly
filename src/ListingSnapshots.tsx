function safeSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

function recordedTime(value: unknown, timezone: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return "Recording time unknown";
  return new Date(value).toLocaleString("en-US", { timeZone: timezone });
}

export function ListingSnapshots({
  snapshots,
  timezone,
}: {
  snapshots: any[];
  timezone: string;
}) {
  return (
    <section aria-label="Listing history">
      <h3>Listing history</h3>
      <p className="muted">
        Saved versions preserve the description and capture details as recorded.
      </p>
      {!snapshots.length ? (
        <p className="muted">No listing snapshots saved yet.</p>
      ) : (
        <div className="timeline">
          {[...snapshots].reverse().map((snapshot, index) => {
            const source = safeSource(snapshot.sourceUrl);
            return (
              <article key={snapshot.id || `${snapshot.recordedAt}-${index}`}>
                <span className="timeline-dot" />
                <strong>
                  {snapshot.capturedDate
                    ? `Captured ${snapshot.capturedDate}`
                    : "Capture date unknown"}
                </strong>
                <small>
                  Saved: {recordedTime(snapshot.recordedAt, timezone)}
                </small>
                <p>
                  {source ? (
                    <a href={source} target="_blank" rel="noopener noreferrer">
                      View listing source
                    </a>
                  ) : (
                    "Listing source unknown"
                  )}
                </p>
                <details>
                  <summary>
                    Saved description · version {snapshots.length - index}
                  </summary>
                  <p className="notes">
                    {snapshot.description || "Description cleared"}
                  </p>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
