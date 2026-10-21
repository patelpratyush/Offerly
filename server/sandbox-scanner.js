import { Sandbox as DefaultSandbox } from "@vercel/sandbox";
import { HttpError } from "./security.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AGE = 48 * 60 * 60 * 1000;
const DOCUMENT = "/vercel/sandbox/document";
const unavailable = () => new HttpError(503, "Document scanning is unavailable. Try again later.");
const scanArgs = (path) => [
  "35s", "clamscan", "--stdout", "--no-summary=no", "--alert-exceeds-max=yes",
  "--alert-encrypted=yes", "--alert-broken=yes", "--max-filesize=100M",
  "--max-scansize=100M", "--max-files=2000", "--max-recursion=16",
  "--max-scantime=25000", path,
];
function fresh(value, now) {
  return Number.isSafeInteger(value) && value <= now + 300000 && value >= now - MAX_AGE;
}
async function scanFile(sandbox, path) {
  const result = await sandbox.runCommand("timeout", scanArgs(path));
  const output = await result.stdout();
  if (result.exitCode === 1) throw new HttpError(400, "Document failed malware scanning.");
  if (result.exitCode !== 0 || !output.includes(`${path}: OK`) ||
      !/^Scanned files:\s+1\s*$/m.test(output) || !/^Infected files:\s+0\s*$/m.test(output) ||
      /ERROR|WARNING|Heuristics\.Limits\.Exceeded/i.test(output)) throw unavailable();
}

export async function scanWithSandbox(body, { snapshotId, definitionsAt, Sandbox = DefaultSandbox, sdk, now = Date.now() } = {}) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_BYTES)
    throw new HttpError(400, "Hosted documents must be between 1 byte and 2 MB.");
  const time = typeof now === "function" ? now() : now;
  if (typeof snapshotId !== "string" || !/^snap_[a-zA-Z0-9]+$/.test(snapshotId) || !fresh(definitionsAt, time)) throw unavailable();
  let sandbox;
  let failure;
  try {
    sandbox = await (sdk || Sandbox).create({ source: { type: "snapshot", snapshotId }, persistent: false,
      networkPolicy: "deny-all", timeout: 45000, resources: { vcpus: 2 } });
    await sandbox.writeFiles([{ path: DOCUMENT, content: body, mode: 0o600 }]);
    await scanFile(sandbox, DOCUMENT);
  } catch (error) {
    failure = error instanceof HttpError ? error : unavailable();
  } finally {
    if (sandbox) {
      try { await sandbox.stop(); } catch { failure = unavailable(); }
    }
  }
  if (failure) throw failure;
}

// This VM accepts trusted probes only. Never reuse an upload VM for maintenance.
export async function refreshScannerSnapshot({ snapshotId, Sandbox = DefaultSandbox, now = Date.now() } = {}) {
  let sandbox;
  let captured = false;
  try {
    sandbox = await Sandbox.create({ ...(snapshotId ? { source: { type: "snapshot", snapshotId } } : { image: "vercel/sandbox/ubuntu" }),
      persistent: false, timeout: 300000, resources: { vcpus: 2 }, networkPolicy: "allow-all" });
    const install = await sandbox.runCommand({ cmd: "bash", args: ["-c", "set -eu; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y --no-install-recommends clamav clamav-freshclam; if command -v systemctl >/dev/null; then systemctl stop clamav-freshclam 2>/dev/null || true; fi; freshclam --stdout"], sudo: true });
    if (install.exitCode !== 0) throw unavailable();
    const info = await sandbox.runCommand("bash", ["-c", "set -eu; db=/var/lib/clamav/daily.cld; test -f \"$db\" || db=/var/lib/clamav/daily.cvd; sigtool --info \"$db\"; clamscan --version"]);
    const output = await info.stdout();
    const definitionsAt = Date.parse(output.match(/^Build time:\s*(.+)$/m)?.[1] || "");
    const engineVersion = output.match(/^ClamAV ([0-9]+\.[0-9]+\.[0-9]+)/m)?.[1];
    const time = typeof now === "function" ? now() : now;
    if (info.exitCode !== 0 || !/Verification OK/.test(output) || !fresh(definitionsAt, time) || !engineVersion) throw unavailable();
    const clean = "/vercel/sandbox/clean-probe";
    const infected = "/vercel/sandbox/eicar-probe";
    await sandbox.writeFiles([
      { path: clean, content: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n") },
      { path: infected, content: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*") },
    ]);
    await scanFile(sandbox, clean);
    const probe = await sandbox.runCommand("timeout", scanArgs(infected));
    if (probe.exitCode !== 1 || !/Eicar|EICAR/.test(await probe.stdout())) throw unavailable();
    const removed = await sandbox.runCommand("rm", ["--", clean, infected]);
    if (removed.exitCode !== 0) throw unavailable();
    await sandbox.update({ networkPolicy: "deny-all" });
    const snapshot = await sandbox.snapshot({ expiration: 7 * 24 * 60 * 60 * 1000 });
    captured = true;
    return { snapshotId: snapshot.snapshotId, definitionsAt, engineVersion };
  } catch { throw unavailable(); }
  finally { if (sandbox && !captured) { try { await sandbox.stop(); } catch { /* VM has a hard expiry. */ } } }
}
