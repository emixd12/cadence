// Usage: press.js <role> <exact name>; presses the first matching element.
function run(argv) {
  const [role, name] = argv;
  const se = Application("System Events");
  const p = se.processes.byName("cadence-desktop-spike");
  if (p.windows.length === 0) return "no windows";
  let found = null;
  function walk(el, depth) {
    if (found || depth > 40) return;
    let r = "", n = "", d = "";
    try { r = el.role(); } catch (e) {}
    try { n = el.name() || ""; } catch (e) {}
    try { d = el.description() || ""; } catch (e) {}
    if (r === role && (n === name || d === name)) { found = el; return; }
    let kids = [];
    try { kids = el.uiElements(); } catch (e) {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(p.windows[0], 0);
  if (!found) return "not found: " + role + " " + name;
  found.actions.byName("AXPress").perform();
  return "pressed: " + role + " " + name;
}
