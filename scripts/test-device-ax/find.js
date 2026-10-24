// Usage: find.js <regex>; prints role/name/description/value lines that match.
function run(argv) {
  const re = new RegExp(argv[0], "i");
  const se = Application("System Events");
  const p = se.processes.byName("cadence-desktop-spike");
  if (p.windows.length === 0) return "no windows";
  const out = [];
  function walk(el, depth) {
    if (depth > 40) return;
    let r = "", n = "", d = "", v = "";
    try { r = el.role(); } catch (e) {}
    try { n = el.name() || ""; } catch (e) {}
    try { d = el.description() || ""; } catch (e) {}
    try { const x = el.value(); v = typeof x === "string" ? x : ""; } catch (e) {}
    const t = [...new Set([n, d, v].filter((s) => s && s !== "missing value"))].join(" | ");
    if (t && re.test(r + " " + t)) out.push(r + ": " + t);
    let kids = [];
    try { kids = el.uiElements(); } catch (e) {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(p.windows[0], 0);
  return out.join("\n") || "no match";
}
