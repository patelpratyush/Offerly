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
      !/^\/(today|applications(?:\/[^/]+)?|reviews|connections|documents|insights|settings)$/.test(
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
      (url.hash === "#workspace-content" ? url.hash : "")
    );
  } catch {
    return "/today";
  }
}
export const pagePaths: Record<string, string> = {
  Today: "/today",
  Applications: "/applications",
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
