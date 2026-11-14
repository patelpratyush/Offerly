import { Link, useLocation } from "react-router";
import "../styles/dispatch/public.css";

const workspaceLinks: [string, string, string][] = [
  ["TDY", "Today", "/today"],
  ["APP", "Applications", "/applications"],
  ["REV", "Reviews", "/reviews"],
  ["PPL", "Connections", "/connections"],
  ["DOC", "Documents", "/documents"],
  ["SET", "Settings", "/settings"],
];
const publicLinks: [string, string, string][] = [
  ["HOM", "Home", "/"],
  ["SIN", "Sign in", "/signin"],
];

/** Cancelled-service page for addresses that match no Offerly route. */
export function NotFound({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation();
  const links = signedIn ? workspaceLinks : publicLinks;
  return (
    <main className="dp-cancelled" id="not-found">
      <div className="dp-board dp-cancelled-board">
        <div className="dp-board-bar">
          <span className="dp-board-title">DEPARTURES</span>
          <span className="dp-board-sample">NO MATCHING SERVICE</span>
        </div>
        <p className="dp-cancelled-row">
          <span className="dp-cancelled-path">
            {pathname.length > 60 ? pathname.slice(0, 60) + "…" : pathname}
          </span>
          <span className="dp-cancelled-status">CANCELLED</span>
        </p>
      </div>
      <div className="dp-cancelled-body">
        <h1>Page not found</h1>
        <p>This address does not match an Offerly page.</p>
        <nav aria-label="Pages you can reach">
          <ul className="dp-cancelled-links">
            {links.map(([code, name, to]) => (
              <li key={to}>
                <Link to={to}>
                  <span className="dp-gate-code">{code}</span>
                  <span>{name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
