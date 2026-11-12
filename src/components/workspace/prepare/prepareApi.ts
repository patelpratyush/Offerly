export type Item = { id: string; version: number; [key: string]: any };

export const categoryLabels: Record<string, string> = {
  experience: "Experience summary",
  preference: "Work preference",
  eligibility: "Work eligibility",
  sponsorship: "Sponsorship",
  salary: "Salary",
  relocation: "Relocation",
  start_date: "Start date",
  other: "Other",
};
export const sensitiveCategories = [
  "eligibility",
  "sponsorship",
  "salary",
  "relocation",
  "start_date",
];

async function send(path: string, method: string, body?: unknown) {
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
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    if (res.status === 401 && data.code === "SESSION_REQUIRED")
      window.dispatchEvent(new Event("offerly:session-expired"));
    throw new Error(data.error || "Request failed");
  }
  return res;
}
export async function prepApi<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return (await send(path, method, body)).json();
}
export async function prepBlob(path: string, body: unknown): Promise<Blob> {
  return (await send(path, "POST", body)).blob();
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
export const newId = () => crypto.randomUUID();
export const appLabel = (a?: Item) =>
  a ? `${a.company} · ${a.title}` : "Unknown application";
export const roundLabel = (r: Item) =>
  `${r.title}${r.date ? " · " + r.date : ""} · ${r.status}`;
export const dateOnly = (value?: string) => (value ? value.slice(0, 10) : "");
