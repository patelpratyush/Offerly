// The one fetch wrapper for /api. Replies that arrive after the signed-in
// session changed are discarded so they never render another user's data.
import { safeReturnTo } from "../routing";

export const session = { generation: 0 };
export const sessionChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("offerly-session");
// Drops every private view: bumps the generation, returns to sign-in and tells other tabs.
export function resetSession(notifyOtherTabs = true) {
  const requested = safeReturnTo(
    window.location.pathname + window.location.search + window.location.hash,
  );
  window.history.replaceState(
    null,
    "",
    "/signin?returnTo=" + encodeURIComponent(requested),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
  session.generation++;
  window.dispatchEvent(new Event("offerly:session-reset"));
  if (notifyOtherTabs) sessionChannel?.postMessage("reset");
}
if (sessionChannel)
  sessionChannel.onmessage = (event) => {
    if (event.data === "reset") resetSession(false);
  };

export async function apiResponse(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const generation = session.generation;
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
    body:
      body === undefined
        ? ["GET", "HEAD"].includes(method)
          ? undefined
          : "{}"
        : JSON.stringify(body),
  });
  if (generation !== session.generation)
    throw new Error("Session changed. Request discarded.");
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    if (res.status === 401 && data.code === "SESSION_REQUIRED")
      window.dispatchEvent(new Event("offerly:session-expired"));
    throw new Error(data.error || "Request failed");
  }
  return res;
}

export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return (await apiResponse(path, method, body))
    .json()
    .catch(() => ({})) as Promise<T>;
}
