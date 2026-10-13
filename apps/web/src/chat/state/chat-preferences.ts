import { z } from "zod";
import { idSchema } from "@analytics/contracts";

export const storageKey = "analytics.preferences.v2";
const preferencesSchema = z.object({
  version: z.literal(2),
  identityId: idSchema.nullable(),
  selected: idSchema.nullable(),
  sidebarOpen: z.boolean(),
});
export type ChatPreferences = z.infer<typeof preferencesSchema>;
export const emptyPreferences: ChatPreferences = {
  version: 2,
  identityId: null,
  selected: null,
  sidebarOpen: true,
};
/**
 * Removes the legacy session cache written by earlier versions.
 */
export function migrateLegacyPreference(): void {
  try {
    localStorage.removeItem("analytics.sessions.v1");
  } catch {
    return;
  }
}
/**
 * Reads persisted preferences.
 *
 * @returns The preferences and an optional warning when they could not be read.
 */
export function readPreferences(): { preferences: ChatPreferences; warning: string | null } {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return { preferences: emptyPreferences, warning: null };
    }
    const raw: unknown = JSON.parse(saved);
    const parsed = preferencesSchema.safeParse(raw);
    return {
      preferences: parsed.success ? parsed.data : emptyPreferences,
      warning: parsed.success ? null : "Saved preferences were invalid and have been reset.",
    };
  } catch {
    return {
      preferences: emptyPreferences,
      warning: "Browser preferences are unavailable.",
    };
  }
}
/**
 * Persists preferences to local storage.
 *
 * @param preferences - Preferences to persist.
 * @returns Null on success, or a warning when browser storage is unavailable.
 */
export function writePreferences(preferences: ChatPreferences): string | null {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferencesSchema.parse(preferences)));
    return null;
  } catch {
    return "Browser preferences are unavailable.";
  }
}
