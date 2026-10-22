import Foundation
import Security
import LocalAuthentication

// Native login Keychain: unsigned command-line helpers cannot use Data Protection
// Keychain without signing entitlements. Default ACL trusts this helper only.
// Login Keychain lock protects access; no iCloud synchronization or file fallback.
// https://developer.apple.com/documentation/security/ksecattraccessible
// https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain
// https://developer.apple.com/documentation/localauthentication/lacontext/interactionnotallowed
// Secrets travel through anonymous pipes, never command-line arguments or files.
let service = "OfferlyPhase0GmailOAuth"
func reply(_ object: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
    }
    exit(0)
}
func fail(_ code: String) -> Never { reply(["ok": false, "code": code]) }
// Legacy Keychain UI suppression is process-local; do not alter user settings.
// https://developer.apple.com/documentation/security/keychains
guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { fail("keychain_access_denied") }
let input = FileHandle.standardInput.readData(ofLength: 65537)
guard input.count <= 65536,
      let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
      let operation = request["operation"] as? String,
      let account = request["account"] as? String,
      account.count == 64,
      account.allSatisfy({ "0123456789abcdef".contains($0) }) else { fail("keychain_input_invalid") }
let authentication = LAContext()
authentication.interactionNotAllowed = true
var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
    kSecAttrSynchronizable as String: false,
    kSecUseAuthenticationContext as String: authentication
]
func check(_ status: OSStatus) {
    if status == errSecInteractionNotAllowed || status == errSecAuthFailed || status == errSecUserCanceled {
        fail("keychain_access_denied")
    }
    if status != errSecSuccess { fail("keychain_operation_failed") }
}
switch operation {
case "load":
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { reply(["ok": true, "token": NSNull()]) }
    check(status)
    guard let data = result as? Data, data.count <= 16384,
          let token = String(data: data, encoding: .utf8), !token.isEmpty else { fail("keychain_response_invalid") }
    reply(["ok": true, "token": token])
case "store":
    guard let token = request["token"] as? String,
          !token.isEmpty, token.utf8.count <= 16384,
          !token.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { fail("keychain_input_invalid") }
    let values: [String: Any] = [kSecValueData as String: Data(token.utf8)]
    let updateStatus = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if updateStatus == errSecItemNotFound {
        query.merge(values) { _, new in new }
        check(SecItemAdd(query as CFDictionary, nil))
    } else { check(updateStatus) }
    reply(["ok": true])
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecItemNotFound { check(status) }
    reply(["ok": true])
default: fail("keychain_input_invalid")
}
