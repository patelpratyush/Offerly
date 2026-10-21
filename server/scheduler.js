import { randomUUID } from "node:crypto";
import { processRecruitingJobs } from "./recruiting.js";
import { processReminders } from "./reminders.js";

// Persistent lease and cursors survive cold starts and separate Vercel instances.
// Lease exceeds the hosted function's 60-second maximum lifetime.
export async function runScheduler(
  store,
  {
    now = Date.now(),
    recruiting = processRecruitingJobs,
    reminders = processReminders,
  } = {},
) {
  const owner = randomUUID();
  const state = await store.db
    .prepare(
      "UPDATE scheduler_state SET lease_owner=?,lease_until=?,started_at=?,status='running' WHERE id=1 AND lease_until<=? RETURNING recruiting_cursor,reminder_cursor",
    )
    .get(owner, now + 90000, now, now);
  if (!state) return { skipped: true, reason: "already_running" };
  const deadline = Date.now() + 35000;
  try {
    const reviewResult = await recruiting(store, {
      cursor: state.recruiting_cursor,
      deadline: deadline - 17500,
    });
    // Commit progress between queues so a later failure cannot lose it.
    await store.db
      .prepare(
        "UPDATE scheduler_state SET recruiting_cursor=? WHERE id=1 AND lease_owner=?",
      )
      .run(reviewResult.nextCursor, owner);
    const reminderResult = await reminders(store, {
      cursor: state.reminder_cursor,
      deadline,
    });
    const result = { recruiting: reviewResult, reminders: reminderResult };
    await store.db
      .prepare(
        "UPDATE scheduler_state SET reminder_cursor=?,lease_owner='',lease_until=0,finished_at=?,status='completed',result=? WHERE id=1 AND lease_owner=?",
      )
      .run(
        reminderResult.nextCursor,
        Date.now(),
        JSON.stringify(result),
        owner,
      );
    return result;
  } catch (error) {
    await store.db
      .prepare(
        "UPDATE scheduler_state SET lease_owner='',lease_until=0,finished_at=?,status='failed',result='{}' WHERE id=1 AND lease_owner=?",
      )
      .run(Date.now(), owner);
    throw error;
  }
}
