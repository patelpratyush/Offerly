import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError, digest } from "./security.js";
const MAX_FILE = 20 * 1024 * 1024,
  MAX_STORAGE = 100 * 1024 * 1024;
export async function validateDocument(name, body) {
  if (
    typeof name !== "string" ||
    !name.length ||
    name.length > 180 ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    name.includes("/") ||
    name.includes("\\")
  )
    throw new HttpError(400, "Invalid filename");
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_FILE)
    throw new HttpError(400, "File must be between 1 byte and 20 MB");
  if (name.toLowerCase().endsWith(".pdf")) {
    if (
      !/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(body.subarray(0, 8).toString()) ||
      !body.subarray(-1024).toString().includes("%%EOF")
    )
      throw new HttpError(400, "Invalid PDF document");
    return "application/pdf";
  }
  if (!name.toLowerCase().endsWith(".docx"))
    throw new HttpError(400, "Upload a PDF or DOCX document");
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      body,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: true },
      (error, zip) => {
        if (error) return reject(new HttpError(400, "Invalid DOCX archive"));
        let entries = 0,
          total = 0,
          done = false;
        const names = new Set();
        const fail = () => {
          if (done) return;
          done = true;
          zip.close();
          reject(new HttpError(400, "Invalid or unsupported DOCX archive"));
        };
        zip.on("error", fail);
        zip.on("entry", (entry) => {
          if (
            ++entries > 2000 ||
            entry.generalPurposeBitFlag & 1 ||
            entry.fileName.startsWith("/") ||
            entry.fileName.split("/").includes("..") ||
            names.has(entry.fileName) ||
            /vbaProject|word\/(embeddings|activeX)\//i.test(entry.fileName) ||
            !/^(?:[\w.\-[\] /]+)$/.test(entry.fileName)
          )
            return fail();
          names.add(entry.fileName);
          total += entry.uncompressedSize;
          if (
            total > 100 * 1024 * 1024 ||
            entry.uncompressedSize > 8 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(entry.compressedSize, 1) * 200
          )
            return fail();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return fail();
            let size = 0;
            const chunks = [];
            const inspect = [
              "[Content_Types].xml",
              "word/document.xml",
              "_rels/.rels",
            ].includes(entry.fileName);
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > 32 * 1024 * 1024) {
                stream.destroy();
                fail();
                return;
              }
              if (inspect) chunks.push(chunk);
            });
            stream.on("end", () => {
              if (done) return;
              if (size !== entry.uncompressedSize) return fail();
              if (inspect) {
                const xml = Buffer.concat(chunks).toString("utf8");
                if (
                  /<!DOCTYPE|<!ENTITY/i.test(xml) ||
                  XMLValidator.validate(xml) !== true
                )
                  return fail();
                try {
                  const parsed = new XMLParser({
                    ignoreAttributes: false,
                    processEntities: false,
                    removeNSPrefix: true,
                  }).parse(xml);
                  if (entry.fileName === "[Content_Types].xml") {
                    const overrides = [parsed.Types?.Override]
                      .flat()
                      .filter(Boolean);
                    if (
                      !overrides.some(
                        (o) =>
                          o["@_PartName"] === "/word/document.xml" &&
                          o["@_ContentType"] ===
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                      )
                    )
                      return fail();
                  }
                  if (
                    entry.fileName === "word/document.xml" &&
                    !Object.hasOwn(parsed, "document")
                  )
                    return fail();
                  if (entry.fileName === "_rels/.rels") {
                    const relations = [parsed.Relationships?.Relationship]
                      .flat()
                      .filter(Boolean);
                    if (
                      !relations.some(
                        (r) =>
                          r["@_Type"] ===
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" &&
                          r["@_Target"] === "word/document.xml" &&
                          r["@_TargetMode"] !== "External",
                      )
                    )
                      return fail();
                  }
                } catch {
                  return fail();
                }
              }
              zip.readEntry();
            });
          });
        });
        zip.on("end", () => {
          if (done) return;
          if (
            !["[Content_Types].xml", "word/document.xml", "_rels/.rels"].every(
              (n) => names.has(n),
            )
          )
            return fail();
          done = true;
          zip.close();
          resolve();
        });
        zip.readEntry();
      },
    );
  });
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
export function scanWithClamav(body, socketPath) {
  return new Promise((resolve, reject) => {
    let settled = false,
      reply = "";
    const socket = createConnection({ path: socketPath });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const unavailable = () =>
      finish(
        new HttpError(503, "Document scanner unavailable. Try again later."),
      );
    const deadline = setTimeout(unavailable, 15000);
    socket.on("error", unavailable);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      let offset = 0;
      const send = () => {
        while (offset < body.length) {
          const chunk = body.subarray(offset, offset + 65536);
          offset += chunk.length;
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          if (!socket.write(chunk)) {
            socket.once("drain", send);
            return;
          }
        }
        socket.write(Buffer.alloc(4));
      };
      send();
    });
    socket.on("data", (chunk) => {
      reply += chunk.toString();
      if (reply.length > 4096) return unavailable();
      if (reply.includes("\0")) {
        const response = reply.split("\0")[0];
        if (response === "stream: OK") finish();
        else if (response.endsWith(" FOUND"))
          finish(new HttpError(400, "Document failed malware screening"));
        else unavailable();
      }
    });
    socket.on("end", () => {
      if (!settled) unavailable();
    });
  });
}
export function mountFiles(app, store, config, limit) {
  const { db } = store;
  const scan =
    config.scanDocument ||
    ((body) => scanWithClamav(body, config.scannerSocket));
  const needsScan = config.production || !!config.scannerSocket;
  app.post("/api/files", async (req, res, next) => {
    try {
      await limit("upload:" + req.user.id, 5, 60000);
      if (config.production && !config.scannerSocket && !config.scanDocument)
        throw new HttpError(
          503,
          "Uploads unavailable until document scanning is configured",
        );
      const f = z
        .object({
          name: z.string().max(180),
          body: z
            .string()
            .max(27962028)
            .refine((v) => v.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(v)),
        })
        .parse(req.body);
      const b = Buffer.from(f.body, "base64");
      if (b.toString("base64") !== f.body)
        throw new HttpError(400, "Invalid file encoding");
      const mime = await validateDocument(f.name, b);
      if (needsScan) await scan(b);
      // Ownership, quota and session are rechecked after asynchronous inspection.
      const id = randomUUID();
      await store.atomic(async () => {
        if (
          !(await db
            .prepare(
              "SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>? AND last_seen>?",
            )
            .get(
              req.sessionHash,
              req.user.id,
              Date.now(),
              Date.now() - 1800000,
            ))
        )
          throw new HttpError(401, "Sign in again");
        const used = await db
          .prepare(
            "SELECT COALESCE(sum(length(body)),0) bytes,count(*) n FROM files WHERE user_id=?",
          )
          .get(req.user.id);
        if (used.bytes + b.length > MAX_STORAGE || used.n >= 100)
          throw new HttpError(
            413,
            "Document storage limit reached (100 MB / 100 files)",
          );
        await db
          .prepare(
            "INSERT INTO files(id,user_id,name,mime,hash,body,created_at,scanned_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            req.user.id,
            f.name,
            mime,
            digest(b),
            b,
            new Date().toISOString(),
            needsScan ? new Date().toISOString() : null,
          );
      });
      res.json({ id });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/files/:id", async (req, res, next) => {
    try {
      const f = await db
        .prepare("SELECT * FROM files WHERE id=? AND user_id=?")
        .get(req.params.id, req.user.id);
      if (!f) throw new HttpError(404, "File not found");
      if (config.production && !f.scanned_at)
        throw new HttpError(
          403,
          "This older document must be uploaded again for security screening",
        );
      res.set({
        "Content-Type": "application/octet-stream",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      });
      res.send(Buffer.from(f.body));
    } catch (e) {
      next(e);
    }
  });
}
