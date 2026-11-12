// Small fetch wrapper for discovery endpoints. Kept separate from main.tsx so
// discovery components stay self-contained.
export type Size = {
  category: string;
  ambiguous: boolean;
  label: string;
  entity: string;
  entityName: string;
  estimate: string;
  asOf: string;
  sourceUrl: string;
};
export type Component = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  evidence: string[];
  gaps: string[];
  unknowns: string[];
};
export type Job = {
  id: string;
  title: string;
  company: { id: string; name: string; domain: string; size: Size };
  location: string;
  workArrangement: string;
  employmentType: string;
  compensation: {
    min: number | null;
    max: number | null;
    currency: string;
    period: string;
    basis: string;
    stated: boolean;
  };
  excerpt: string;
  status: "listed" | "not_listed";
  verification: "verified" | "could_not_verify" | "not_listed";
  freshness: {
    employerPostedAt: string | null;
    postedPrecision: string;
    postedLabel: string;
    postedTimezone: string;
    firstDiscoveredAt: string;
    lastCheckedAt: string;
    lastChangedAt: string;
    reopenedCount: number;
  };
  sources: {
    platform: string;
    url: string;
    status: string;
    verification: string;
    lastCheckedAt: string;
  }[];
  eligibility: {
    status: "meets" | "needs_verification" | "does_not_meet";
    note: string;
    checks: {
      check: string;
      status: string;
      evidence: string;
      detail: string;
    }[];
  };
  fit: {
    score: number | null;
    rubricVersion: string;
    components: Component[];
    disclaimer: string;
    coverage: number;
  } | null;
  applied: { applicationId: string; stage: string; matchedBy: string } | null;
  saved: boolean;
  dismissed: boolean;
  watched: boolean;
};
export async function discoveryApi<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/discovery" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
    body:
      body === undefined
        ? ["GET", "HEAD"].includes(method)
          ? undefined
          : "{}"
        : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "Request failed" }));
  if (!res.ok) {
    if (res.status === 401 && data.code === "SESSION_REQUIRED")
      window.dispatchEvent(new Event("offerly:session-expired"));
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}
export const when = (value: string | null | undefined, dateOnly = false) => {
  if (!value) return "Unknown";
  const date = new Date(dateOnly ? value + "T00:00:00Z" : value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return dateOnly
    ? date.toLocaleDateString(undefined, {
        timeZone: "UTC",
        dateStyle: "medium",
      })
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};
