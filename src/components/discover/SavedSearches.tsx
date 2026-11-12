import { Filters } from "./DiscoverFilters";

export type SavedSearch = { id: string; name: string; filters: Filters };
export function SavedSearches({
  searches,
  onApply,
  onDelete,
}: {
  searches: SavedSearch[];
  onApply: (filters: Filters) => void;
  onDelete: (id: string) => void;
}) {
  if (!searches.length)
    return (
      <p className="muted">
        No saved searches yet. Set filters and save them above.
      </p>
    );
  return (
    <ul className="discover-notes" aria-label="Saved searches">
      {searches.map((s) => (
        <li key={s.id}>
          <strong>{s.name}</strong>{" "}
          <button className="text-button" onClick={() => onApply(s.filters)}>
            Apply<span className="sr-only"> {s.name}</span>
          </button>{" "}
          <button className="text-button" onClick={() => onDelete(s.id)}>
            Delete<span className="sr-only"> {s.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
