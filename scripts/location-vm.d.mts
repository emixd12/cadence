export function scrubLog(text: string): string[];
export function permissionLine(text: string): string | null;
export function checkboxState(text: string): "on" | "off" | "unknown";

type GuestResponse = { status: number; out: string };
export function checkGuest(state: "never-asked" | "allowed" | "denied", controls: {
  exec: (command: string, timeoutMs?: number) => GuestResponse;
  ax: (...args: string[]) => GuestResponse;
  step?: (key: string, value: string | string[] | null) => void;
  pause?: (ms: number) => void;
  waitUntil?: (test: () => boolean, timeoutMs: number) => boolean;
}): void;
