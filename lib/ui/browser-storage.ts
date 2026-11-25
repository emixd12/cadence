/**
 * The one place that touches Web Storage. Reading `localStorage` or `sessionStorage`
 * can throw (blocked site data, some private modes), and both are absent during server
 * rendering and in Node tests. Every other file goes through these helpers; ESLint
 * enforces it (`eslint.config.mjs`).
 *
 * Shared by the Next.js web app and the Mac app (Vite), so this file imports nothing.
 * It reads from `globalThis`, which is `window` in a browser or webview.
 */

type StorageName = "localStorage" | "sessionStorage";

function resolveStorage(name: StorageName): Storage | null {
  try {
    return (globalThis as Partial<Record<StorageName, Storage>>)[name] ?? null;
  } catch {
    return null;
  }
}

/** `localStorage`, or null when it is absent or its getter throws. */
export function getLocalStorage(): Storage | null {
  return resolveStorage("localStorage");
}

/** `sessionStorage`, or null when it is absent or its getter throws. */
export function getSessionStorage(): Storage | null {
  return resolveStorage("sessionStorage");
}

/** The stored value for `key` in `localStorage`, or null when it is missing or storage fails. */
export function readLocalItem(key: string): string | null {
  try {
    return getLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores `value` under `key` in `localStorage`. Returns false when storage is absent or refuses the write. */
export function writeLocalItem(key: string, value: string): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
