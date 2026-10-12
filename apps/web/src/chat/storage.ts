import { z } from "zod";
import { idSchema } from "@analytics/contracts";

export const storageKey = "analytics.sessions.v1";
const entrySchema = z.object({
  id: idSchema,
  label: z.string().max(60),
  updatedAt: z.iso.datetime(),
});
const indexSchema = z.object({
  version: z.literal(1),
  sessions: z.array(entrySchema),
  selected: idSchema.nullable(),
  sidebarOpen: z.boolean(),
});
export type SessionEntry = z.infer<typeof entrySchema>;
export type SessionIndex = z.infer<typeof indexSchema>;
export const emptyIndex: SessionIndex = {
  version: 1,
  sessions: [],
  selected: null,
  sidebarOpen: true,
};
export function readIndex(): { index: SessionIndex; warning: string | null } {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return { index: emptyIndex, warning: null };
    }
    const raw: unknown = JSON.parse(saved);
    const parsed = indexSchema.safeParse(raw);
    return {
      index: parsed.success ? parsed.data : emptyIndex,
      warning: parsed.success ? null : "Saved session list was invalid and has been reset.",
    };
  } catch {
    return {
      index: emptyIndex,
      warning: "Browser storage is unavailable. Session history will not persist on this browser.",
    };
  }
}
export function writeIndex(index: SessionIndex): string | null {
  try {
    localStorage.setItem(storageKey, JSON.stringify(index));
    return null;
  } catch {
    return "Browser storage is unavailable. Session history will not persist on this browser.";
  }
}
export function remember(index: SessionIndex, entry: SessionEntry): SessionIndex {
  return {
    ...index,
    sessions: [...index.sessions.filter((item) => item.id !== entry.id), entry].toSorted(
      (left, right) => right.updatedAt.localeCompare(left.updatedAt),
    ),
  };
}
