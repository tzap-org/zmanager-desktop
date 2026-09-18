import AppKit
import Foundation
import Testing
@testable import ZManagerMacOSShared

@Test func appGroupRequestIsAtomicConsumedOnceAndDeleted() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "zmanager-app-group-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let inbox = AppGroupRequestInbox(directory: root)
    let token = "abcdefghijklmnopqrstuv"
    let request = Data("{\"version\":1}".utf8)
    try inbox.writeFromExtension(data: request, token: token)
    #expect(try inbox.consumeFromHost(token: token) == request)
    #expect(!FileManager.default.fileExists(atPath: root.appending(path: "\(token).json").path))
    #expect(throws: (any Error).self) { try inbox.consumeFromHost(token: token) }
}

@Test func appGroupRequestRejectsInvalidAndOversizedInput() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "zmanager-app-group-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let inbox = AppGroupRequestInbox(directory: root)
    #expect(throws: AppGroupRequestInboxError.invalidToken) { try inbox.writeFromExtension(data: Data(), token: "../bad") }
    #expect(throws: AppGroupRequestInboxError.oversized) {
        try inbox.writeFromExtension(data: Data(count: AppGroupRequestInbox.maximumBytes + 1), token: "abcdefghijklmnopqrstuv")
    }
}

@Test func appGroupTokensAreOpaqueAndExclusiveCreationPreventsReplayOverwrite() throws {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-app-group-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let inbox = AppGroupRequestInbox(directory: root)
    let token = try AppGroupRequestInbox.generateToken()
    #expect(token.count == 32)
    #expect(token.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
    try inbox.writeFromExtension(data: Data("first".utf8), token: token)
    #expect(throws: (any Error).self) {
        try inbox.writeFromExtension(data: Data("replacement".utf8), token: token)
    }
    #expect(try inbox.consumeFromHost(token: token) == Data("first".utf8))
}

@Test func appGroupConsumerRejectsAndDeletesSymlinkWrongModeStaleAndFutureFiles() throws {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-app-group-security-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let inbox = AppGroupRequestInbox(directory: root)
    let now = Date()

    let symlinkToken = "abcdefghijklmnopqrstuv"
    let outside = root.appending(path: "outside")
    try Data("outside".utf8).write(to: outside)
    let symlink = root.appending(path: "\(symlinkToken).json")
    try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: outside)
    #expect(throws: AppGroupRequestInboxError.invalidFile) {
        try inbox.consumeFromHost(token: symlinkToken, now: now)
    }
    #expect(!FileManager.default.fileExists(atPath: symlink.path))
    #expect(FileManager.default.fileExists(atPath: outside.path))

    let modeToken = "bcdefghijklmnopqrstuvw"
    try inbox.writeFromExtension(data: Data("mode".utf8), token: modeToken)
    let modeFile = root.appending(path: "\(modeToken).json")
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: modeFile.path)
    #expect(throws: AppGroupRequestInboxError.invalidPermissions) {
        try inbox.consumeFromHost(token: modeToken, now: now)
    }
    #expect(!FileManager.default.fileExists(atPath: modeFile.path))

    for (token, date) in [
        ("cdefghijklmnopqrstuvwx", now.addingTimeInterval(-301)),
        ("defghijklmnopqrstuvwxy", now.addingTimeInterval(61)),
    ] {
        try inbox.writeFromExtension(data: Data("time".utf8), token: token)
        let file = root.appending(path: "\(token).json")
        try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: file.path)
        #expect(throws: AppGroupRequestInboxError.stale) {
            try inbox.consumeFromHost(token: token, now: now)
        }
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }
}

@Test func appGroupCleanupIsBoundedToExpiredRequestFiles() throws {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-app-group-cleanup-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let inbox = AppGroupRequestInbox(directory: root)
    let now = Date()
    for token in ["efghijklmnopqrstuvwxyz", "fghijklmnopqrstuvwxyza"] {
        try inbox.writeFromExtension(data: Data("old".utf8), token: token)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-600)],
            ofItemAtPath: root.appending(path: "\(token).json").path
        )
    }
    #expect(inbox.cleanupExpired(now: now, limit: 1) == 1)
    #expect(inbox.cleanupExpired(now: now, limit: 10) == 1)
}

@Test @MainActor func filePromiseDefersFakeRustStreamUntilDestination() throws {
    let destination = FileManager.default.temporaryDirectory.appending(path: "zmanager-promise-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: destination) }
    final class State: @unchecked Sendable { var started = false }
    let state = State()
    let writer = FilePromiseStreamWriter(promisedName: "entry.txt") { url in
        state.started = true
        try Data("streamed".utf8).write(to: url)
    }
    let provider = NSFilePromiseProvider(fileType: "public.data", delegate: writer)
    #expect(!state.started)
    var completionError: Error?
    writer.filePromiseProvider(provider, writePromiseTo: destination) { completionError = $0 }
    #expect(completionError == nil)
    #expect(state.started)
    #expect(try String(contentsOf: destination, encoding: .utf8) == "streamed")
}

@Test @MainActor func filePromiseReportsStreamFailuresAndSerializesOperations() throws {
    enum TestError: Error, Equatable { case streamFailed }
    let writer = FilePromiseStreamWriter(promisedName: "entry.txt") { _ in
        throw TestError.streamFailed
    }
    let provider = NSFilePromiseProvider(fileType: "public.data", delegate: writer)
    let destination = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-promise-error-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: destination) }

    #expect(writer.filePromiseProvider(provider, fileNameForType: "public.data") == "entry.txt")
    var completionError: Error?
    writer.filePromiseProvider(provider, writePromiseTo: destination) { completionError = $0 }
    #expect((completionError as? TestError) == .streamFailed)
    #expect(writer.operationQueue(for: provider).maxConcurrentOperationCount == 1)
}

@Test @MainActor func filePromiseCompletionRunsAfterAppKitCompletionHandler() throws {
    final class OrderingState: @unchecked Sendable {
        var completionHandlerReturned = false
        var completionRan = false
    }
    let state = OrderingState()
    let writer = FilePromiseStreamWriter(
        promisedName: "entry.txt",
        stream: { _ in },
        completion: { state.completionRan = state.completionHandlerReturned }
    )
    let provider = NSFilePromiseProvider(fileType: "public.data", delegate: writer)
    let destination = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-promise-completion-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: destination) }

    writer.filePromiseProvider(provider, writePromiseTo: destination) { _ in
        state.completionHandlerReturned = true
    }

    #expect(state.completionRan)
}

@Test func appGroupRejectsBoundaryAndPathTraversalTokens() {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "zmanager-app-group-token-boundaries-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let inbox = AppGroupRequestInbox(directory: root)
    for token in ["a", String(repeating: "a", count: 21), "../abcdefghijklmnopqrstuv", "abc/abcdefghijklmnopqrstuv"] {
        #expect(throws: AppGroupRequestInboxError.invalidToken) {
            try inbox.writeFromExtension(data: Data("payload".utf8), token: token)
        }
    }
    #expect(throws: AppGroupRequestInboxError.invalidToken) {
        try inbox.writeFromExtension(data: Data("payload".utf8), token: String(repeating: "a", count: 129))
    }
}
