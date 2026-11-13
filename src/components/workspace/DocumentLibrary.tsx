import { useState } from "react";
import { ArrowUpRight, Download, Files, Plus, Search } from "lucide-react";

type Item = { id: string; [key: string]: any };
type Props = {
  documents: Item[];
  usages: Item[];
  applications: Item[];
  timezone: string;
  maxBytes?: number;
  onVersion: (document: Item) => void;
  onOpen: (application: any) => void;
};

export function DocumentLibrary({
  documents,
  usages,
  applications,
  timezone,
  maxBytes,
  onVersion,
  onOpen,
}: Props) {
  const [search, setSearch] = useState("");
  const families = new Map<string, Item[]>();
  for (const document of documents) {
    const key = document.documentId || document.id;
    const versions = families.get(key) || [];
    versions.push(document);
    families.set(key, versions);
  }
  const matching = [...families.entries()].filter(([, versions]) =>
    versions.some((d) =>
      `${d.title} ${d.label}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const byId = new Map(applications.map((a) => [a.id, a]));
  return (
    <div className="document-library">
      <div className="library-toolbar">
        <label className="search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Search documents"
            placeholder="Find a document or version…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span>
          {families.size}{" "}
          {families.size === 1 ? "document family" : "document families"} ·{" "}
          {documents.length} immutable versions
        </span>
      </div>
      <p className="subtle-info">
        Each upload keeps its original bytes. A new version never replaces a
        submitted version.
        {maxBytes
          ? ` Upload limit: ${Number((maxBytes / 1024 / 1024).toFixed(1))} MiB per file.`
          : ""}
      </p>
      {matching.map(([id, versions]) => {
        const ordered = [...versions].sort(
          (a, b) =>
            (b.versionNumber || 0) - (a.versionNumber || 0) ||
            (b.createdAt || "").localeCompare(a.createdAt || ""),
        );
        const latest = ordered[0];
        return (
          <section
            className="document-family"
            key={id}
            aria-label={latest.title + " versions"}
          >
            <header className="document-family-heading">
              <span className="file-icon" aria-hidden="true">
                <Files size={24} aria-hidden="true" />
              </span>
              <div>
                <span className="tiny-label">{latest.label}</span>
                <h2>{latest.title}</h2>
                <p>
                  {versions.length}{" "}
                  {versions.length === 1 ? "version" : "versions"} · Original
                  files preserved
                </p>
              </div>
              <button className="secondary" onClick={() => onVersion(latest)}>
                <Plus size={16} aria-hidden="true" /> New version
              </button>
            </header>
            <div className="document-version-list">
              {ordered.map((d) => {
                const submitted = usages.filter(
                  (u) => u.documentVersionId === d.id && !u.retracted,
                );
                const linked = [
                  ...new Set<string>([
                    ...(d.applicationIds || []),
                    ...submitted.map((u) => u.applicationId),
                  ]),
                ]
                  .map((key) => byId.get(key))
                  .filter((a): a is Item => !!a);
                return (
                  <article
                    className={`document-version${submitted.length ? " is-submitted" : ""}`}
                    key={d.id}
                  >
                    <div className="version-identity">
                      <strong>
                        {d.versionNumber
                          ? `Version ${d.versionNumber}`
                          : "Legacy version"}
                        {submitted.length > 0 && (
                          <span className="manifest-stamp">Submitted</span>
                        )}
                      </strong>
                      <span>{d.title}</span>
                      <small>
                        {d.createdAt
                          ? new Date(d.createdAt).toLocaleDateString("en-US", {
                              timeZone: timezone,
                            })
                          : "Upload date unknown"}
                      </small>
                    </div>
                    <div className="version-usage">
                      <strong>
                        {submitted.length} recorded{" "}
                        {submitted.length === 1 ? "submission" : "submissions"}
                      </strong>
                      <small>
                        {submitted.length
                          ? "This exact version is on record"
                          : "No recorded submissions"}
                      </small>
                      <div className="version-applications">
                        {linked.map((a) => (
                          <button
                            className="text-button"
                            key={a.id}
                            onClick={() => onOpen(a)}
                          >
                            {a.company} · {a.title}
                            <ArrowUpRight size={13} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <a
                      className="text-button version-download"
                      href={"/api/files/" + encodeURIComponent(d.fileId)}
                    >
                      <Download size={16} aria-hidden="true" /> Download
                      original
                    </a>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {!matching.length && documents.length > 0 && (
        <p className="panel panel-copy" role="status">
          No documents match “{search}”. Try another title or document type.
        </p>
      )}
    </div>
  );
}
