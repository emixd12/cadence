// Posts one left click at global screen coordinates (top-left origin), the same
// coordinates axelement prints. Works on a process that accessibility refuses.
// Usage: click <x> <y>
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3, let x = Double(CommandLine.arguments[1]), let y = Double(CommandLine.arguments[2]) else {
  FileHandle.standardError.write("Usage: click <x> <y>\n".data(using: .utf8)!); exit(2)
}
let point = CGPoint(x: x, y: y)
for type in [CGEventType.leftMouseDown, .leftMouseUp] {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { exit(1) }
  event.post(tap: .cghidEventTap)
  usleep(80_000)
}
