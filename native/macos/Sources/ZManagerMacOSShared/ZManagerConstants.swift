import Foundation
import Security

public enum ZManagerConstants {
    public static let mainBundleIdentifier = "org.tzap-org.zmanager"
    public static let appGroupIdentifier: String = {
        if let configured = ProcessInfo.processInfo.environment["ZMANAGER_APP_GROUP_IDENTIFIER"] {
            return configured
        }
        if let task = SecTaskCreateFromSelf(kCFAllocatorDefault),
           let groups = SecTaskCopyValueForEntitlement(
               task,
               "com.apple.security.application-groups" as CFString,
               nil
           ) as? [String],
           let group = groups.first {
            return group
        }
        // Unit tests run outside the signed app and have no App Group entitlement.
        return "group.org.tzap-org.zmanager"
    }()
}
