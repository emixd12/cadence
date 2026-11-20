/**
 * The notice catalog's message format: a small, strict part of ICU MessageFormat.
 *
 * - `{name}` puts in a value.
 * - `{name, select, a {...} other {...}}` picks a branch by the value's text.
 * - `{name, plural, one {...} other {...}}` picks by a number; `#` inside prints it.
 *
 * Branches may hold further arguments. `other` is required in select and plural.
 * A missing value throws, so a wrong call fails in tests instead of showing "{title}".
 */

export type NoticeParams = Readonly<Record<string, string | number>>;

type Part =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "arg"; name: string }>
  | Readonly<{ kind: "pound" }>
  | Readonly<{ kind: "select" | "plural"; name: string; branches: Readonly<Record<string, readonly Part[]>> }>;

const cache = new Map<string, readonly Part[]>();

export function parseNoticeTemplate(template: string): readonly Part[] {
  const cached = cache.get(template);
  if (cached) return cached;
  let index = 0;

  const parseParts = (inBranch: boolean): Part[] => {
    const parts: Part[] = [];
    let text = "";
    const flush = () => {
      if (text) parts.push({ kind: "text", text });
      text = "";
    };
    while (index < template.length) {
      const char = template[index]!;
      if (char === "}") {
        if (!inBranch) throw new Error(`Notice template has an unmatched "}": ${template}`);
        break;
      }
      if (char === "#" && inBranch) {
        flush();
        parts.push({ kind: "pound" });
        index += 1;
        continue;
      }
      if (char === "{") {
        flush();
        index += 1;
        parts.push(parseArgument());
        continue;
      }
      text += char;
      index += 1;
    }
    flush();
    return parts;
  };

  const readUntil = (stops: string): string => {
    const start = index;
    while (index < template.length && !stops.includes(template[index]!)) index += 1;
    return template.slice(start, index).trim();
  };

  const parseArgument = (): Part => {
    const name = readUntil(",}");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Notice template has a bad argument name "${name}": ${template}`);
    if (template[index] === "}") {
      index += 1;
      return { kind: "arg", name };
    }
    index += 1; // the comma
    const type = readUntil(",");
    if (type !== "select" && type !== "plural") throw new Error(`Notice template uses unsupported type "${type}": ${template}`);
    index += 1; // the comma
    const branches: Record<string, readonly Part[]> = {};
    for (;;) {
      while (template[index] === " ") index += 1;
      if (template[index] === "}") {
        index += 1;
        break;
      }
      const key = readUntil("{");
      if (!key || template[index] !== "{") throw new Error(`Notice template has a bad branch in "${name}": ${template}`);
      index += 1;
      branches[key] = parseParts(true);
      if (template[index] !== "}") throw new Error(`Notice template has an unclosed branch in "${name}": ${template}`);
      index += 1;
    }
    if (!branches.other) throw new Error(`Notice template "${name}" needs an "other" branch: ${template}`);
    return { kind: type, name, branches };
  };

  const parts = parseParts(false);
  if (index < template.length) throw new Error(`Notice template has an unmatched "}": ${template}`);
  cache.set(template, parts);
  return parts;
}

/** The argument names a template uses, for checks. */
export function noticeTemplateArguments(template: string): ReadonlySet<string> {
  const names = new Set<string>();
  const walk = (parts: readonly Part[]) => {
    for (const part of parts) {
      if (part.kind === "arg") names.add(part.name);
      if (part.kind === "select" || part.kind === "plural") {
        names.add(part.name);
        for (const branch of Object.values(part.branches)) walk(branch);
      }
    }
  };
  walk(parseNoticeTemplate(template));
  return names;
}

export function formatNoticeTemplate(template: string, params: NoticeParams = {}): string {
  const value = (name: string) => {
    const found = params[name];
    if (found === undefined) throw new Error(`Notice template needs "${name}": ${template}`);
    return found;
  };
  const render = (parts: readonly Part[], count: number | null): string => parts.map((part) => {
    switch (part.kind) {
      case "text": return part.text;
      case "pound": return count === null ? "#" : String(count);
      case "arg": return String(value(part.name));
      case "select": {
        const key = String(value(part.name));
        return render(part.branches[key] ?? part.branches.other!, count);
      }
      case "plural": {
        const raw = value(part.name);
        const number = typeof raw === "number" ? raw : Number(raw);
        const exact = part.branches[`=${number}`];
        const key = number === 1 ? "one" : "other";
        return render(exact ?? part.branches[key] ?? part.branches.other!, number);
      }
    }
  }).join("");
  return render(parseNoticeTemplate(template), null);
}
