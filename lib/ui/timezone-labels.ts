// Ticket 309. Timezone names read as places ("New York") while the saved
// value stays the IANA name ("America/New_York"). Pure: no browser API.

const REGION_LABELS: Readonly<Record<string, string>> = {
  Africa: "Africa",
  America: "Americas",
  Antarctica: "Antarctica",
  Arctic: "Arctic",
  Asia: "Asia",
  Atlantic: "Atlantic Ocean",
  Australia: "Australia",
  Europe: "Europe",
  Indian: "Indian Ocean",
  Pacific: "Pacific Ocean",
};

const place = (part: string) => part.replaceAll("_", " ");

/**
 * The place a timezone is named after: "America/New_York" reads "New York" and
 * "America/Indiana/Knox" reads "Knox, Indiana". A name outside the place regions
 * ("UTC", "Etc/GMT+5", "US/Eastern") is returned unchanged, because a place label
 * would mislead.
 */
export function timezonePlaceLabel(timeZone: string): string {
  const parts = timeZone.split("/");
  if (parts.length < 2 || !(parts[0] in REGION_LABELS) || parts.some((part) => part === "")) return timeZone;
  const city = place(parts[parts.length - 1]);
  return parts.length > 2 ? `${city}, ${place(parts.slice(1, -1).join(" "))}` : city;
}

/** The region group a timezone belongs to ("Americas"), or null for a name outside the place regions. */
export function timezoneRegionLabel(timeZone: string): string | null {
  const parts = timeZone.split("/");
  return parts.length >= 2 ? REGION_LABELS[parts[0]] ?? null : null;
}

export type TimezoneOption = Readonly<{ value: string; label: string }>;
export type TimezoneOptionGroup = Readonly<{ region: string | null; options: readonly TimezoneOption[] }>;

/**
 * Groups timezones by region for a select. Groups keep the order their regions first
 * appear in; places sort by label inside each group. Names outside the place regions
 * form one ungrouped list (`region: null`) in their given order.
 */
export function groupTimezoneOptions(timeZones: readonly string[]): TimezoneOptionGroup[] {
  const groups = new Map<string | null, TimezoneOption[]>();
  for (const value of timeZones) {
    const region = timezoneRegionLabel(value);
    const group = groups.get(region) ?? [];
    group.push({ value, label: timezonePlaceLabel(value) });
    groups.set(region, group);
  }
  return [...groups].map(([region, options]) => ({
    region,
    options: region === null ? options : [...options].sort((a, b) => a.label.localeCompare(b.label, "en")),
  }));
}
