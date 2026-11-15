import { Link, useLocation } from "react-router";
import "../styles/dispatch/public.css";

const workspaceLinks: [string, string][] = [
  ["Today", "/today"],
  ["Applications", "/applications"],
  ["Reviews", "/reviews"],
  ["Connections", "/connections"],
  ["Documents", "/documents"],
  ["Settings", "/settings"],
];
const publicLinks: [string, string][] = [
  ["Home", "/"],
  ["Sign in", "/signin"],
];

/** Shown for addresses that match no Offerly route. */
export function NotFound({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation();
  const links = signedIn ? workspaceLinks : publicLinks;
  return (
    <main className="pub pub-notfound" id="not-found">
      <Link className="pub-brand" to="/" aria-label="Offerly home">
        <span className="pub-mark" aria-hidden="true">
          O
        </span>
        Offerly
      </Link>
      <div className="pub-notfound-card">
        <p className="pub-eyebrow">404</p>
        <h1>Page not found</h1>
        <p>This address does not match an Offerly page.</p>
        <code className="pub-path">
          {pathname.length > 60 ? pathname.slice(0, 60) + "…" : pathname}
        </code>
        <nav aria-label="Pages you can reach">
          <ul className="pub-notfound-links">
            {links.map(([name, to]) => (
              <li key={to}>
                <Link to={to}>{name}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
