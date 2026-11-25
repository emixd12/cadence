import catalog from "./catalog.json";

/** The advisor avatar's catalog: its drawing files and anchors, states, gestures and experiments. */
export const advisorAvatarCatalog = catalog;
export const advisorAvatarArt = catalog.art;

export type AdvisorAvatarRendition = (typeof catalog.art.renditions)[number];

/**
 * The shipped file for a size in CSS pixels on a screen of the given density.
 * A product size (40, 48, 60, 72, 120) has a file per density, made at exactly its pixels; the
 * densest one serves denser screens. Any other size gets the general file.
 */
export function advisorAvatarRendition(size: number, density = 2): AdvisorAvatarRendition {
  const renditions = catalog.art.renditions;
  const sized = renditions.filter((item) => item.size === size).sort((a, b) => (a.density ?? 0) - (b.density ?? 0));
  if (sized.length === 0) return renditions.find((item) => item.size === null) ?? renditions[renditions.length - 1];
  return sized.find((item) => (item.density ?? 0) >= density) ?? sized[sized.length - 1];
}

/** That file as a public path ("/brand/advisor/…"). */
export function advisorAvatarFile(size: number, density = 2): string {
  return advisorAvatarRendition(size, density).file.replace(/^public/, "");
}
