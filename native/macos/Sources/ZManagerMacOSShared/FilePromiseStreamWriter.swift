import AppKit
import Foundation

public final class FilePromiseStreamWriter: NSObject, NSFilePromiseProviderDelegate, @unchecked Sendable {
    public typealias Stream = @Sendable (URL) throws -> Void
    public typealias Completion = @Sendable () -> Void
    private let promisedName: String
    private let stream: Stream
    private let completion: Completion

    public init(
        promisedName: String,
        stream: @escaping Stream,
        completion: @escaping Completion = {}
    ) {
        self.promisedName = promisedName
        self.stream = stream
        self.completion = completion
    }

    public func filePromiseProvider(_ filePromiseProvider: NSFilePromiseProvider, fileNameForType fileType: String) -> String {
        promisedName
    }

    public func filePromiseProvider(
        _ filePromiseProvider: NSFilePromiseProvider,
        writePromiseTo url: URL,
        completionHandler: @escaping (Error?) -> Void
    ) {
        do {
            // AppKit supplies the final destination URL. The filename callback
            // is only used to advertise the name during the drag negotiation;
            // appending it here would create a second nested path for Finder
            // drops.
            try stream(url)
            completionHandler(nil)
        } catch {
            completionHandler(error)
        }
        completion()
    }

    public func operationQueue(for filePromiseProvider: NSFilePromiseProvider) -> OperationQueue {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return queue
    }
}
