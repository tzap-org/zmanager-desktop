import ZManagerGenerated
import AppKit
import CoreServices
import Foundation
import UniformTypeIdentifiers
import ZManagerMacOSShared

private struct IconRequest: Decodable {
    let key: String
    let path: String
    let isDirectory: Bool
}

private struct IconResponse: Encodable {
    let key: String
    let dataUrl: String?
}

private final class OperationResult: @unchecked Sendable {
    var data = Data()
}

// Every entry of the same kind renders to an identical icon, so the expensive
// NSWorkspace lookup and NSImage draw only need to happen once per kind rather
// than once per entry. A single request carries up to 1,024 entries that
// typically collapse to a handful of kinds.
private enum IconKind {
    case directory
    case type(UTType)
    case data

    var cacheKey: String {
        switch self {
        case .directory: return "\u{1}directory"
        case .type(let type): return type.identifier
        case .data: return "\u{1}data"
        }
    }

    var icon: NSImage {
        switch self {
        case .directory: return NSWorkspace.shared.icon(for: .folder)
        case .type(let type): return NSWorkspace.shared.icon(for: type)
        case .data: return NSWorkspace.shared.icon(for: .data)
        }
    }
}

private func iconKind(for path: String, isDirectory: Bool) -> IconKind? {
    if isDirectory { return .directory }
    guard !path.isEmpty else { return nil }
    // The frontend sends the extension with a leading dot (e.g. ".pdf").
    // NSString.pathExtension is empty for such paths, so strip the dot.
    let ext: String
    if path.hasPrefix(".") {
        ext = String(path.dropFirst())
    } else {
        ext = (path as NSString).pathExtension
    }
    if !ext.isEmpty, let type = UTType(filenameExtension: ext.lowercased()) {
        return .type(type)
    }
    return .data
}

private func renderPNGDataURL(for icon: NSImage) -> String? {
    let size = NSSize(width: 32, height: 32)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size.width),
        pixelsHigh: Int(size.height),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(origin: .zero, size: size),
              from: .zero,
              operation: .sourceOver,
              fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64,\(png.base64EncodedString())"
}

// Main-thread confined: every caller reaches this through the dispatch in
// zmanagerMacOSSystemFileIcons, which runs its work block on the main thread.
private final class IconDataURLCache: @unchecked Sendable {
    static let shared = IconDataURLCache()
    private var entries: [String: String?] = [:]

    func dataURL(for kind: IconKind) -> String? {
        let key = kind.cacheKey
        if let cached = entries[key] { return cached }
        let rendered = renderPNGDataURL(for: kind.icon)
        entries[key] = rendered
        return rendered
    }
}

private func pngDataURL(for path: String, isDirectory: Bool) -> String? {
    guard let kind = iconKind(for: path, isDirectory: isDirectory) else { return nil }
    return IconDataURLCache.shared.dataURL(for: kind)
}

@_cdecl("zmanager_macos_system_file_icons")
public func zmanagerMacOSSystemFileIcons(
    _ bytes: UnsafePointer<UInt8>?,
    _ count: Int,
    _ callback: ZManagerHostCallback?,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard let bytes, count >= 0, count <= MacOSFFILimits.maxRequestBytes, let callback else { return MacOSFFIErrorMapping.invalidPayload }
    let input = Data(bytes: bytes, count: count)
    guard let requests = try? JSONDecoder().decode([IconRequest].self, from: input),
          requests.count <= 1_024
    else { return MacOSFFIErrorMapping.systemError }
    let result = OperationResult()
    let work = {
        let responses = requests.map {
            IconResponse(key: $0.key, dataUrl: pngDataURL(for: $0.path, isDirectory: $0.isDirectory))
        }
        result.data = (try? JSONEncoder().encode(responses)) ?? Data("[]".utf8)
    }
    if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
    result.data.withUnsafeBytes { output in
        callback(output.bindMemory(to: UInt8.self).baseAddress, output.count, context)
    }
    return 0
}

private struct DefaultHandlerRequest: Decodable {
    let action: String
    let extensions: [String]
    let bundleID: String
    let handlers: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case action, extensions, handlers
        case bundleID = "bundleId"
    }
}

private struct DefaultHandlerEntry: Encodable {
    let fileExtension: String
    let contentType: String?
    let handlerBundleID: String?
    let isCurrentApplication: Bool
    let errorCode: Int32?

    private enum CodingKeys: String, CodingKey {
        case fileExtension, contentType, isCurrentApplication, errorCode
        case handlerBundleID = "handlerBundleId"
    }
}

private func defaultHandlerEntry(
    fileExtension: String,
    bundleID: String,
    requestedHandler: String?
) -> DefaultHandlerEntry {
    guard let type = UTType(filenameExtension: fileExtension) else {
        return DefaultHandlerEntry(
            fileExtension: fileExtension,
            contentType: nil,
            handlerBundleID: nil,
            isCurrentApplication: false,
            errorCode: -1
        )
    }
    let identifier = type.identifier
    var errorCode: Int32?
    if let requestedHandler {
        let status = LSSetDefaultRoleHandlerForContentType(
            identifier as CFString,
            .all,
            requestedHandler as CFString
        )
        if status != noErr { errorCode = status }
    }
    let handler = LSCopyDefaultRoleHandlerForContentType(identifier as CFString, .all)?
        .takeRetainedValue() as String?
    return DefaultHandlerEntry(
        fileExtension: fileExtension,
        contentType: identifier,
        handlerBundleID: handler,
        isCurrentApplication: handler == bundleID,
        errorCode: errorCode
    )
}

@_cdecl("zmanager_macos_default_handlers")
public func zmanagerMacOSDefaultHandlers(
    _ bytes: UnsafePointer<UInt8>?,
    _ count: Int,
    _ callback: ZManagerHostCallback?,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard let bytes, count > 0, count <= MacOSFFILimits.maxRequestBytes, let callback,
          let request = try? JSONDecoder().decode(
              DefaultHandlerRequest.self,
              from: Data(bytes: bytes, count: count)
          ), ["status", "set", "restore"].contains(request.action),
          !request.bundleID.isEmpty, request.bundleID.utf8.count <= 255,
          !request.extensions.isEmpty, request.extensions.count <= 256,
          request.extensions.allSatisfy({ extensionName in
              !extensionName.isEmpty && extensionName.utf8.count <= 32
                  && extensionName.split(separator: ".", omittingEmptySubsequences: false)
                      .allSatisfy { component in
                          !component.isEmpty
                              && component.allSatisfy { $0.isLetter || $0.isNumber }
                      }
          })
    else { return MacOSFFIErrorMapping.invalidPayload }

    let result = OperationResult()
    let work = {
        let entries = request.extensions.map { extensionName -> DefaultHandlerEntry in
            let requestedHandler: String?
            switch request.action {
            case "set": requestedHandler = request.bundleID
            case "restore": requestedHandler = request.handlers?[extensionName]
            default: requestedHandler = nil
            }
            return defaultHandlerEntry(
                fileExtension: extensionName,
                bundleID: request.bundleID,
                requestedHandler: requestedHandler
            )
        }
        result.data = (try? JSONEncoder().encode(entries)) ?? Data("[]".utf8)
    }
    if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
    result.data.withUnsafeBytes { output in
        callback(output.bindMemory(to: UInt8.self).baseAddress, output.count, context)
    }
    return 0
}

@_cdecl("zmanager_macos_consume_shell_action_request")
public func zmanagerMacOSConsumeShellActionRequest(
    _ tokenBytes: UnsafePointer<UInt8>?,
    _ tokenLength: Int,
    _ callback: ZManagerHostCallback?,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard let tokenBytes, tokenLength > 0, tokenLength <= 128, let callback,
          let token = String(
              data: Data(bytes: tokenBytes, count: tokenLength),
              encoding: .utf8
          )
    else { return MacOSFFIErrorMapping.invalidPayload }
    do {
        let inbox: AppGroupRequestInbox
        if let value = getenv("ZMANAGER_MACOS_APP_GROUP_REQUEST_DIR") {
            let override = String(cString: value)
            inbox = AppGroupRequestInbox(directory: URL(filePath: override, directoryHint: .isDirectory))
        } else {
            inbox = try AppGroupRequestInbox.applicationGroup()
        }
        inbox.cleanupExpired()
        let data = try inbox.consumeFromHost(token: token)
        data.withUnsafeBytes { output in
            callback(output.bindMemory(to: UInt8.self).baseAddress, output.count, context)
        }
        return 0
    } catch {
        return MacOSFFIErrorMapping.systemError
    }
}

