import AppKit
import Carbon.HIToolbox
import Foundation
import ZManagerGenerated

struct NativeHostEventEncoder {
    static func encode(
        kind: NativeInboundEventKind,
        payload: [String: Any],
        idempotencyKey: String? = nil,
        eventID: String = UUID().uuidString,
        timestampUnixMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1_000)
    ) throws -> Data {
        var event: [String: Any] = [
            "version": nativeInboundEventVersion,
            "eventId": eventID,
            "kind": kind.rawValue,
            "timestampUnixMs": timestampUnixMs,
            "payload": payload,
        ]
        if let idempotencyKey { event["idempotencyKey"] = idempotencyKey }
        return try JSONSerialization.data(withJSONObject: event)
    }

    static func hostedAuthPayload(from url: URL) -> [String: Any]? {
        let scheme = url.scheme?.lowercased()
        let isCurrentCallback = scheme == "tzap" && url.host?.lowercased() == "auth" && url.path == "/callback"
        let isLegacyCallback = scheme == "zmanager" && url.host?.lowercased() == "auth-callback" && url.path.isEmpty
        guard isCurrentCallback || isLegacyCallback,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        var values = [String: String]()
        for item in components.queryItems ?? [] {
            guard let value = item.value, values[item.name] == nil else { return nil }
            values[item.name] = value
        }
        let forbidden = ["code", "token", "access_token", "authorization_code", "password", "relay_body", "session_token", "refresh_token", "id_token"]
        guard forbidden.allSatisfy({ values[$0] == nil }),
              let state = values["state"], (16 ... 256).contains(state.count),
              state.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }),
              let result = values["result"], ["completed", "cancelled", "failed"].contains(result)
        else { return nil }
        if result == "completed" {
            guard let handoffCode = values["handoff_code"], (16 ... 2048).contains(handoffCode.count),
                  handoffCode.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-" || $0 == "~" })
            else { return nil }
        }
        var payload: [String: Any] = ["state": state, "result": result]
        if result == "completed", let handoffCode = values["handoff_code"] {
            payload["handoffCode"] = handoffCode
        }
        var sanitized = URLComponents()
        sanitized.scheme = scheme
        sanitized.host = url.host
        sanitized.path = url.path
        let fallbackScheme = scheme ?? "tzap"
        let fallbackHost = url.host ?? "auth"
        payload["callbackUrl"] = sanitized.string ?? "\(fallbackScheme)://\(fallbackHost)\(url.path)"
        if let errorCode = values["error_code"], errorCode.count <= 128 {
            payload["errorCode"] = errorCode
        }
        return payload
    }

    static func shellActionToken(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "zmanager",
              url.host?.lowercased() == "shell-request"
        else { return nil }
        let token = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard (22 ... 128).contains(token.count),
              token.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
        else { return nil }
        return token
    }
}

@MainActor
final class NativeHostLifecycle: NSObject {
    typealias Delivery = (Data) -> Void

    private let deliver: Delivery
    private var started = false

    init(deliver: @escaping Delivery) {
        self.deliver = deliver
    }

    func start() {
        guard !started else { return }
        started = true
        let manager = NSAppleEventManager.shared()
        manager.setEventHandler(
            self,
            andSelector: #selector(handleURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
        manager.setEventHandler(
            self,
            andSelector: #selector(handleOpenDocuments(_:withReplyEvent:)),
            forEventClass: AEEventClass(kCoreEventClass),
            andEventID: AEEventID(kAEOpenDocuments)
        )
        manager.setEventHandler(
            self,
            andSelector: #selector(handleReopen(_:withReplyEvent:)),
            forEventClass: AEEventClass(kCoreEventClass),
            andEventID: AEEventID(kAEReopenApplication)
        )
        NSApplication.shared.servicesProvider = self
    }

    func stop() {
        guard started else { return }
        started = false
        let manager = NSAppleEventManager.shared()
        manager.removeEventHandler(
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
        manager.removeEventHandler(
            forEventClass: AEEventClass(kCoreEventClass),
            andEventID: AEEventID(kAEOpenDocuments)
        )
        manager.removeEventHandler(
            forEventClass: AEEventClass(kCoreEventClass),
            andEventID: AEEventID(kAEReopenApplication)
        )
        if NSApplication.shared.servicesProvider as AnyObject? === self {
            NSApplication.shared.servicesProvider = nil
        }
    }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, withReplyEvent _: NSAppleEventDescriptor) {
        guard let value = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: value)
        else { return }
        if let token = NativeHostEventEncoder.shellActionToken(from: url) {
            emit(kind: .shellActionRequest, payload: ["requestToken": token], idempotencyKey: token)
        } else if let payload = NativeHostEventEncoder.hostedAuthPayload(from: url) {
            emit(kind: .hostedAuthCallback, payload: payload, idempotencyKey: payload["state"] as? String)
        }
    }

    @objc private func handleOpenDocuments(
        _ event: NSAppleEventDescriptor,
        withReplyEvent _: NSAppleEventDescriptor
    ) {
        guard let descriptor = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject)) else { return }
        var paths: [String] = []
        if descriptor.numberOfItems > 0 {
            for index in 1 ... descriptor.numberOfItems {
                if let value = descriptor.atIndex(index)?.stringValue { paths.append(value) }
            }
        } else if let value = descriptor.stringValue {
            paths.append(value)
        }
        emitOpenPaths(paths)
    }

    @objc private func handleReopen(_: NSAppleEventDescriptor, withReplyEvent _: NSAppleEventDescriptor) {
        emit(kind: .reopenApplication, payload: [:])
    }

    @objc func performZManagerService(
        _ pasteboard: NSPasteboard,
        userData: String?,
        error: AutoreleasingUnsafeMutablePointer<NSString?>
    ) {
        let paths = pasteboard.readObjects(forClasses: [NSURL.self], options: [
            .urlReadingFileURLsOnly: true,
        ])?.compactMap { ($0 as? URL)?.path } ?? []
        guard !paths.isEmpty else {
            error.pointee = "ZManager received no local file paths."
            return
        }
        let action = (userData ?? "open").trimmingCharacters(in: .whitespacesAndNewlines)
        guard ShellActionID(rawValue: action) != nil else {
            error.pointee = "ZManager received an unknown action."
            return
        }
        emit(kind: .shellActionRequest, payload: ["request": ["kind": action, "paths": paths]])
    }

    func emitOpenPaths(_ paths: [String]) {
        let local = Array(paths.prefix(1_024)).filter {
            !$0.isEmpty && $0.utf8.count <= 4_096 && !$0.contains("\0") && !$0.contains("://")
        }
        guard !local.isEmpty else { return }
        emit(kind: .openPaths, payload: ["paths": local])
    }

    func emit(
        kind: NativeInboundEventKind,
        payload: [String: Any],
        idempotencyKey: String? = nil
    ) {
        guard let data = try? NativeHostEventEncoder.encode(
            kind: kind,
            payload: payload,
            idempotencyKey: idempotencyKey
        ), data.count <= MacOSFFILimits.maxRequestBytes else { return }
        deliver(data)
    }
}
