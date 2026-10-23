import { digest } from "ohash/crypto";

import { normalizeTravelPlaceText } from "./travel-refresh-policy";

/** Unpadded base64url SHA-256: 43 characters. */
export const TRAVEL_PLACE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The one-way place key of typed place text. It equals the Ticket 214 place-cache
 * `text_key`, so equally normalized texts name the same place on every platform.
 */
export function travelPlaceKey(text: string): string {
  return digest(normalizeTravelPlaceText(text).toWellFormed());
}
