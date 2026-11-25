import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalStorage, getSessionStorage, readLocalItem, writeLocalItem } from "@/lib/ui/browser-storage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

/** Defines a storage global whose getter throws, as blocked site data does. */
function throwingGetter(name: "localStorage" | "sessionStorage") {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new DOMException("The operation is insecure.", "SecurityError"); },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

describe("browser storage helper", () => {
  it("returns the storage objects and reads and writes through them when present", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    expect(getLocalStorage()).toBe(local);
    expect(getSessionStorage()).toBe(session);
    expect(readLocalItem("key")).toBeNull();
    expect(writeLocalItem("key", "value")).toBe(true);
    expect(readLocalItem("key")).toBe("value");
    expect(local.getItem("key")).toBe("value");
  });

  it("returns null and false when the storage getter throws", () => {
    throwingGetter("localStorage");
    throwingGetter("sessionStorage");
    expect(getLocalStorage()).toBeNull();
    expect(getSessionStorage()).toBeNull();
    expect(readLocalItem("key")).toBeNull();
    expect(writeLocalItem("key", "value")).toBe(false);
  });

  it("returns null and false when there is no window and no storage, as during server rendering", () => {
    expect(typeof window).toBe("undefined");
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).sessionStorage;
    expect(getLocalStorage()).toBeNull();
    expect(getSessionStorage()).toBeNull();
    expect(readLocalItem("key")).toBeNull();
    expect(writeLocalItem("key", "value")).toBe(false);
  });

  it("returns false when setItem throws, as a full quota does", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new DOMException("Quota exceeded.", "QuotaExceededError"); };
    vi.stubGlobal("localStorage", storage);
    expect(writeLocalItem("key", "value")).toBe(false);
    expect(readLocalItem("key")).toBeNull();
  });

  it("returns null when getItem throws", () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    vi.stubGlobal("localStorage", storage);
    expect(readLocalItem("key")).toBeNull();
  });
});
