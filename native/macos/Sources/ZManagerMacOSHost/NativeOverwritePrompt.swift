import AppKit
import Foundation
import ZManagerGenerated

/// Asked about every 100 ms while the prompt is open; non-zero closes it as Cancel.
public typealias ZManagerPromptCancelledCallback = @convention(c) (UnsafeMutableRawPointer?) -> Int32

/// Button titles in choice order: Replace, Replace all, Skip, Skip all,
/// Rename all, Cancel. A button's index is the choice code returned to Rust.
struct OverwritePromptRequest: Decodable {
    let title: String
    let instruction: String
    let content: String
    let buttons: [String]
}

enum OverwritePromptChoiceCode {
    static let buttonCount = 6
    static let cancel: Int32 = 5

    static func from(_ response: NSApplication.ModalResponse) -> Int32 {
        let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        return (0..<buttonCount).contains(index) ? Int32(index) : cancel
    }
}

/// One NSAlert holding every overwrite choice, modelled on 7-Zip's overwrite
/// dialog. It runs as a sheet on a visible owner window, otherwise as a
/// free-standing app-modal alert, and closes as Cancel when the job is cancelled.
@MainActor
private final class OverwritePromptSession: NSObject {
    private let alert = NSAlert()
    private let isCancelled: ZManagerPromptCancelledCallback
    private let context: UnsafeMutableRawPointer?

    init(request: OverwritePromptRequest, isCancelled: @escaping ZManagerPromptCancelledCallback, context: UnsafeMutableRawPointer?) {
        self.isCancelled = isCancelled
        self.context = context
        super.init()
        alert.alertStyle = .warning
        alert.messageText = request.instruction
        alert.informativeText = request.content
        alert.window.title = request.title
        // NSAlert gives the first button (Replace) the Return key.
        for title in request.buttons {
            alert.addButton(withTitle: title)
        }
        alert.buttons.last?.keyEquivalent = "\u{1b}"
    }

    func run(owner: NSWindow?) -> Int32 {
        if isCancelled(context) != 0 { return OverwritePromptChoiceCode.cancel }
        let timer = Timer(timeInterval: 0.1, target: self, selector: #selector(pollCancellation), userInfo: nil, repeats: true)
        // Common modes include the modal-panel mode that runModal spins in.
        RunLoop.main.add(timer, forMode: .common)
        defer { timer.invalidate() }

        let response: NSApplication.ModalResponse
        // A hidden or minimized owner would hide its sheet too and leave the
        // job waiting on a prompt nobody can see.
        if let owner, owner.isVisible, !owner.isMiniaturized {
            alert.beginSheetModal(for: owner) { response in
                NSApp.stopModal(withCode: response)
            }
            response = NSApp.runModal(for: alert.window)
        } else {
            NSApp.unhide(nil)
            NSApp.activate()
            response = alert.runModal()
        }
        return OverwritePromptChoiceCode.from(response)
    }

    @objc private func pollCancellation() {
        guard isCancelled(context) != 0 else { return }
        if let parent = alert.window.sheetParent {
            parent.endSheet(alert.window, returnCode: .cancel)
        } else {
            NSApp.stopModal(withCode: .cancel)
        }
    }
}

/// Shows the overwrite prompt and blocks until it is answered, writing the
/// choice code to `choice`. Must be called on the main thread.
@_cdecl("zmanager_macos_show_overwrite_prompt")
public func zmanagerMacOSShowOverwritePrompt(
    _ windowPointer: UnsafeMutableRawPointer?,
    _ bytes: UnsafePointer<UInt8>?,
    _ length: Int,
    _ isCancelled: ZManagerPromptCancelledCallback?,
    _ context: UnsafeMutableRawPointer?,
    _ choice: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let bytes, let isCancelled, let choice, length > 0, length <= MacOSFFILimits.maxRequestBytes,
          let request = try? JSONDecoder().decode(
              OverwritePromptRequest.self,
              from: Data(bytes: bytes, count: length)
          ), request.buttons.count == OverwritePromptChoiceCode.buttonCount
    else { return MacOSFFIErrorMapping.invalidPayload }
    guard Thread.isMainThread else { return MacOSFFIErrorMapping.systemError }
    // Only touched on the main thread, which the guard above has established.
    nonisolated(unsafe) let windowPointer = windowPointer
    nonisolated(unsafe) let context = context
    choice.pointee = MainActor.assumeIsolated {
        let owner = windowPointer.map { Unmanaged<NSWindow>.fromOpaque($0).takeUnretainedValue() }
        return OverwritePromptSession(request: request, isCancelled: isCancelled, context: context).run(owner: owner)
    }
    return MacOSFFIErrorMapping.success
}
