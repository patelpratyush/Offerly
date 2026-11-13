import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GO_KEYS, PAGE_CODES, STATIONS, isMac } from "./nav";

export type Overlay = null | "palette" | "help";
// Workspace items carry many fields; the palette only reads these four.
type AppRow = { id: string; [key: string]: any };
type Props = {
  overlay: Overlay;
  setOverlay: (value: Overlay) => void;
  /** True while a record dialog, the detail drawer or session check is open. */
  blocked: boolean;
  applications: AppRow[];
  onGoPage: (name: string) => void;
  onOpenApplication: (id: string) => void;
  onAddApplication: () => void;
  onAddTask: () => void;
};

/** Keys that type text: single-key shortcuts must never fire from these. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const field = target.closest<HTMLElement>(
    'input,select,textarea,[role="combobox"],[role="textbox"],[role="searchbox"],[contenteditable="true"]',
  );
  if (!field) return false;
  if (field instanceof HTMLInputElement)
    return !["checkbox", "radio", "button", "submit", "reset"].includes(
      field.type,
    );
  return true;
}

/**
 * Modal behaviour shared by the palette and help: inert page behind, scroll lock,
 * focus restored synchronously to the opener when closed.
 */
function useOverlay(initialFocus: () => HTMLElement | null) {
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>(".shell");
    const wasInert = shell?.hasAttribute("inert") ?? false;
    shell?.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    initialFocus()?.focus();
    return () => {
      if (shell && !wasInert) shell.removeAttribute("inert");
      document.body.style.overflow = overflow;
      if (opener?.isConnected && !opener.closest("[inert]")) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type Item = {
  id: string;
  group: "Pages" | "Actions" | "Applications";
  label: string;
  hint?: string;
  tag?: string;
  run: () => void;
};

function CommandPalette(props: {
  close: () => void;
  applications: AppRow[];
  onGoPage: (name: string) => void;
  onOpenApplication: (id: string) => void;
  onAddApplication: () => void;
  onAddTask: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useOverlay(() => input.current);
  const { close } = props;
  const choose = (item: Item) => {
    close();
    // After the opener regains focus, so record dialogs return focus correctly.
    window.setTimeout(item.run, 0);
  };
  const { items, total } = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) =>
      tokens.every((token) => text.toLowerCase().includes(token));
    const pages: Item[] = STATIONS.filter((name) =>
      matches(name + " " + PAGE_CODES[name] + " page go"),
    ).map((name) => ({
      id: "page-" + name,
      group: "Pages",
      label: name,
      hint: "Go to page",
      tag: PAGE_CODES[name],
      run: () => props.onGoPage(name),
    }));
    const actions: Item[] = (
      [
        ["add-application", "Add application", "n", props.onAddApplication],
        ["add-task", "Add task", "", props.onAddTask],
      ] as const
    )
      .filter(([, label]) => matches(label + " new create"))
      .map(([id, label, key, run]) => ({
        id,
        group: "Actions" as const,
        label,
        hint: key ? `Shortcut ${key}` : undefined,
        run,
      }));
    const sorted = [...props.applications].sort(
      (a, b) => Number(!!a.archived) - Number(!!b.archived),
    );
    const found = sorted.filter((a) =>
      tokens.length ? matches(a.company + " " + a.title) : true,
    );
    const apps: Item[] = found.slice(0, 8).map((a) => ({
      id: "app-" + a.id,
      group: "Applications" as const,
      label: `${a.company} — ${a.title}`,
      hint: a.archived ? `${a.stage} · Archived` : a.stage,
      run: () => props.onOpenApplication(a.id),
    }));
    return {
      items: [...actions, ...pages, ...apps],
      total: found.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, props.applications]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [index, items]);
  const active = items[Math.min(index, items.length - 1)];
  const groups = ["Actions", "Pages", "Applications"] as const;
  return (
    <div
      className="pal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Tab") event.preventDefault();
          else if (event.key === "ArrowDown" && items.length) {
            event.preventDefault();
            setIndex((index + 1) % items.length);
          } else if (event.key === "ArrowUp" && items.length) {
            event.preventDefault();
            setIndex((index - 1 + items.length) % items.length);
          } else if (event.key === "Enter" && active) {
            event.preventDefault();
            choose(active);
          }
        }}
      >
        <div className="pal-head">
          <span className="code-tag ink" aria-hidden="true">
            GO
          </span>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={active ? "pal-" + active.id : undefined}
            aria-label="Jump to a page or application"
            placeholder="Page, company, role or action"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        <div
          id="palette-results"
          className="pal-list"
          role="listbox"
          aria-label="Results"
          ref={list}
        >
          {groups.map((group) => {
            const rows = items.filter((item) => item.group === group);
            if (!rows.length) return null;
            return (
              <div role="group" aria-label={group} key={group}>
                <div className="pal-group" aria-hidden="true">
                  {group}
                </div>
                {rows.map((item) => (
                  <div
                    key={item.id}
                    id={"pal-" + item.id}
                    role="option"
                    aria-selected={item === active}
                    className="pal-opt"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setIndex(items.indexOf(item))}
                    onClick={() => choose(item)}
                  >
                    <span className="pal-label">{item.label}</span>
                    {item.tag && <span className="code-tag">{item.tag}</span>}
                    {item.hint && <span className="pal-hint">{item.hint}</span>}
                  </div>
                ))}
              </div>
            );
          })}
          {!items.length && (
            <p className="pal-empty">Nothing matches. Try a company or role.</p>
          )}
        </div>
        <div className="pal-foot" aria-hidden="true">
          <span>↑↓ move</span>
          <span>Enter open</span>
          <span>Esc close</span>
          {total > 8 && <span>Showing 8 of {total} applications</span>}
        </div>
        <div className="sr-only" role="status">
          {items.length
            ? `${items.length} results${total > 8 ? `, first 8 of ${total} applications` : ""}`
            : "No results"}
        </div>
      </div>
    </div>
  );
}

const HELP_ROWS: [string, string][] = [
  [isMac() ? "⌘ K" : "Ctrl K", "Open the command palette"],
  ["/", "Open the command palette"],
  ["n", "Add application"],
  ["g then t", "Go to Today"],
  ["g then a", "Go to Applications"],
  ["g then f", "Go to Discover"],
  ["g then m", "Go to Companies"],
  ["g then r", "Go to Reviews"],
  ["g then c", "Go to Connections"],
  ["g then d", "Go to Documents"],
  ["g then p", "Go to Prepare"],
  ["g then i", "Go to Insights"],
  ["g then s", "Go to Settings"],
  ["?", "Show this list"],
  ["Esc", "Close dialogs"],
];

function ShortcutHelp({ close }: { close: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useOverlay(() => button.current);
  return (
    <div
      className="pal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="palette help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Tab") event.preventDefault();
        }}
      >
        <div className="pal-head">
          <h2>Keyboard shortcuts</h2>
          <button ref={button} className="secondary" onClick={close}>
            Close
          </button>
        </div>
        <dl className="help-list">
          {HELP_ROWS.map(([keys, action]) => (
            <div key={keys + action}>
              <dt>
                {keys
                  .split(" ")
                  .map((part, i) =>
                    part === "then" ? (
                      <span key={i}> then </span>
                    ) : (
                      <kbd key={i}>{part}</kbd>
                    ),
                  )}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p className="pal-foot">
          Single-key shortcuts pause while you type in a field or a dialog is
          open.
        </p>
      </section>
    </div>
  );
}

/** Command palette, shortcut help, global shortcuts and their aria-live announcer. */
export function ShellOverlays(props: Props) {
  const { overlay, setOverlay } = props;
  const latest = useRef(props);
  latest.current = props;
  const [message, setMessage] = useState("");
  const announce = useCallback((text: string) => {
    setMessage("");
    window.setTimeout(() => setMessage(text), 30);
  }, []);
  useLayoutEffect(() => {
    let goPending: number | null = null;
    const cancelGo = () => {
      if (goPending !== null) window.clearTimeout(goPending);
      goPending = null;
    };
    const onKey = (event: KeyboardEvent) => {
      const p = latest.current;
      if (event.defaultPrevented || event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      if (
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        if (p.blocked || p.overlay === "help") return;
        event.preventDefault();
        p.setOverlay(p.overlay === "palette" ? null : "palette");
        return;
      }
      if (mod || event.altKey) return;
      if (p.blocked || p.overlay || isTyping(event.target)) {
        cancelGo();
        return;
      }
      if (goPending !== null) {
        const name = GO_KEYS[event.key.toLowerCase()];
        cancelGo();
        if (name) {
          event.preventDefault();
          p.onGoPage(name);
          announce(`Opened ${name}`);
        }
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        p.setOverlay("palette");
      } else if (event.key === "?") {
        event.preventDefault();
        p.setOverlay("help");
      } else if (event.key === "n") {
        event.preventDefault();
        p.onAddApplication();
      } else if (event.key === "g") {
        event.preventDefault();
        announce("Go to: press t, a, f, m, r, c, d, p, i or s");
        goPending = window.setTimeout(cancelGo, 1500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelGo();
      window.removeEventListener("keydown", onKey);
    };
  }, [announce]);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      {overlay === "palette" && (
        <CommandPalette
          close={() => setOverlay(null)}
          applications={props.applications}
          onGoPage={(name) => {
            props.onGoPage(name);
            announce(`Opened ${name}`);
          }}
          onOpenApplication={props.onOpenApplication}
          onAddApplication={props.onAddApplication}
          onAddTask={props.onAddTask}
        />
      )}
      {overlay === "help" && <ShortcutHelp close={() => setOverlay(null)} />}
    </>
  );
}
