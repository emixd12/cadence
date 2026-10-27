// Usage: press.js <process> <role> <exact name>; presses the first matching element.
// JXA invokes this entry point.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const processName = argv.shift();
  const [role, name] = argv;
  const se = Application("System Events");
  const p = se.processes.byName(processName);
  if (!p.exists()) throw new Error("process not found");
  if (p.windows.length === 0) throw new Error("no windows");
  let found = null;
  function walk(el, depth) {
    if (found || depth > 40) return;
    let r = "", n = "", d = "";
    try { r = el.role(); } catch {}
    try { n = el.name() || ""; } catch {}
    try { d = el.description() || ""; } catch {}
    if (r === role && (n === name || d === name)) { found = el; return; }
    let kids = [];
    try { kids = el.uiElements(); } catch {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(p.windows[0], 0);
  if (!found) throw new Error("not found: " + role + " " + name);
  found.actions.byName("AXPress").perform();
  return "pressed: " + role + " " + name;
}
