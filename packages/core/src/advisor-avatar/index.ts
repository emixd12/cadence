import catalog from "./catalog.json";

/** The advisor avatar's catalog: its drawing files and anchors, states, gestures and experiments. */
export const advisorAvatarCatalog = catalog;
export const advisorAvatarArt = catalog.art;

/** The shipped file for a size in CSS pixels, as a public path ("/brand/advisor/…"). */
export function advisorAvatarFile(size: number): string {
  const rendition = catalog.art.renditions.find((item) => item.maxSize === null || size <= item.maxSize) ?? catalog.art.renditions[catalog.art.renditions.length - 1];
  return rendition.file.replace(/^public/, "");
}
