import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { LogOut, Search } from "lucide-react";
import { pagePaths } from "../../routing";
import { Flap } from "./Flap";
import { PAGE_CODES, STATIONS, isMac, stationNumber } from "./nav";

type RailProps = {
  page: string;
  applicationCount: number;
  userName: string;
  navigationOpen: boolean;
  inert: boolean;
  onToggleMenu: () => void;
  onNavigate: () => void;
  onSearch: () => void;
  onSignOut: () => void;
};

/** Left rail on desktop; bottom station bar on mobile. One <nav>, native links. */
export function ShellRail(props: RailProps) {
  const { page } = props;
  const navRef = useRef<HTMLElement>(null);
  // Keep the active station visible when the mobile bar scrolls horizontally.
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
  }, [page]);
  return (
    <aside className="sidebar" inert={props.inert}>
      <Link className="brand" to="/today">
        <span className="brand-mark" aria-hidden="true">
          O
        </span>
        Offerly
      </Link>
      <button
        className="mobile-menu secondary"
        aria-expanded={props.navigationOpen}
        aria-controls="workspace-navigation"
        onClick={props.onToggleMenu}
      >
        {props.navigationOpen ? "Close menu" : page}
      </button>
      <button
        className="rail-search"
        onClick={props.onSearch}
        aria-keyshortcuts="Control+K Meta+K /"
      >
        <Search size={16} aria-hidden="true" />
        <span>Jump to…</span>
        <kbd aria-hidden="true">{isMac() ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <div className="workspace-label">Workspace</div>
      <nav
        ref={navRef}
        id="workspace-navigation"
        aria-label="Workspace"
        className={"rail-nav" + (props.navigationOpen ? " is-open" : "")}
      >
        <ol>
          {STATIONS.map((name) => (
            <li key={name}>
              <Link
                to={pagePaths[name]}
                aria-current={page === name ? "page" : undefined}
                className={"station" + (page === name ? " active" : "")}
                onClick={props.onNavigate}
              >
                <span className="station-node" aria-hidden="true" />
                <span className="station-label">{name}</span>
                {name === "Applications" && (
                  <span className="nav-count">
                    <Flap value={props.applicationCount} />
                  </span>
                )}
                <span className="nav-index" aria-hidden="true">
                  {stationNumber(name)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className="account">
        <span className="avatar" aria-hidden="true">
          {props.userName.charAt(0).toUpperCase()}
        </span>
        <div className="account-name">
          <strong>{props.userName}</strong>
          <small>Personal workspace</small>
        </div>
        <button aria-label="Sign out" onClick={props.onSignOut}>
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}

function clockParts(date: Date, timeZone: string) {
  const build = (zone?: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
      timeZone: zone,
    }).formatToParts(date);
  let parts;
  try {
    parts = build(timeZone);
  } catch {
    parts = build();
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("weekday")} ${get("day")} ${get("month")}`,
    time: `${get("hour")}:${get("minute")}`,
    zone: get("timeZoneName"),
    iso: date.toISOString(),
  };
}

/** Top strip: breadcrumb for the page plus the user's local date and time. */
export function ShellTopbar({
  page,
  timezone,
}: {
  page: string;
  timezone: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const clock = clockParts(now, timezone);
  return (
    <header className="topbar">
      <span className="strip-page">
        <span className="sr-only">
          Page code {stationNumber(page)} {PAGE_CODES[page] || "---"}.{" "}
        </span>
        <span className="strip-crumb">Workspace</span>
        <span className="strip-sep" aria-hidden="true">
          /
        </span>
        <b>{page}</b>
      </span>
      <span className="strip-clock">
        <time dateTime={clock.iso}>
          <span className="strip-day">{clock.day} · </span>
          <span className="strip-time">{clock.time}</span>{" "}
          <span className="strip-zone">{clock.zone}</span>
        </time>
        <span className="private-tag">
          <span aria-hidden="true" /> Private workspace
        </span>
      </span>
    </header>
  );
}
