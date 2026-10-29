import { useState } from "react";

type Item = { id: string; version: number; [key: string]: any };
export function TrackerActions({
  views,
  filters,
  applyView,
  api,
  run,
  busy,
  refresh,
  selected,
  clearSelection,
  stages,
  notify,
}: {
  views: Item[];
  filters: Record<string, any>;
  applyView: (v: any) => void;
  api: (path: string, method?: string, body?: any) => Promise<any>;
  run: (fn: () => Promise<any>) => Promise<void>;
  busy: boolean;
  refresh: () => Promise<any>;
  selected: Record<string, number>;
  clearSelection: () => void;
  stages: string[];
  notify: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [viewId, setViewId] = useState("");
  const [field, setField] = useState("priority");
  const [value, setValue] = useState("High");
  const [operation, setOperation] = useState<{
    payload: string;
    id: string;
  } | null>(null);
  const count = Object.keys(selected).length;
  const options =
    field === "stage"
      ? stages
      : field === "priority"
        ? ["High", "Medium", "Low"]
        : field === "owner"
          ? ["You", "Employer", "Nobody", "Unclear"]
          : ["Archive", "Restore"];
  const currentView = views.find((v) => v.id === viewId);
  return (
    <div className="tracker-actions">
      <div className="saved-view-controls">
        <label>
          Saved views
          <select
            aria-label="Saved view"
            value={viewId}
            disabled={busy}
            onChange={(e) => {
              setViewId(e.target.value);
              const view = views.find((v) => v.id === e.target.value);
              if (view) {
                applyView(view.filters);
                setName(view.name);
              }
            }}
          >
            <option value="">Choose a view</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <details className="save-view-disclosure">
          <summary>Save or manage views</summary>
          <div className="view-editor">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const view = await api("/records/saved_view", "POST", {
                    name,
                    filters,
                  });
                  await refresh();
                  setViewId(view.id);
                  notify("View saved");
                });
              }}
            >
              <label>
                View name
                <input
                  aria-label="View name"
                  value={name}
                  maxLength={60}
                  required
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My next moves"
                />
              </label>
              <button disabled={busy || !name.trim()} type="submit">
                Save new view
              </button>
            </form>
            {currentView && (
              <>
                <button
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    run(async () => {
                      await api(
                        "/records/saved_view/" + currentView.id,
                        "PUT",
                        {
                          ...currentView,
                          name,
                          filters,
                        },
                      );
                      await refresh();
                      notify("View updated");
                    })
                  }
                >
                  Update view
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(
                        "/records/saved_view/" + currentView.id,
                        "PUT",
                        {
                          ...currentView,
                          archived: true,
                        },
                      );
                      await refresh();
                      setViewId("");
                      setName("");
                      notify("Saved view removed");
                    })
                  }
                >
                  Remove view
                </button>
              </>
            )}
          </div>
        </details>
      </div>
      {count > 0 && (
        <section className="bulk-controls" aria-label="Bulk application editor">
          <div>
            <strong>{count} selected</strong>
            <p>
              Only selected applications change. Their histories are preserved.
            </p>
          </div>
          <label>
            Change
            <select
              aria-label="Bulk field"
              value={field}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.value;
                setField(f);
                setValue(
                  f === "stage"
                    ? stages[0]
                    : f === "priority"
                      ? "High"
                      : f === "owner"
                        ? "You"
                        : "Archive",
                );
              }}
            >
              <option value="priority">Priority</option>
              <option value="stage">Stage</option>
              <option value="owner">Next response</option>
              <option value="archived">Archive status</option>
            </select>
          </label>
          <label>
            To
            <select
              aria-label="Bulk value"
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            >
              {options.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const data = {
                  applications: Object.entries(selected).map(
                    ([id, version]) => ({ id, version }),
                  ),
                  changes: {
                    [field]: field === "archived" ? value === "Archive" : value,
                  },
                };
                const payload = JSON.stringify(data),
                  id =
                    operation?.payload === payload
                      ? operation.id
                      : crypto.randomUUID();
                setOperation({ payload, id });
                const result = await api("/applications/bulk", "POST", {
                  ...data,
                  operationId: id,
                });
                await refresh();
                clearSelection();
                setOperation(null);
                notify(`Updated ${result.count} applications`);
              })
            }
          >
            Apply to {count} selected
          </button>
          <button disabled={busy} onClick={clearSelection}>
            Clear selection
          </button>
        </section>
      )}
    </div>
  );
}
