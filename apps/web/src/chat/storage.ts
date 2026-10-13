import { z } from "zod";
import { idSchema, type Session } from "@analytics/contracts";

export const storageKey = "analytics.preferences.v2";
const preferencesSchema = z.object({
  version: z.literal(2),
  identityId: idSchema.nullable(),
  selected: idSchema.nullable(),
  sidebarOpen: z.boolean(),
});
export type SessionEntry = Session & { label: string };
export type SessionIndex = z.infer<typeof preferencesSchema> & {
  sessions: SessionEntry[];
};
export const emptyIndex: SessionIndex = {
  version: 2,
  identityId: null,
  sessions: [],
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
 * @returns The stored index and an optional warning when preferences could not be read.
 */
export function readIndex(): { index: SessionIndex; warning: string | null } {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return { index: emptyIndex, warning: null };
    }
    const raw: unknown = JSON.parse(saved);
    const parsed = preferencesSchema.safeParse(raw);
    return {
      index: parsed.success ? { ...parsed.data, sessions: [] } : emptyIndex,
      warning: parsed.success ? null : "Saved preferences were invalid and have been reset.",
    };
  } catch {
    return {
      index: emptyIndex,
      warning: "Browser preferences are unavailable.",
    };
  }
}
/**
 * Persists preferences to local storage.
 *
 * @param index - Index to persist.
 * @returns Null on success, or a warning when browser storage is unavailable.
 */
export function writeIndex(index: SessionIndex): string | null {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferencesSchema.parse(index)));
    return null;
  } catch {
    return "Browser preferences are unavailable.";
  }
}
/**
 * Adds or refreshes a session in the index, keeping it sorted by most recently updated.
 *
 * @param index - Current session index.
 * @param session - Session to insert or update.
 * @returns A new index with the session placed first by update time.
 */
export function remember(index: SessionIndex, session: Session): SessionIndex {
  return {
    ...index,
    sessions: [
      ...index.sessions.filter((entry) => entry.id !== session.id),
      { ...session, label: session.title },
    ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}
