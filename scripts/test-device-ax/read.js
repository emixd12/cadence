// Reads visible app content, which can include private account or Calendar data.
// JXA invokes this entry point.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(argv) {
  const processName = argv.shift();
  const se = Application("System Events");
  const p = se.processes.byName(processName);
  if (!p.exists()) throw new Error("process not found");
  const w = p.windows;
  if (w.length === 0) throw new Error("no windows");
  const out = [];
  const limit = Number(argv[0] || 400);
  function walk(el, depth) {
    if (out.length >= limit || depth > 40) return;
    let role = "", name = "", desc = "", value = "";
    try { role = el.role(); } catch {}
    try { name = el.name() || ""; } catch {}
    try { desc = el.description() || ""; } catch {}
    try { const v = el.value(); value = (typeof v === "string") ? v : ""; } catch {}
    const text = [name, desc, value].filter((s) => s && s !== "missing value").join(" | ");
    if (text) out.push(role + ": " + text);
    let kids = [];
    try { kids = el.uiElements(); } catch {}
    for (const k of kids) walk(k, depth + 1);
  }
  walk(w[0], 0);
  return "title=" + w[0].name() + "\n" + out.join("\n");
}
