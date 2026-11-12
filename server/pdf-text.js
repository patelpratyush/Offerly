import { inflateSync } from "node:zlib";
import { HttpError } from "./security.js";

// Dependency-free, text-only PDF support. Nothing in a PDF is ever executed:
// the writer emits fixed structure, and the reader only parses bytes with
// bounded loops. Reading supports simple text-based PDFs (single-byte fonts,
// unencrypted, no object streams); anything else is reported as unsupported.

// --- Writer -----------------------------------------------------------------
// Helvetica advance widths (1/1000 em) for ASCII 32..126.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const PAGE_W = 612,
  PAGE_H = 792,
  MARGIN = 54,
  SIZE = 11,
  LEADING = 14,
  MAX_PAGES = 120;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);
const MAX_WIDTH = (PAGE_W - 2 * MARGIN) * 1000;
const widthOf = (ch) => {
  const code = ch.charCodeAt(0);
  return (code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556) * SIZE;
};
// Keep Latin-1 (WinAnsi shares those code points); everything else becomes "?".
const clean = (text) =>
  [...String(text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ")]
    .map((ch) => {
      if (ch === "\n") return ch;
      const code = ch.codePointAt(0);
      return (code >= 32 && code <= 126) || (code >= 160 && code <= 255)
        ? ch
        : "?";
    })
    .join("");
function wrap(text) {
  const lines = [];
  for (const raw of clean(text).split("\n")) {
    let line = "",
      width = 0;
    const push = () => {
      lines.push(line.trimEnd());
      line = "";
      width = 0;
    };
    for (const word of raw.split(/( +)/)) {
      if (!word) continue;
      const w = [...word].reduce((n, c) => n + widthOf(c), 0);
      if (width + w <= MAX_WIDTH) {
        line += word;
        width += w;
        continue;
      }
      if (line.trim()) push();
      if (/^ +$/.test(word)) continue;
      for (const ch of word) {
        if (width + widthOf(ch) > MAX_WIDTH) push();
        line += ch;
        width += widthOf(ch);
      }
    }
    push();
  }
  return lines;
}
const escapePdf = (line) =>
  [...line]
    .map((ch) => {
      if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch;
      const code = ch.charCodeAt(0);
      return code > 126 ? "\\" + code.toString(8).padStart(3, "0") : ch;
    })
    .join("");

/** Valid single-font, text-only PDF carrying exactly the supplied text. */
export function buildPdf(text) {
  const lines = wrap(text);
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE)
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (!pages.length) pages.push([""]);
  if (pages.length > MAX_PAGES)
    throw new HttpError(
      400,
      `This text is too long for one PDF (limit ${MAX_PAGES} pages)`,
    );
  // Object numbers: 1 catalog, 2 pages, 3 font, then page/content pairs.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((pageLines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    const stream =
      `BT\n/F1 ${SIZE} Tf\n${LEADING} TL\n${MARGIN} ${PAGE_H - MARGIN - SIZE + LEADING} Td\n` +
      pageLines.map((l) => `(${escapePdf(l)}) '`).join("\n") +
      "\nET";
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  });
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, "latin1");
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

// --- Reader -----------------------------------------------------------------
const MAX_PDF = 5 * 1024 * 1024,
  MAX_OBJECTS = 5000,
  MAX_STREAM = 4 * 1024 * 1024,
  MAX_TOTAL = 8 * 1024 * 1024,
  MAX_READ_PAGES = 60,
  MAX_TEXT = 120000;
const unsupported = (reason) => ({ available: false, reason });
const decoder = (() => {
  try {
    return new TextDecoder("windows-1252");
  } catch {
    return new TextDecoder("latin1");
  }
})();

function readObjects(source) {
  const objects = new Map();
  const re = /(?:^|\s)(\d{1,7})\s+(\d{1,5})\s+obj\b/g;
  let m;
  while ((m = re.exec(source))) {
    if (objects.size >= MAX_OBJECTS) return null;
    const start = m.index + m[0].length;
    const end = source.indexOf("endobj", start);
    if (end < 0) break;
    objects.set(Number(m[1]), { start, end, source: source.slice(start, end) });
    re.lastIndex = end + 6;
  }
  return objects;
}
function streamOf(obj, body) {
  const s = obj.source;
  const marker = s.match(/stream\r?\n/);
  if (!marker) return null;
  const dict = s.slice(0, marker.index);
  const dataStart = obj.start + marker.index + marker[0].length;
  const dataEnd = body.indexOf("endstream", dataStart, "latin1");
  if (dataEnd < 0) return null;
  let data = body.subarray(dataStart, dataEnd);
  const filters = dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] || "";
  if (/Flate/.test(filters)) {
    if (/\/DecodeParms/.test(dict)) return { error: "predictor" };
    try {
      data = inflateSync(data, { maxOutputLength: MAX_STREAM });
    } catch {
      return { error: "inflate" };
    }
  } else if (filters.replace(/[\s[\]]/g, "")) {
    return { error: "filter" };
  }
  return { data };
}
const refs = (text) => [...text.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => +m[1]);

// Tokenizer for content streams. Only text-showing operators are interpreted;
// every other operator is ignored. Nothing here evaluates content.
function contentText(data, budget) {
  const s = data.toString("latin1");
  const out = [];
  let line = "",
    touched = false,
    operands = [],
    i = 0,
    guard = 0;
  const flushLine = () => {
    if (touched) out.push(line);
    line = "";
    touched = false;
  };
  const show = (item) => {
    if (typeof item !== "string") return;
    line += decoder.decode(Buffer.from(item, "latin1"));
    touched = true;
  };
  while (i < s.length && guard++ < 2_000_000 && out.length < budget) {
    const c = s[i];
    if (/\s/.test(c)) i++;
    else if (c === "%") i = s.indexOf("\n", i) + 1 || s.length;
    else if (c === "(") {
      let depth = 1,
        str = "";
      i++;
      while (i < s.length && depth) {
        const ch = s[i++];
        if (ch === "\\") {
          const n = s[i++];
          if (n !== undefined && /[0-7]/.test(n)) {
            let oct = n;
            while (oct.length < 3 && /[0-7]/.test(s[i] || "")) oct += s[i++];
            str += String.fromCharCode(parseInt(oct, 8) & 255);
          } else if (n === "n") str += "\n";
          else if (n === "r") str += "\r";
          else if (n === "t") str += "\t";
          else if (n === "b") str += "\b";
          else if (n === "f") str += "\f";
          else if (n === "\n" || n === "\r") {
            if (n === "\r" && s[i] === "\n") i++;
          } else str += n ?? "";
        } else if (ch === "(") {
          depth++;
          str += ch;
        } else if (ch === ")") {
          depth--;
          if (depth) str += ch;
        } else str += ch;
      }
      operands.push(str);
    } else if (c === "<" && s[i + 1] !== "<") {
      const end = s.indexOf(">", i);
      if (end < 0) break;
      const hex = s.slice(i + 1, end).replace(/\s/g, "");
      let str = "";
      for (let k = 0; k < hex.length; k += 2)
        str += String.fromCharCode(
          parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16) || 0,
        );
      operands.push(str);
      i = end + 1;
    } else if (c === "<" || c === ">") i += s[i + 1] === c ? 2 : 1;
    else if (c === "[") {
      operands.push("[");
      i++;
    } else if (c === "]") {
      const items = [];
      while (operands.length && operands.at(-1) !== "[")
        items.unshift(operands.pop());
      operands.pop();
      operands.push({ array: items });
      i++;
    } else if (c === "/") {
      i++;
      while (i < s.length && !/[\s/[\]()<>]/.test(s[i])) i++;
      operands.push(null);
    } else {
      let j = i;
      while (j < s.length && !/[\s/[\]()<>%]/.test(s[j])) j++;
      const tok = s.slice(i, j) || s[i];
      i = Math.max(j, i + 1);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) operands.push(Number(tok));
      else {
        const last = operands.at(-1);
        if (tok === "Tj") show(last);
        else if (tok === "'" || tok === '"') {
          flushLine();
          show(last);
        } else if (tok === "TJ" && last?.array) {
          for (const item of last.array)
            if (typeof item === "string") show(item);
            else if (typeof item === "number" && item < -200 && line)
              line += " ";
        } else if (tok === "T*" || tok === "Tm" || tok === "TD") flushLine();
        else if (tok === "Td") {
          if (last !== 0) flushLine();
        } else if (tok === "ET") flushLine();
        else if (tok === "BI") {
          const end = s.indexOf("EI", i);
          i = end < 0 ? s.length : end + 2;
        }
        operands = [];
      }
    }
  }
  flushLine();
  return out;
}

/**
 * Extracts text from a simple text-based PDF. Returns { available, text?, reason? }.
 * Unsupported: encrypted files, object streams, composite/CID or Type 3 fonts,
 * scanned images, and anything that does not yield readable text.
 */
export function pdfText(body) {
  const fail = unsupported(
    "Text could not be read safely from this PDF. Offerly reads only simple text-based PDFs (not scans, encrypted files or documents with embedded custom fonts). Paste the text instead.",
  );
  if (!Buffer.isBuffer(body) || body.length > MAX_PDF)
    return unsupported(
      "This PDF is too large for text extraction. Paste the text instead.",
    );
  const source = body.toString("latin1");
  if (
    /\/Encrypt\b|\/ObjStm\b/.test(source) ||
    /\/Subtype\s*\/(Type0|Type3|CIDFontType\d)\b|\/Identity-H\b/.test(source)
  )
    return fail;
  const objects = readObjects(source);
  if (!objects) return fail;
  // Page order from the page tree; fall back to page objects in file order.
  const pageIds = [];
  const walk = (id, depth) => {
    const obj = objects.get(id);
    if (!obj || depth > 12 || pageIds.length >= MAX_READ_PAGES) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(obj.source)) return void pageIds.push(id);
    const kids = obj.source.match(/\/Kids\s*\[([^\]]*)\]/)?.[1];
    if (kids) for (const k of refs(kids)) walk(k, depth + 1);
  };
  for (const [id, o] of objects)
    if (/\/Type\s*\/Pages\b/.test(o.source) && !/\/Parent\b/.test(o.source))
      walk(id, 0);
  if (!pageIds.length)
    for (const [id, o] of objects)
      if (
        /\/Type\s*\/Page\b(?!s)/.test(o.source) &&
        pageIds.length < MAX_READ_PAGES
      )
        pageIds.push(id);
  if (!pageIds.length) return fail;
  let total = 0;
  const pages = [];
  for (const id of pageIds) {
    const contents = objects
      .get(id)
      .source.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1];
    if (!contents) continue;
    const lines = [];
    for (const ref of refs(contents)) {
      const obj = objects.get(ref);
      const stream = obj && streamOf(obj, body);
      if (!stream || stream.error) return fail;
      total += stream.data.length;
      if (total > MAX_TOTAL) return fail;
      lines.push(...contentText(stream.data, 20000));
    }
    pages.push(lines);
  }
  const text = pages
    .map((lines) => lines.map((l) => l.replace(/\s+$/, "")).join("\n"))
    .join("\n\n")
    .replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  const readable = (text.match(/[\p{L}\p{N}\s.,;:'"()\-/&@+%]/gu) || []).length;
  if (text.length < 5 || readable / text.length < 0.9) return fail;
  return { available: true, text };
}
