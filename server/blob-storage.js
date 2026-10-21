import * as blobSdk from "@vercel/blob";
import { createHash } from "node:crypto";
import { HttpError } from "./security.js";

const MAX_BYTES = 2 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY = new RegExp(`^documents/${UUID}/${UUID}$`);
const unavailable = () => new HttpError(503, "Document storage unavailable. Please try again.");
function validateKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw unavailable();
}

// Bound both SDK requests and body consumption; never expose provider errors or URLs.
async function bounded(operation) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(unavailable());
        }, 15000);
      }),
    ]);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function createBlobStorage({ sdk = blobSdk, storeId = process.env.BLOB_STORE_ID } = {}) {
  const options = (abortSignal) => ({ ...(storeId ? { storeId } : {}), abortSignal });
  return {
    async put(key, body) {
      validateKey(key);
      if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BYTES) throw unavailable();
      return bounded(async (signal) => {
        const result = await sdk.put(key, body, {
          ...options(signal), access: "private", addRandomSuffix: false,
          allowOverwrite: false, contentType: "application/octet-stream",
        });
        if (result?.pathname !== key) throw unavailable();
        return key;
      });
    },
    async read(key, { size, hash } = {}) {
      validateKey(key);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES || !/^[0-9a-f]{64}$/.test(hash || "")) throw unavailable();
      return bounded(async (signal) => {
        const result = await sdk.get(key, { ...options(signal), access: "private", useCache: false });
        if (result === null) throw new HttpError(404, "Document not found");
        if (result?.statusCode !== 200 || result.blob?.pathname !== key || result.blob.size !== size || !result.stream?.getReader) {
          result?.stream?.cancel().catch(() => {});
          throw unavailable();
        }
        const reader = result.stream.getReader();
        const cancel = () => { reader.cancel().catch(() => {}); };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          const chunks = [];
          let length = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (signal.aborted) throw unavailable();
            if (done) break;
            if (!(value instanceof Uint8Array)) throw unavailable();
            length += value.byteLength;
            if (length > size || length > MAX_BYTES) throw unavailable();
            chunks.push(Buffer.from(value));
          }
          const body = Buffer.concat(chunks, length);
          if (length !== size || createHash("sha256").update(body).digest("hex") !== hash) throw unavailable();
          return body;
        } finally {
          signal.removeEventListener("abort", cancel);
          cancel();
          reader.releaseLock();
        }
      });
    },
    async delete(key) {
      validateKey(key);
      await bounded((signal) => sdk.del(key, options(signal)));
    },
  };
}
