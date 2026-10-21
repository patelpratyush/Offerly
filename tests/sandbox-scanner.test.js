import test from "node:test";
import assert from "node:assert/strict";
import {
  scanWithSandbox,
  refreshScannerSnapshot,
  deleteScannerSnapshot,
} from "../server/sandbox-scanner.js";

const now = Date.UTC(2026, 9, 21, 12);
const cleanOutput = (path = "/vercel/sandbox/document") =>
  `${path}: OK\nScanned files: 1\nInfected files: 0\n`;
function fake({
  exitCode = 0,
  output = cleanOutput(),
  stderr = "",
  fail,
  stopFails = false,
} = {}) {
  const calls = [];
  const sandbox = {
    sandboxId: "sbx_test",
    async writeFiles(files) {
      calls.push(["files", files]);
      if (fail === "write") throw Error("private provider details");
    },
    async runCommand(...args) {
      calls.push(["run", ...args]);
      if (fail === "run") throw Error("timeout secret");
      return {
        exitCode,
        stdout: async () => output,
        stderr: async () => stderr,
      };
    },
    async stop() {
      calls.push(["stop"]);
      if (stopFails) throw Error("secret");
    },
  };
  const Sandbox = {
    async create(options) {
      calls.push(["create", options]);
      if (fail === "create") throw Error("secret");
      return sandbox;
    },
  };
  return {
    calls,
    Sandbox,
    sandbox,
    options: { Sandbox, snapshotId: "snap_test", definitionsAt: now, now },
  };
}
test("sandbox scan isolates each document, disables persistence and always stops", async () => {
  const f = fake();
  await scanWithSandbox(Buffer.from("private resume"), f.options);
  assert.deepEqual(f.calls[0][1], {
    source: { type: "snapshot", snapshotId: "snap_test" },
    persistent: false,
    networkPolicy: "deny-all",
    timeout: 45000,
    resources: { vcpus: 2 },
  });
  assert.equal(f.calls[1][1][0].path, "/vercel/sandbox/document");
  assert.equal(f.calls[1][1][0].mode, 0o600);
  assert.equal(f.calls[2][1], "timeout");
  assert.ok(f.calls[2][2].includes("--alert-exceeds-max=yes"));
  assert.ok(f.calls[2][2].includes("--alert-encrypted=yes"));
  assert.deepEqual(f.calls.at(-1), ["stop"]);
});
test("stale/missing/future definitions and oversized uploads never create VM", async () => {
  for (const patch of [
    { definitionsAt: now - 49 * 3600000 },
    { definitionsAt: now + 3600000 },
    { definitionsAt: undefined },
    { snapshotId: "" },
  ]) {
    const f = fake();
    await assert.rejects(
      scanWithSandbox(Buffer.from("x"), { ...f.options, ...patch }),
      { status: 503 },
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fake();
  await assert.rejects(
    scanWithSandbox(Buffer.alloc(2 * 1024 * 1024 + 1), f.options),
    { status: 400 },
  );
  assert.equal(f.calls.length, 0);
});
test("infection and exceeded scan limits reject and stop VM", async () => {
  for (const output of [
    "document: Eicar-Test-Signature FOUND",
    "document: Heuristics.Limits.Exceeded FOUND",
  ]) {
    const f = fake({ exitCode: 1, output });
    await assert.rejects(scanWithSandbox(Buffer.from("x"), f.options), {
      status: 400,
    });
    assert.deepEqual(f.calls.at(-1), ["stop"]);
  }
});
test("partial scans, scanner errors and warnings fail closed", async () => {
  for (const params of [
    { output: "OK" },
    { output: cleanOutput().replace("Scanned files: 1", "Scanned files: 0") },
    { exitCode: 2 },
    { exitCode: 124 },
    { stderr: "LibClamAV Warning: database error" },
  ]) {
    const f = fake(params);
    await assert.rejects(scanWithSandbox(Buffer.from("x"), f.options), {
      status: 503,
    });
    assert.deepEqual(f.calls.at(-1), ["stop"]);
  }
});
test("SDK failures never leak contents and cleanup failure rejects clean result", async () => {
  for (const params of [
    { fail: "write" },
    { fail: "run" },
    { stopFails: true },
    { fail: "create" },
  ]) {
    const f = fake(params);
    await assert.rejects(
      scanWithSandbox(Buffer.from("private"), f.options),
      (error) => error.status === 503 && !/secret|private/.test(error.message),
    );
    if (params.fail !== "create") assert.deepEqual(f.calls.at(-1), ["stop"]);
  }
});
test("maintenance snapshots contain no probes and only fresh verified signatures", async () => {
  const f = fake();
  f.sandbox.runCommand = async (command, args) => {
    f.calls.push(["run", command, args]);
    const path = args?.at(-1);
    if (command === "timeout")
      return {
        exitCode: path.includes("eicar") ? 1 : 0,
        stdout: async () =>
          path.includes("eicar")
            ? "Eicar-Test-Signature FOUND"
            : cleanOutput(path),
        stderr: async () => "",
      };
    return {
      exitCode: 0,
      stdout: async () =>
        "Build time: 21 Oct 2026 11:00 +0000\nVerification OK.\nClamAV 1.4.3/123/Oct 21 2026\n",
    };
  };
  f.sandbox.update = async (options) => f.calls.push(["update", options]);
  f.sandbox.snapshot = async () => {
    f.calls.push(["snapshot"]);
    return { snapshotId: "snap_new" };
  };
  const result = await refreshScannerSnapshot({ Sandbox: f.Sandbox, now });
  assert.equal(result.snapshotId, "snap_new");
  assert.equal(result.engineVersion, "1.4.3");
  assert.deepEqual(f.calls.at(-2), ["update", { networkPolicy: "deny-all" }]);
  assert.deepEqual(f.calls.at(-1), ["snapshot"]);
  assert.ok(f.calls.some((call) => call[0] === "run" && call[1] === "rm"));
  assert.equal(f.calls.filter((call) => call[0] === "files")[0][1].length, 2);
});
test("maintenance failures stop VM and never publish snapshot", async () => {
  const f = fake({ exitCode: 2 });
  await assert.rejects(refreshScannerSnapshot({ Sandbox: f.Sandbox, now }), {
    status: 503,
  });
  assert.deepEqual(f.calls.at(-1), ["stop"]);
});
test("maintenance refuses unsigned or stale signature databases", async () => {
  for (const details of [
    "Build time: 21 Oct 2026 11:00 +0000\nClamAV 1.4.3/123\n",
    "Build time: 01 Oct 2026 11:00 +0000\nVerification OK.\nClamAV 1.4.3/123\n",
  ]) {
    const f = fake();
    f.sandbox.runCommand = async () => ({
      exitCode: 0,
      stdout: async () => details,
    });
    f.sandbox.snapshot = async () =>
      assert.fail("Invalid definitions must not be snapshotted");
    await assert.rejects(refreshScannerSnapshot({ Sandbox: f.Sandbox, now }), {
      status: 503,
    });
    assert.deepEqual(f.calls.at(-1), ["stop"]);
  }
});

test("snapshot cleanup cannot delete active snapshot and failure stays nonfatal", async () => {
  let deleted = false;
  const Snapshot = {
    async get({ snapshotId }) {
      assert.equal(snapshotId, "snap_old");
      return {
        async delete() {
          deleted = true;
        },
      };
    },
  };
  assert.equal(
    await deleteScannerSnapshot("snap_old", {
      activeSnapshotId: "snap_old",
      Snapshot,
    }),
    false,
  );
  assert.equal(deleted, false);
  assert.equal(
    await deleteScannerSnapshot("snap_old", {
      activeSnapshotId: "snap_new",
      Snapshot,
    }),
    true,
  );
  assert.equal(deleted, true);
  assert.equal(
    await deleteScannerSnapshot("snap_old", {
      activeSnapshotId: "snap_new",
      Snapshot: {
        async get() {
          throw Error("secret");
        },
      },
    }),
    false,
  );
});
