// What this phone keeps: its device id and, when the person asked to be remembered, the device token the server gave
// (company-login-remember-v1, 30 days). Never a password, never the share's credentials. This device only
// (…ThisDeviceOnly): not in backups, not moved to another phone.
import Foundation
import Security

enum Keychain {
    private static let service = "tdh.mobile"

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String) {
        delete(key)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecValueData as String: Data(value.utf8),
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
    }

    /// One id per install of the app on this phone (the server ties a remembered sign-in to it).
    static var deviceId: String {
        if let d = get("device.id"), !d.isEmpty { return d }
        let d = "ios-" + UUID().uuidString.lowercased()
        set("device.id", d)
        return d
    }
}
