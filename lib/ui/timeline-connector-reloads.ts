"use client";

// Ticket 238: one manual Timeline reload across independent connector sources.
// Each source registers its own reload and reports whether it finished current;
// one source failing never prevents the others from reloading.
const TIMELINE_RELOADS = new Set<() => Promise<boolean>>();

export function registerTimelineConnectorReload(reload: () => Promise<boolean>): () => void {
  TIMELINE_RELOADS.add(reload);
  return () => { TIMELINE_RELOADS.delete(reload); };
}

export async function reloadWebTimelineConnectors(): Promise<boolean> {
  const results = await Promise.allSettled([...TIMELINE_RELOADS].map((reload) => reload()));
  return results.every((result) => result.status === "fulfilled" && result.value);
}
