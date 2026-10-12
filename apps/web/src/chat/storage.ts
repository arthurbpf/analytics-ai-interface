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
export type SessionIndex = z.infer<typeof preferencesSchema> & { sessions: SessionEntry[] };
export const emptyIndex: SessionIndex = {
  version: 2,
  identityId: null,
  sessions: [],
  selected: null,
  sidebarOpen: true,
};
export function readIndex(): { index: SessionIndex; warning: string | null } {
  try {
    localStorage.removeItem("analytics.sessions.v1");
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
    return { index: emptyIndex, warning: "Browser preferences are unavailable." };
  }
}
export function writeIndex(index: SessionIndex): string | null {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferencesSchema.parse(index)));
    return null;
  } catch {
    return "Browser preferences are unavailable.";
  }
}
export function remember(index: SessionIndex, session: Session): SessionIndex {
  return {
    ...index,
    sessions: [
      ...index.sessions.filter((entry) => entry.id !== session.id),
      { ...session, label: session.title },
    ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}
