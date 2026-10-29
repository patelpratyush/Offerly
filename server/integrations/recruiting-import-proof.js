// Local Phase 0 feasibility proof only. Never persist or print these records.
import { z } from "zod";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { boundedJson } from "./gmail-local.js";

export const RECRUITING_QUERY =
  "newer_than:7d {subject:application subject:interview subject:assessment subject:rejection subject:offer}";
const eventSchema = z
  .object({
    type: z.enum([
      "confirmation",
      "assessment",
      "interview-invitation",
      "rejection",
      "offer",
    ]),
    evidence: z.string().min(1).max(500),
  })
  .strict();
const candidateSchema = z
  .object({
    sourceMessageId: z.string().regex(/^[a-fA-F0-9]+$/),
    applicationId: z.null(),
    reviewRequired: z.literal(true),
    events: z.array(eventSchema).min(1),
  })
  .strict();
const rules = [
  [
    "confirmation",
    /\b(?:thank(?:s| you) for (?:applying|your application)|we (?:have )?received your application|your application (?:has been|was) (?:received|submitted))\b/i,
  ],
  [
    "assessment",
    /\b(?:complete|take|invite you to|invited you to)\b.{0,80}\b(?:assessment|coding (?:challenge|test))\b/i,
  ],
  [
    "interview-invitation",
    /\b(?:invite you to|inviting you to|schedule your|scheduled your|confirm your|confirming your)\b.{0,90}\binterview\b/i,
  ],
  [
    "rejection",
    /\b(?:not (?:be )?(?:moving|proceeding) forward|your (?:application|candidacy).{0,90}(?:unsuccessful|not selected))\b/i,
  ],
  [
    "offer",
    /\b(?:pleased|delighted|excited) to (?:extend|offer)\b.{0,100}\b(?:offer|position|role|employment)\b/i,
  ],
];

export function currentPlainText(payload) {
  const parts = [payload],
    text = [];
  let visited = 0,
    bytes = 0;
  while (parts.length) {
    const part = parts.pop();
    if (!part || typeof part !== "object" || ++visited > 10000)
      throw new Error("invalid_message_shape");
    if (
      part.filename ||
      part.body?.attachmentId ||
      part.mimeType === "message/rfc822"
    )
      continue;
    if (part.mimeType === "text/plain" && typeof part.body?.data === "string") {
      if (!/^[A-Za-z0-9_-]*={0,2}$/.test(part.body.data))
        throw new Error("invalid_message_encoding");
      const buffer = Buffer.from(part.body.data, "base64url");
      bytes += buffer.length;
      if (bytes > 65536) {
        buffer.fill(0);
        return "";
      }
      text.push(buffer.toString("utf8"));
      buffer.fill(0);
    }
    if (Array.isArray(part.parts)) parts.push(...part.parts.slice().reverse());
  }
  // Strip common reply/forward markers. Other quoting conventions remain unvalidated.
  const current = [];
  for (const line of text.join("\n").split(/\r?\n/)) {
    if (
      /^\s*(?:From:|Sent:)/i.test(line) ||
      /^\s*(?:On .{1,300}wrote:|[- ]*Forwarded message[- ]*|[- ]*Original Message[- ]*)\s*$/i.test(
        line,
      )
    )
      break;
    if (/^\s*>/.test(line)) continue;
    current.push(line);
  }
  return current.join("\n");
}

export function extractCandidate(message) {
  if (!message || !/^[a-fA-F0-9]+$/.test(message.id))
    throw new Error("invalid_message_id");
  const headers = message.payload?.headers || [];
  const subjects = headers.filter(
    (h) => typeof h?.name === "string" && h.name.toLowerCase() === "subject",
  );
  const subject =
    subjects.length === 1 && typeof subjects[0].value === "string"
      ? subjects[0].value.slice(0, 1000)
      : "";
  if (
    /\b(?:newsletter|job alerts?|recommended jobs?|jobs? for you|weekly (?:jobs?|digest))\b/i.test(
      subject,
    )
  )
    return null;
  const text = currentPlainText(message.payload);
  const events = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const [type, pattern] of rules) {
    const evidence = lines.find(
      (line) => line.length <= 500 && pattern.test(line),
    );
    if (evidence) events.push({ type, evidence });
  }
  if (!events.length) return null;
  const candidate = candidateSchema.parse({
    sourceMessageId: message.id,
    applicationId: null,
    reviewRequired: true,
    events,
  });
  if (candidate.events.some((event) => !text.includes(event.evidence)))
    throw new Error("ungrounded_evidence");
  return candidate;
}

export function createImportProof() {
  const seen = new Set(),
    records = new Map();
  const outcomeHash = createHash("sha256");
  const counts = {
    scanned: 0,
    candidates: 0,
    candidateEvents: 0,
    unresolvedReviewItems: 0,
    abstentions: 0,
    replayDuplicates: 0,
  };
  return {
    import(message) {
      if (!message || !/^[a-fA-F0-9]+$/.test(message.id))
        throw new Error("invalid_message_id");
      if (seen.has(message.id)) {
        counts.replayDuplicates++;
        return false;
      }
      const candidate = extractCandidate(message);
      seen.add(message.id);
      counts.scanned++;
      outcomeHash.update(JSON.stringify({ id: message.id, candidate })).update("\0");
      if (!candidate) {
        counts.abstentions++;
        return false;
      }
      records.set(message.id, candidate);
      counts.candidates++;
      counts.candidateEvents += candidate.events.length;
      counts.unresolvedReviewItems++;
      return true;
    },
    snapshot: () => ({ ...counts }),
    fingerprint: () => outcomeHash.copy().digest("hex"),
    clear() {
      seen.clear();
      records.clear();
    },
  };
}

// Compare two isolated passes over the same fetched messages. Also exercise
// duplicate delivery inside each pass; aggregate snapshots never expose IDs.
export function verifyImportReplay(messages, createProof = createImportProof) {
  const first = createProof();
  const second = createProof();
  try {
    for (const message of messages) {
      first.import(message);
      const before = first.snapshot();
      const fingerprintBefore = first.fingerprint();
      const importedAgain = first.import(message);
      const after = first.snapshot();
      if (
        importedAgain !== false ||
        after.candidates !== before.candidates ||
        after.candidateEvents !== before.candidateEvents ||
        after.abstentions !== before.abstentions ||
        first.fingerprint() !== fingerprintBefore
      )
        throw new Error("replay_created_duplicate");
      second.import(message);
    }
    const a = first.snapshot();
    const b = second.snapshot();
    if (
      a.candidates !== b.candidates ||
      a.candidateEvents !== b.candidateEvents ||
      a.abstentions !== b.abstentions ||
      first.fingerprint() !== second.fingerprint()
    )
      throw new Error("cross_run_replay_mismatch");
    return {
      counts: a,
      replayCreatesZeroNewCandidates: a.replayDuplicates === a.scanned,
      crossRunReplayMatches: true,
    };
  } finally {
    first.clear();
    second.clear();
  }
}

export async function readRecruitingProof({
  getAccessToken,
  signal,
  fetchImpl,
  sleep = delay,
  now = Date.now,
  onMessage,
}) {
  let last = -Infinity;
  const beforeRequest = async () => {
    const wait = Math.max(0, last + 1000 - now());
    if (wait) await sleep(wait, undefined, { signal });
    if (signal?.aborted) throw new Error("cancelled");
    last = now();
  };
  const request = (url, cap) =>
    boundedJson(url, {
      getAccessToken,
      signal,
      fetchImpl,
      beforeRequest,
      sleep,
      ...(cap ? { cap } : {}),
    });
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("q", RECRUITING_QUERY);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("includeSpamTrash", "true");
  const page = await request(url, 1024 * 1024);
  if (page.messages !== undefined && !Array.isArray(page.messages))
    throw new Error("invalid_list_shape");
  if ((page.messages || []).length > 20)
    throw new Error("message_limit_exceeded");
  const ids = new Set();
  for (const entry of page.messages || []) {
    if (!entry || !/^[a-fA-F0-9]+$/.test(entry.id) || ids.has(entry.id))
      throw new Error("invalid_list_id");
    ids.add(entry.id);
    const messageUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${entry.id}`,
    );
    messageUrl.searchParams.set("format", "full");
    messageUrl.searchParams.set(
      "fields",
      "payload(mimeType,filename,headers,body(data,attachmentId),parts)",
    );
    const message = await request(messageUrl);
    await onMessage({ id: entry.id, payload: message.payload });
  }
  return {
    selectedMessages: ids.size,
    selectionLimit: 20,
    moreMatchingMessages: Boolean(page.nextPageToken),
    fullMailboxScanned: false,
  };
}
