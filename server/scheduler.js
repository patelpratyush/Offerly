import { processGmailSync } from "./gmail-sync.js";
import { randomUUID } from "node:crypto";
import { processRecruitingJobs } from "./recruiting.js";
import { processReminders } from "./reminders.js";
import { processDeliveries } from "./reminder-rules.js";

// Persistent lease and cursors survive cold starts and separate Vercel instances.
// Lease exceeds the hosted function's 90-second maximum lifetime.
export async function runScheduler(
  store,
  {
    now = Date.now(),
    signedAt = 0,
    recruiting = processRecruitingJobs,
    gmail = processGmailSync,
    reminders = processReminders,
    deliveries = processDeliveries,
    notificationProvider,
    cleanup,
  } = {},
) {
  const owner = randomUUID();
  const state = await store.db
    .prepare(
      "UPDATE scheduler_state SET lease_owner=?,lease_until=?,started_at=?,status='running',last_signed_at=CASE WHEN ?>last_signed_at THEN ? ELSE last_signed_at END WHERE id=1 AND lease_until<=? AND (CAST(? AS BIGINT)=0 OR last_signed_at<?) RETURNING recruiting_cursor,reminder_cursor",
    )
    .get(owner, now + 120000, now, signedAt, signedAt, now, signedAt, signedAt);
  if (!state) return { skipped: true, reason: "already_running_or_replayed" };
  const deadline = Date.now() + 35000;
  try {
    const gmailResult = await gmail(store, { deadline: Date.now() + 10000 });
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
    // Delivery dispatch is best effort and reported only in logs; it must not
    // alter queue progress. Email stays disabled unless a provider is injected.
    await deliveries(store, {
      deadline: deadline + 3000,
      provider: notificationProvider,
    }).catch(() =>
      console.error(JSON.stringify({ event: "reminder_delivery_failed" })),
    );
    const cleanupResult = cleanup
      ? await cleanup(store, { deadline: deadline + 5000 })
      : undefined;
    const result = {
      gmail: gmailResult,
      recruiting: reviewResult,
      reminders: reminderResult,
      ...(cleanupResult ? { cleanup: cleanupResult } : {}),
    };
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
