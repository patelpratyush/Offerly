// Durable work runs in a separate process, outside interactive API requests.
import { resolve } from "node:path";
import { createStore } from "./store.js";
import { processRecruitingJobs } from "./recruiting.js";
import { processReminders } from "./reminders.js";

process.umask(0o077);
const store = createStore(
  resolve(process.env.DATABASE_PATH || "data/offerly.sqlite"),
);
let stopping = false;
function tick() {
  if (stopping) return;
  for (const [kind, processWork] of [
    ["recruiting", processRecruitingJobs],
    ["reminders", processReminders],
  ]) {
    try {
      const result = processWork(store, { now: new Date() });
      if (result.failed)
        console.error(
          JSON.stringify({
            event: "worker_items_failed",
            kind,
            count: result.failed,
          }),
        );
    } catch {
      // Never log source excerpts, email addresses, SQL, or user-provided values.
      console.error(JSON.stringify({ event: "worker_tick_failed", kind }));
    }
  }
}
const timer = setInterval(tick, 1000);
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  store.db.close();
  if (process.connected) process.disconnect();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);
tick();

if (process.send) process.send({ type: "ready" });
