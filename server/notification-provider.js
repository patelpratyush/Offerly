// Outbound email abstraction (TASK 02 P1). Disabled by default: no transport,
// credential or network code exists in this repository. A deployment must
// explicitly supply an enabled adapter with its own vetted transport function.
const disabled = Object.freeze({
  name: "disabled",
  enabled: false,
  async send() {
    throw Object.assign(new Error("Email delivery is disabled"), {
      permanent: true,
    });
  },
});
export function createDisabledEmailProvider() {
  return disabled;
}
/**
 * transport({to, subject, text, idempotencyKey}) must be idempotent on
 * idempotencyKey. Throw an error with permanent=true to stop retries.
 */
export function createEmailProvider({ enabled = false, transport } = {}) {
  if (enabled !== true || typeof transport !== "function") return disabled;
  return Object.freeze({
    name: "configured",
    enabled: true,
    send: (message) => transport(message),
  });
}
