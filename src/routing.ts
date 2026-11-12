/** Known in-page destinations; arbitrary fragments are never forwarded. */
export function routeAnchor(pathname: string, hash: string): string {
  if (hash === "#workspace-content") return "workspace-content";
  if (
    pathname === "/today" &&
    ["#today-actions", "#reply-ownership"].includes(hash)
  )
    return hash.slice(1);
  return "";
}
/** Only known workspace routes can become post-auth destinations. */
export function safeReturnTo(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return "/today";
  try {
    const url = new URL(value, "https://offerly.invalid");
    if (
      url.origin !== "https://offerly.invalid" ||
      !/^\/(today|applications(?:\/[^/]+)?|discover|companies|reviews|connections|documents|insights|settings)$/.test(
        url.pathname,
      )
    )
      return "/today";
    // Retain only workspace filters, never arbitrary OAuth or credential parameters.
    const clean = new URLSearchParams();
    for (const key of [
      "savedView",
      "stage",
      "priority",
      "owner",
      "view",
      "archived",
      "sort",
      "company",
      "source",
      "arrangement",
      "from",
      "to",
      "unknownDates",
    ]) {
      const field = url.searchParams.get(key);
      if (field && field.length <= 200) clean.set(key, field);
    }
    return (
      url.pathname +
      (clean.size ? "?" + clean : "") +
      (routeAnchor(url.pathname, url.hash) ? url.hash : "")
    );
  } catch {
    return "/today";
  }
}
export const pagePaths: Record<string, string> = {
  Today: "/today",
  Applications: "/applications",
  Discover: "/discover",
  Companies: "/companies",
  Reviews: "/reviews",
  Connections: "/connections",
  Documents: "/documents",
  Insights: "/insights",
  Settings: "/settings",
};
export function routePage(pathname: string): string | null {
  if (/^\/applications\/[^/]+$/.test(pathname)) return "Applications";
  return (
    Object.keys(pagePaths).find((name) => pagePaths[name] === pathname) || null
  );
}
