// Runs on a test device through scripts/test-device.mjs. Reads the Cadence window; prints no secrets.
function run(argv) {
  const se = Application("System Events");
  const p = se.processes.byName("cadence-desktop-spike");
  if (!p.exists()) return "process not found";
  const w = p.windows;
  if (w.length === 0) return "no windows";
  const out = [];
  const limit = Number(argv[0] || 400);
  function walk(el, depth) {
    if (out.length > limit || depth > 40) return;
    let role = "", name = "", desc = "", value = "";
    try { role = el.role(); } catch (e) {}
    try { name = el.name() || ""; } catch (e) {}
    try { desc = el.description() || ""; } catch (e) {}
    try { const v = el.value(); value = (typeof v === "string") ? v : ""; } catch (e) {}
    const text = [name, desc, value].filter((s) => s && s !== "missing value").join(" | ");
    if (text) out.push(role + ": " + text);
    let kids = [];
    try { kids = el.uiElements(); } catch (e) {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(w[0], 0);
  return "title=" + w[0].name() + "\n" + out.join("\n");
}
