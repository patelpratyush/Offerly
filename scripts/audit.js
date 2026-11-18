// npm audit (moderate and above) that tolerates only the advisories listed here.
// shortcut: GHSA-fc5q-39xc-vjpf (picomatch ReDoS, reaches us only via Vite at
// build time) has no fixed release yet; delete it from IGNORED once one ships.
import { execFileSync } from "node:child_process";

const IGNORED = ["GHSA-fc5q-39xc-vjpf"];
const LEVELS = ["info", "low", "moderate", "high", "critical"];

let out;
try {
  out = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
} catch (error) {
  out = error.stdout; // npm exits non-zero when it finds anything
}
const { vulnerabilities = {} } = JSON.parse(out);

// A package is ignorable when every cause is an ignored advisory or another
// ignorable package (e.g. vite -> tinyglobby -> picomatch).
const ignorable = (name, seen = new Set()) => {
  if (seen.has(name)) return true;
  seen.add(name);
  const vuln = vulnerabilities[name];
  return (
    !!vuln &&
    vuln.via.every((via) =>
      typeof via === "string"
        ? ignorable(via, seen)
        : IGNORED.some((id) => via.url?.endsWith(id)),
    )
  );
};

const blocking = Object.entries(vulnerabilities).filter(
  ([name, vuln]) =>
    LEVELS.indexOf(vuln.severity) >= LEVELS.indexOf("moderate") &&
    !ignorable(name),
);
for (const [name, vuln] of blocking) console.error(`${vuln.severity}: ${name}`);
const skipped = Object.keys(vulnerabilities).filter((name) => ignorable(name));
if (skipped.length)
  console.log(`Ignored (${IGNORED.join(", ")}): ${skipped.join(", ")}`);
if (blocking.length) process.exit(1);
console.log("npm audit: no blocking vulnerabilities");
