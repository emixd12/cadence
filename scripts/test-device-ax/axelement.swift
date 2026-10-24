// Finds one element in a process's accessibility tree by role and title or
// description, then prints its screen center as JSON, or presses it.
// Talks to the process directly, without System Events.
// "show" scrolls the element into view first, so its frame is clickable.
// Usage: axelement <pid> find|show|press <role> <name>
import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count == 5, let pid = pid_t(args[1]), ["find", "show", "press"].contains(args[2]) else {
  FileHandle.standardError.write("Usage: axelement <pid> find|show|press <role> <name>\n".data(using: .utf8)!); exit(2)
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func search(_ element: AXUIElement, depth: Int) -> AXUIElement? {
  if depth > 60 { return nil }
  let role = attribute(element, kAXRoleAttribute) as? String
  let labels = [kAXTitleAttribute, kAXDescriptionAttribute].compactMap { attribute(element, $0) as? String }
  if role == args[3] && labels.contains(args[4]) { return element }
  for child in (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] {
    if let found = search(child, depth: depth + 1) { return found }
  }
  return nil
}
var windows: CFTypeRef?
let status = AXUIElementCopyAttributeValue(AXUIElementCreateApplication(pid), kAXWindowsAttribute as CFString, &windows)
guard status == .success else { print("{\"error\":\"windows\",\"axError\":\(status.rawValue)}"); exit(1) }
guard let element = ((windows as? [AXUIElement]) ?? []).lazy.compactMap({ search($0, depth: 0) }).first else {
  print("{\"error\":\"not found\"}"); exit(1)
}
if args[2] == "show" { AXUIElementPerformAction(element, "AXScrollToVisible" as CFString); usleep(500_000) }
var point = CGPoint.zero, size = CGSize.zero
if let position = attribute(element, kAXPositionAttribute) { AXValueGetValue(position as! AXValue, .cgPoint, &point) }
if let extent = attribute(element, kAXSizeAttribute) { AXValueGetValue(extent as! AXValue, .cgSize, &size) }
let pressed = args[2] == "press" ? AXUIElementPerformAction(element, kAXPressAction as CFString).rawValue : 0
let display = CGDisplayBounds(CGMainDisplayID())
print("{\"x\":\(point.x + size.width / 2),\"y\":\(point.y + size.height / 2),\"left\":\(point.x),\"top\":\(point.y),\"width\":\(size.width),\"height\":\(size.height),\"screenWidth\":\(display.width),\"screenHeight\":\(display.height),\"axError\":\(pressed)}")
exit(pressed == 0 ? 0 : 1)
