import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(
  new URL("../../scripts/gmail-keychain.swift", import.meta.url),
);
const directory = fileURLToPath(
  new URL("../../data/gmail-keychain", import.meta.url),
);
const allowedErrors = new Set([
  "keychain_access_denied",
  "keychain_operation_failed",
  "keychain_input_invalid",
  "keychain_response_invalid",
]);
function failure(code = "keychain_operation_failed") {
  return Object.assign(new Error(code), { code });
}
function run(executable, args, input, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: process.env.HOME || "",
      },
    });
    let output = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(failure());
    }, timeout);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        child.kill();
        reject(failure("keychain_response_invalid"));
      } else output += chunk.toString("utf8");
    });
    child.stderr.resume(); // Compiler and Security errors must never escape to logs.
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(failure());
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(failure());
      else resolve(output);
    });
    child.stdin.end(input);
  });
}
async function ensurePrivateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw failure();
  });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid()
  )
    throw failure();
  await chmod(path, 0o700);
}
let compilation;
async function helper() {
  if (process.platform !== "darwin") throw failure("keychain_unavailable");
  if (!compilation)
    compilation = (async () => {
      await ensurePrivateDirectory(
        fileURLToPath(new URL("../../data", import.meta.url)),
      );
      await ensurePrivateDirectory(directory);
      const hash = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      const executable = join(directory, `helper-${hash}`);
      try {
        const info = await lstat(executable);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.uid !== process.getuid() ||
          (info.mode & 0o777) !== 0o700
        )
          throw failure();
        return executable;
      } catch (error) {
        if (error.code !== "ENOENT") throw failure();
      }
      const temporary = `${executable}-${randomBytes(12).toString("hex")}`;
      try {
        await run("/usr/bin/swiftc", [source, "-o", temporary], "", 120000);
        await chmod(temporary, 0o700);
        await rename(temporary, executable);
      } finally {
        await rm(temporary, { force: true });
      }
      return executable;
    })().catch((error) => {
      compilation = undefined;
      throw error;
    });
  return compilation;
}
async function invoke(request) {
  const executable = await helper();
  return JSON.parse(await run(executable, [], JSON.stringify(request)));
}
// Injectable transport keeps tests independent of any user's real Keychain.
export function createKeychainStore(runHelper = invoke) {
  async function request(operation, clientId, token) {
    if (
      typeof clientId !== "string" ||
      clientId.length > 1024 ||
      !clientId.endsWith(".apps.googleusercontent.com")
    )
      throw failure("keychain_input_invalid");
    if (
      operation === "store" &&
      (typeof token !== "string" ||
        !token.length ||
        Buffer.byteLength(token) > 16384 ||
        [...token].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ))
    )
      throw failure("keychain_input_invalid");
    const account = createHash("sha256").update(clientId).digest("hex");
    let response;
    try {
      response = await runHelper({
        operation,
        account,
        ...(operation === "store" ? { token } : {}),
      });
    } catch {
      throw failure();
    }
    if (!response || response.ok !== true)
      throw failure(
        allowedErrors.has(response?.code)
          ? response.code
          : "keychain_operation_failed",
      );
    if (operation === "load") {
      if (response.token === null) return null;
      if (
        typeof response.token !== "string" ||
        !response.token.length ||
        Buffer.byteLength(response.token) > 16384 ||
        [...response.token].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw failure("keychain_response_invalid");
      return response.token;
    }
  }
  return {
    loadRefreshToken: (clientId) => request("load", clientId),
    saveRefreshToken: (clientId, token) => request("store", clientId, token),
    deleteRefreshToken: (clientId) => request("delete", clientId),
  };
}
export const { loadRefreshToken, saveRefreshToken, deleteRefreshToken } =
  createKeychainStore();
