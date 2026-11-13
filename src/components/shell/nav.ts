/** Shared shell vocabulary: page codes, station order and go-to keys. */
export const STATIONS = [
  "Today",
  "Applications",
  "Discover",
  "Companies",
  "Reviews",
  "Connections",
  "Documents",
  "Prepare",
  "Insights",
  "Settings",
] as const;

export const PAGE_CODES: Record<string, string> = {
  Today: "TDY",
  Applications: "APP",
  Discover: "DSC",
  Companies: "CMP",
  Reviews: "REV",
  Connections: "CON",
  Documents: "DOC",
  Prepare: "PRP",
  Insights: "INS",
  Settings: "SET",
};

/** `g` then one of these keys. */
export const GO_KEYS: Record<string, string> = {
  t: "Today",
  a: "Applications",
  f: "Discover",
  m: "Companies",
  r: "Reviews",
  c: "Connections",
  d: "Documents",
  p: "Prepare",
  i: "Insights",
  s: "Settings",
};

export const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const stationNumber = (page: string) => {
  const index = (STATIONS as readonly string[]).indexOf(page);
  return index < 0 ? "--" : String(index + 1).padStart(2, "0");
};
