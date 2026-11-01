// Usage: find.js <process> <regex>; prints role/name/description/value lines that match.
// Numeric values are printed too, so a checkbox reads as 0 or 1.
// JXA invokes this entry point.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const processName = argv.shift();
  const re = new RegExp(argv[0], "i");
  const se = Application("System Events");
  const p = se.processes.byName(processName);
  if (!p.exists()) throw new Error("process not found");
  if (p.windows.length === 0) throw new Error("no windows");
  const out = [];
  function walk(el, depth) {
    if (depth > 40) return;
    let r = "", n = "", d = "", v = "";
    try { r = el.role(); } catch {}
    try { n = el.name() || ""; } catch {}
    try { d = el.description() || ""; } catch {}
    try { const x = el.value(); v = typeof x === "string" ? x : typeof x === "number" ? String(x) : ""; } catch {}
    const t = [...new Set([n, d, v].filter((s) => s && s !== "missing value"))].join(" | ");
    if (t && re.test(r + " " + t)) out.push(r + ": " + t);
    let kids = [];
    try { kids = el.uiElements(); } catch {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(p.windows[0], 0);
  return out.join("\n") || "no match";
}
