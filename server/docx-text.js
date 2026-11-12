import yauzl from "yauzl";
import { crc32 } from "node:zlib";
import { HttpError } from "./security.js";

// XML 1.0 forbids most control characters; drop them rather than corrupt the file.
const stripControls = (value) =>
  [...value]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
const escapeXml = (value) =>
  stripControls(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Deterministic, dependency-free DOCX writer: stored (uncompressed) ZIP entries
// holding plain paragraphs. It carries exactly the reviewed text and nothing else.
export function buildDocx(text) {
  const paragraphs = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join("");
  const files = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    ],
  ];
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name),
      data = Buffer.from(content),
      crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.concat([local, nameBytes, data]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    locals.push(header);
    offset += header.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const decode = (value) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

// Reads paragraph text from word/document.xml. Tables, images and formatting are
// ignored; callers must present the result as an editable extraction.
export function docxText(body) {
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(new HttpError(422, "Could not read text from this DOCX"));
    yauzl.fromBuffer(
      body,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return fail();
        zip.on("error", fail);
        zip.on("end", fail);
        zip.on("entry", (entry) => {
          if (entry.fileName !== "word/document.xml") return zip.readEntry();
          if (entry.uncompressedSize > 8 * 1024 * 1024) return fail();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return fail();
            const chunks = [];
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("error", fail);
            stream.on("end", () => {
              const xml = Buffer.concat(chunks).toString("utf8");
              const text = xml
                .replace(/<w:tab\s*\/>/g, "\t")
                .replace(/<w:br\s*\/>/g, "\n")
                .replace(/<\/w:p>/g, "\n")
                .replace(/<[^>]+>/g, "")
                .split("\n")
                .map((line) => decode(line).trimEnd())
                .join("\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
              zip.close();
              resolve(text);
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
