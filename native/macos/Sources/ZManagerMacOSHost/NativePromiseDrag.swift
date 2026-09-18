import ZManagerGenerated
import AppKit
import Foundation
import UniformTypeIdentifiers
import ZManagerMacOSShared

public typealias ZManagerPromiseWriteCallback = @convention(c) (
    UnsafePointer<UInt8>?, Int, UnsafePointer<UInt8>?, Int, UnsafeMutableRawPointer?
) -> Int32
public typealias ZManagerPromiseOutcomeCallback = @convention(c) (Int32, UnsafeMutableRawPointer?) -> Void
public typealias ZManagerPromiseReleaseCallback = @convention(c) (UnsafeMutableRawPointer?) -> Void

private struct PromiseDragItem: Decodable {
    let entryPath: String
    let promisedName: String
    let fileType: String
}

final class PromiseDragCompletionCoordinator: @unchecked Sendable {
    private let lock = NSLock()
    private let onOutcome: (Int32) -> Void
    private var remaining: Int
    private var dragOutcome: Int32?
    private var outcomeDelivered = false

    init(promiseCount: Int, onOutcome: @escaping (Int32) -> Void) {
        self.remaining = promiseCount
        self.onOutcome = onOutcome
    }

    func promiseFinished() {
        let outcome = lock.withLock {
            remaining = max(remaining - 1, 0)
            return takeOutcomeIfReady()
        }
        if let outcome { onOutcome(outcome) }
    }

    func draggingEnded(operation: NSDragOperation) {
        let outcome = lock.withLock {
            dragOutcome = operation.isEmpty ? 1 : 0
            return takeOutcomeIfReady()
        }
        if let outcome { onOutcome(outcome) }
    }

    private func takeOutcomeIfReady() -> Int32? {
        guard !outcomeDelivered, let dragOutcome else { return nil }
        guard dragOutcome != 0 || remaining == 0 else { return nil }
        outcomeDelivered = true
        return dragOutcome
    }
}

private final class PromiseCallbackLease: @unchecked Sendable {
    let sessionID: String
    let write: ZManagerPromiseWriteCallback
    let outcome: ZManagerPromiseOutcomeCallback
    let context: UnsafeMutableRawPointer?
    private let release: ZManagerPromiseReleaseCallback
    private let completion: PromiseDragCompletionCoordinator

    init(
        sessionID: String,
        promiseCount: Int,
        write: @escaping ZManagerPromiseWriteCallback,
        outcome: @escaping ZManagerPromiseOutcomeCallback,
        release: @escaping ZManagerPromiseReleaseCallback,
        context: UnsafeMutableRawPointer?
    ) {
        self.sessionID = sessionID
        self.write = write
        self.outcome = outcome
        self.release = release
        self.context = context
        self.completion = PromiseDragCompletionCoordinator(promiseCount: promiseCount) { outcomeCode in
            outcome(outcomeCode, context)
            DispatchQueue.main.async { ActivePromiseDrags.shared.remove(sessionID) }
        }
    }

    func promiseFinished() {
        completion.promiseFinished()
    }

    func draggingEnded(operation: NSDragOperation) {
        completion.draggingEnded(operation: operation)
    }

    deinit { release(context) }
}

@MainActor
private final class PromiseDragSource: NSObject, NSDraggingSource {
    let sessionID: String
    let writers: [FilePromiseStreamWriter]
    let lease: PromiseCallbackLease

    init(
        sessionID: String,
        writers: [FilePromiseStreamWriter],
        lease: PromiseCallbackLease
    ) {
        self.sessionID = sessionID
        self.writers = writers
        self.lease = lease
    }

    func draggingSession(
        _: NSDraggingSession,
        sourceOperationMaskFor _: NSDraggingContext
    ) -> NSDragOperation { .copy }

    func draggingSession(_: NSDraggingSession, endedAt _: NSPoint, operation: NSDragOperation) {
        lease.draggingEnded(operation: operation)
    }
}

@MainActor
private final class ActivePromiseDrags {
    static let shared = ActivePromiseDrags()
    private var sources: [String: PromiseDragSource] = [:]
    func retain(_ source: PromiseDragSource) { sources[source.sessionID] = source }
    func remove(_ id: String) { sources.removeValue(forKey: id) }
}

private final class PromiseStartInput: @unchecked Sendable {
    let view: NSView
    let sessionID: String
    let items: [PromiseDragItem]
    let write: ZManagerPromiseWriteCallback
    let outcome: ZManagerPromiseOutcomeCallback
    let release: ZManagerPromiseReleaseCallback
    let context: UnsafeMutableRawPointer?
    var result: Int32 = 0

    init(
        view: NSView,
        sessionID: String,
        items: [PromiseDragItem],
        write: @escaping ZManagerPromiseWriteCallback,
        outcome: @escaping ZManagerPromiseOutcomeCallback,
        release: @escaping ZManagerPromiseReleaseCallback,
        context: UnsafeMutableRawPointer?
    ) {
        self.view = view
        self.sessionID = sessionID
        self.items = items
        self.write = write
        self.outcome = outcome
        self.release = release
        self.context = context
    }

    @MainActor func start() {
        guard let event = NSApplication.shared.currentEvent else { result = 4; return }
        let lease = PromiseCallbackLease(
            sessionID: sessionID,
            promiseCount: items.count,
            write: write,
            outcome: outcome,
            release: release,
            context: context
        )
        var writers: [FilePromiseStreamWriter] = []
        var draggingItems: [NSDraggingItem] = []
        for (index, item) in items.enumerated() {
            let writer = FilePromiseStreamWriter(
                promisedName: item.promisedName,
                stream: { destination in
                let entry = Data(item.entryPath.utf8)
                let path = Data(destination.path.utf8)
                let status = entry.withUnsafeBytes { entryBytes in
                    path.withUnsafeBytes { pathBytes in
                        lease.write(
                            entryBytes.bindMemory(to: UInt8.self).baseAddress,
                            entryBytes.count,
                            pathBytes.bindMemory(to: UInt8.self).baseAddress,
                            pathBytes.count,
                            lease.context
                        )
                    }
                }
                if status != 0 {
                    throw NSError(domain: "ZManagerPromiseDrag", code: Int(status))
                }
                },
                completion: { lease.promiseFinished() }
            )
            let provider = NSFilePromiseProvider(fileType: item.fileType, delegate: writer)
            let draggingItem = NSDraggingItem(pasteboardWriter: provider)
            draggingItem.setDraggingFrame(
                NSRect(x: CGFloat(index * 8), y: 0, width: 32, height: 32),
                contents: NSWorkspace.shared.icon(for: UTType(item.fileType) ?? .data)
            )
            writers.append(writer)
            draggingItems.append(draggingItem)
        }
        let source = PromiseDragSource(
            sessionID: sessionID,
            writers: writers,
            lease: lease
        )
        ActivePromiseDrags.shared.retain(source)
        let retainedSessionID = sessionID
        DispatchQueue.main.asyncAfter(deadline: .now() + 15 * 60) {
            ActivePromiseDrags.shared.remove(retainedSessionID)
        }
        view.beginDraggingSession(with: draggingItems, event: event, source: source)
    }
}

@_cdecl("zmanager_macos_start_promise_drag")
public func zmanagerMacOSStartPromiseDrag(
    _ viewPointer: UnsafeMutableRawPointer?,
    _ sessionBytes: UnsafePointer<UInt8>?,
    _ sessionLength: Int,
    _ itemBytes: UnsafePointer<UInt8>?,
    _ itemLength: Int,
    _ write: ZManagerPromiseWriteCallback?,
    _ outcome: ZManagerPromiseOutcomeCallback?,
    _ release: ZManagerPromiseReleaseCallback?,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard let viewPointer, let sessionBytes, let itemBytes, let write, let outcome, let release,
          sessionLength > 0, sessionLength <= 128, itemLength > 0, itemLength <= MacOSFFILimits.maxRequestBytes,
          let sessionID = String(data: Data(bytes: sessionBytes, count: sessionLength), encoding: .utf8),
          let items = try? JSONDecoder().decode(
              [PromiseDragItem].self,
              from: Data(bytes: itemBytes, count: itemLength)
          ), !items.isEmpty, items.count <= 1_024
    else { return MacOSFFIErrorMapping.invalidPayload }
    let input = PromiseStartInput(
        view: Unmanaged<NSView>.fromOpaque(viewPointer).takeUnretainedValue(),
        sessionID: sessionID,
        items: items,
        write: write,
        outcome: outcome,
        release: release,
        context: context
    )
    if Thread.isMainThread { MainActor.assumeIsolated { input.start() } }
    else { DispatchQueue.main.sync { input.start() } }
    return input.result
}
