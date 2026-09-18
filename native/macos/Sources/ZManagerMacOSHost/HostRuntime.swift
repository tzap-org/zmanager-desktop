import ZManagerGenerated
import AppKit
import Foundation
import ZManagerMacOSShared

public typealias ZManagerHostCallback = @convention(c) (
    UnsafePointer<UInt8>?, Int, UnsafeMutableRawPointer?
) -> Void

private final class HostState: @unchecked Sendable {
    static let shared = HostState()
    let lock = NSLock()
    var callback: ZManagerHostCallback?
    var context: UnsafeMutableRawPointer?
    var running = false
    var lifecycle: NativeHostLifecycle?
}

private final class InstalledOperationSelfTestState: @unchecked Sendable {
    var payload: Data?
}

private func installedOperationSelfTestCallback(
    bytes: UnsafePointer<UInt8>?,
    count: Int,
    context: UnsafeMutableRawPointer?
) {
    guard let context, let bytes else { return }
    let state = Unmanaged<InstalledOperationSelfTestState>.fromOpaque(context)
        .takeUnretainedValue()
    state.payload = Data(bytes: bytes, count: count)
}

private struct InstalledLinkageSelfTestResult {
    let appGroup: Bool
    let filePromise: Bool
    let icon: Bool
    let defaultHandler: Bool
    let service: Bool
}

private final class StartDelivery: @unchecked Sendable {
    let callback: ZManagerHostCallback
    let context: UnsafeMutableRawPointer?
    init(callback: @escaping ZManagerHostCallback, context: UnsafeMutableRawPointer?) {
        self.callback = callback
        self.context = context
    }
    func emit(_ payload: Data) {
        payload.withUnsafeBytes { bytes in
            callback(bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, context)
        }
    }

    @MainActor func start() {
        let lifecycle = NativeHostLifecycle(deliver: emit)
        HostState.shared.lock.lock()
        HostState.shared.lifecycle = lifecycle
        HostState.shared.lock.unlock()
        lifecycle.start()
        let appGroupAvailable = (try? AppGroupRequestInbox.applicationGroup()) != nil
        let selfTest = ProcessInfo.processInfo.environment["ZMANAGER_MACOS_LINKAGE_SELF_TEST"] == "1"
            ? runInstalledLinkageSelfTest() : nil
        var object: [String: Any] = [
            "kind": "hostStarted",
            "mainThread": Thread.isMainThread,
            "appGroupAvailable": appGroupAvailable,
        ]
        if let selfTest {
            object["appGroupSelfTest"] = selfTest.appGroup
            object["filePromiseSelfTest"] = selfTest.filePromise
            object["iconSelfTest"] = selfTest.icon
            object["defaultHandlerSelfTest"] = selfTest.defaultHandler
            object["serviceSelfTest"] = selfTest.service
        }
        if let payload = try? JSONSerialization.data(withJSONObject: object) { emit(payload) }
    }
}

@_cdecl("zmanager_macos_host_start")
public func zmanagerMacOSHostStart(
    _ callback: ZManagerHostCallback?,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard let callback else { return MacOSFFIErrorMapping.invalidPayload }
    let state = HostState.shared
    state.lock.lock()
    guard !state.running else {
        state.lock.unlock()
        return MacOSFFIErrorMapping.systemError
    }
    state.callback = callback
    state.context = context
    state.running = true
    state.lock.unlock()

    let delivery = StartDelivery(callback: callback, context: context)
    if Thread.isMainThread { MainActor.assumeIsolated { delivery.start() } }
    else { DispatchQueue.main.async { delivery.start() } }
    return 0
}

@MainActor
private func runInstalledLinkageSelfTest() -> InstalledLinkageSelfTestResult {
    let root = FileManager.default.temporaryDirectory.appending(path: "zmanager-installed-linkage-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    var appGroup = false
    do {
        let inbox = AppGroupRequestInbox(directory: root.appending(path: "inbox"))
        let token = "abcdefghijklmnopqrstuv"
        let request = Data("{\"version\":1}".utf8)
        try inbox.writeFromExtension(data: request, token: token)
        appGroup = try inbox.consumeFromHost(token: token) == request
    } catch {}

    final class State: @unchecked Sendable { var started = false }
    let state = State()
    let destination = root.appending(path: "promise")
    var filePromise = false
    do {
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        let writer = FilePromiseStreamWriter(promisedName: "entry.txt") { url in
            state.started = true
            try Data("streamed".utf8).write(to: url)
        }
        let provider = NSFilePromiseProvider(fileType: "public.data", delegate: writer)
        let deferred = !state.started
        var error: Error?
        writer.filePromiseProvider(provider, writePromiseTo: destination) { error = $0 }
        filePromise = deferred && state.started && error == nil
    } catch {}
    let icon = runInstalledIconSelfTest(root: root)
    let defaultHandler = runInstalledDefaultHandlerSelfTest()
    let service = runInstalledServiceSelfTest(root: root)
    return InstalledLinkageSelfTestResult(
        appGroup: appGroup,
        filePromise: filePromise,
        icon: icon,
        defaultHandler: defaultHandler,
        service: service
    )
}

@MainActor
private func runInstalledIconSelfTest(root: URL) -> Bool {
    let input = try? JSONSerialization.data(withJSONObject: [[
        "key": "installed-folder", "path": root.path, "isDirectory": true,
    ]])
    guard let input else { return false }
    let state = InstalledOperationSelfTestState()
    let status = input.withUnsafeBytes { bytes in
        zmanagerMacOSSystemFileIcons(
            bytes.bindMemory(to: UInt8.self).baseAddress,
            bytes.count,
            installedOperationSelfTestCallback,
            Unmanaged.passUnretained(state).toOpaque()
        )
    }
    guard status == 0, let payload = state.payload,
          let rows = try? JSONSerialization.jsonObject(with: payload) as? [[String: Any]]
    else { return false }
    return rows.first?["key"] as? String == "installed-folder"
        && (rows.first?["dataUrl"] as? String)?.hasPrefix("data:image/png;base64,") == true
}

@MainActor
private func runInstalledDefaultHandlerSelfTest() -> Bool {
    let input = try? JSONSerialization.data(withJSONObject: [
        "action": "status",
        "extensions": ["zip"],
        "bundleId": ZManagerConstants.mainBundleIdentifier,
    ])
    guard let input else { return false }
    let state = InstalledOperationSelfTestState()
    let status = input.withUnsafeBytes { bytes in
        zmanagerMacOSDefaultHandlers(
            bytes.bindMemory(to: UInt8.self).baseAddress,
            bytes.count,
            installedOperationSelfTestCallback,
            Unmanaged.passUnretained(state).toOpaque()
        )
    }
    guard status == 0, let payload = state.payload,
          let rows = try? JSONSerialization.jsonObject(with: payload) as? [[String: Any]]
    else { return false }
    return rows.count == 1 && rows[0]["fileExtension"] as? String == "zip"
        && rows[0]["contentType"] as? String != nil
}

@MainActor
private func runInstalledServiceSelfTest(root: URL) -> Bool {
    let input = root.appending(path: "service-input.txt")
    do { try Data("service".utf8).write(to: input) } catch { return false }
    var delivered: [Data] = []
    let lifecycle = NativeHostLifecycle { delivered.append($0) }
    let pasteboard = NSPasteboard.withUniqueName()
    pasteboard.clearContents()
    guard pasteboard.writeObjects([input as NSURL]) else { return false }
    var serviceError: NSString?
    withUnsafeMutablePointer(to: &serviceError) { error in
        lifecycle.performZManagerService(
            pasteboard,
            userData: "compress",
            error: AutoreleasingUnsafeMutablePointer(error)
        )
    }
    guard serviceError == nil, delivered.count == 1,
          let object = try? JSONSerialization.jsonObject(with: delivered[0]) as? [String: Any],
          object["kind"] as? String == "shellActionRequest",
          let payload = object["payload"] as? [String: Any],
          let request = payload["request"] as? [String: Any]
    else { return false }
    return request["kind"] as? String == "compress"
        && request["paths"] as? [String] == [input.path]
}

@_cdecl("zmanager_macos_host_shutdown")
public func zmanagerMacOSHostShutdown() {
    let state = HostState.shared
    state.lock.lock()
    state.running = false
    state.callback = nil
    state.context = nil
    let lifecycle = state.lifecycle
    state.lifecycle = nil
    state.lock.unlock()
    if let lifecycle {
        if Thread.isMainThread { MainActor.assumeIsolated { lifecycle.stop() } }
        else { DispatchQueue.main.async { lifecycle.stop() } }
    }
}

@_cdecl("zmanager_macos_host_is_running")
public func zmanagerMacOSHostIsRunning() -> Bool {
    let state = HostState.shared
    state.lock.lock()
    defer { state.lock.unlock() }
    return state.running
}
