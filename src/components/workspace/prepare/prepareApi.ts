import { api, apiResponse } from "../../../lib/api";
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
export { sensitiveCategories } from "../../../../shared/prepare-rules.js";

export async function prepApi<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return api<T>(path, method, body);
}
export async function prepBlob(path: string, body: unknown): Promise<Blob> {
  return (await apiResponse(path, "POST", body)).blob();
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
