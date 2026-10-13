import { useQuery } from "@tanstack/react-query";
import { useChatContext, useChatStore } from "../state/chat-provider.tsx";

/**
 * Loads selected history while a stream independently supplies live output.
 *
 * @returns The selected history query and its live display state.
 */
export function useChatHistory() {
  const { runtime } = useChatContext();
  const selected = useChatStore((state) => state.selected);
  const active = useChatStore((state) => (selected ? state.responses[selected] : undefined));
  const query = useQuery({
    ...runtime.queries.history(selected ?? ""),
    enabled: Boolean(runtime.identityId && selected),
    staleTime: active ? Infinity : 0,
    refetchInterval: (entry) =>
      !active && entry.state.data?.turns.some((turn) => turn.status === "running") ? 2000 : false,
  });
  return {
    ...query,
    active: active ?? null,
    loading: Boolean(selected && query.isPending),
    running: query.data?.turns.some((turn) => turn.status === "running") ?? false,
  };
}
