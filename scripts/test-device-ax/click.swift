// Posts one click after a fresh visual inspection. Rejects points outside the
// frontmost Cadence window; never use a position saved before an update.
// Usage: click <pid> <x> <y>
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1)
}
guard CommandLine.arguments.count == 4, let pid = pid_t(CommandLine.arguments[1]), pid > 0,
      let x = Double(CommandLine.arguments[2]), x.isFinite,
      let y = Double(CommandLine.arguments[3]), y.isFinite else {
  fail("Usage: click <pid> <x> <y>")
}
guard AXIsProcessTrusted() else { fail("Accessibility is unavailable; the owner grants it on the device.") }
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { fail("Cadence is not frontmost.") }
let point = CGPoint(x: x, y: y)
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let topWindow = windows.first { window in
  guard (window[kCGWindowAlpha as String] as? Double ?? 0) > 0,
        let rawBounds = window[kCGWindowBounds as String] as? [String: Any],
        let bounds = CGRect(dictionaryRepresentation: rawBounds as CFDictionary) else { return false }
  return bounds.contains(point)
}
guard let owner = topWindow?[kCGWindowOwnerPID as String] as? NSNumber, owner.int32Value == pid else { fail("Cadence does not own the target point.") }
for type in [CGEventType.leftMouseDown, .leftMouseUp] {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { fail("Could not create the mouse event.") }
  event.post(tap: .cghidEventTap)
  usleep(80_000)
}
