import { createHash } from "node:crypto";
export const normText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const normRequisition = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function canonicalDomain(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  try {
    const host = new URL(/^[a-z]+:\/\//.test(text) ? text : "https://" + text)
      .hostname;
    const domain = host.replace(/^www\./, "").replace(/\.$/, "");
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      domain,
    )
      ? domain
      : "";
  } catch {
    return "";
  }
}
/** Compare URLs ignoring scheme, www, query, fragment and trailing slash. */
export function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return "";
    return (
      url.hostname.toLowerCase().replace(/^www\./, "") +
      url.pathname.replace(/\/+$/, "").toLowerCase()
    );
  } catch {
    return "";
  }
}
export function contentHash(listing) {
  const c = listing.compensation || {};
  return createHash("sha256")
    .update(
      JSON.stringify([
        listing.title,
        listing.location,
        listing.requisition,
        listing.url,
        listing.description,
        listing.workArrangement,
        listing.employmentType,
        listing.postedAt,
        c.min,
        c.max,
        c.currency,
        c.period,
        c.basis,
      ]),
    )
    .digest("hex");
}
export function groupKey(company, listing) {
  const req = normRequisition(listing.requisition);
  return req
    ? `${company}:req:${req}`
    : `${company}:tl:${normText(listing.title)}|${normText(listing.location)}`;
}
