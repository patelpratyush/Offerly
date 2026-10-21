// Durable work runs in a separate process, outside interactive API requests.
import { resolve } from "node:path";
import { createStore } from "./store.js";
import { processRecruitingJobs } from "./recruiting.js";
import { processReminders } from "./reminders.js";
process.umask(0o077);
const store = await createStore(
  resolve(process.env.DATABASE_PATH || "data/offerly.sqlite"),
);
let stopping = false;
let active = null;
async function runTick() {
  for (const [kind, processWork] of [
    ["recruiting", processRecruitingJobs],
    ["reminders", processReminders],
  ]) {
    try {
      const result = await processWork(store, { now: new Date() });
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
function tick() {
  if (stopping || active) return;
  active = runTick().finally(() => {
    active = null;
  });
}
const timer = setInterval(tick, 1000);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await active;
  await store.db.close();
  if (process.connected) process.disconnect();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);
tick();
if (process.send) process.send({ type: "ready" });
