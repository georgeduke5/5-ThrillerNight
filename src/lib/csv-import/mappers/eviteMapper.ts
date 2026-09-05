import type { CsvMapper, MappedGuestCandidate } from "../types";

// Evite's export column names vary slightly between account/export types, so
// each logical field accepts a few known aliases (matched case-insensitively).
const NAME_KEYS = ["name", "guest name", "guest", "primary guest", "full name"];
const ADDITIONAL_GUEST_KEYS = ["guests", "additional guests", "other guests", "party members"];
const RSVP_KEYS = ["rsvp", "response", "rsvp status", "status"];

function findValue(row: Record<string, string>, keys: string[]): string | undefined {
  const lowerMap = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = lowerMap.get(key);
    if (value && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

/**
 * Maps an Evite CSV export to guest candidates. Evite exports don't include
 * a bracket designation, so every candidate comes out with bracket: null —
 * the admin import UI collects that before anything is written through the
 * data access layer.
 */
export const eviteMapper: CsvMapper = {
  id: "evite",
  label: "Evite export",

  detect(headers) {
    const lower = headers.map((h) => h.trim().toLowerCase());
    return NAME_KEYS.some((key) => lower.includes(key));
  },

  map(rows) {
    const candidates: MappedGuestCandidate[] = [];

    for (const row of rows) {
      const nameValue = findValue(row, NAME_KEYS);
      if (!nameValue) continue;

      const primary = splitName(nameValue);
      const rsvpStatus = findValue(row, RSVP_KEYS) ?? "";
      candidates.push({
        firstName: primary.firstName,
        lastName: primary.lastName,
        bracket: null,
        raw: { ...row, __rsvpStatus: rsvpStatus },
      });

      // Evite lets one RSVP cover a whole household; additional names in the
      // party are listed in a separate column with no bracket info either.
      const additional = findValue(row, ADDITIONAL_GUEST_KEYS);
      if (additional) {
        const names = additional
          .split(/[,;]/)
          .map((n) => n.trim())
          .filter(Boolean);
        for (const name of names) {
          const split = splitName(name);
          candidates.push({
            firstName: split.firstName,
            lastName: split.lastName || primary.lastName,
            bracket: null,
            raw: { ...row, __derivedFromParty: nameValue },
          });
        }
      }
    }

    return candidates;
  },
};
