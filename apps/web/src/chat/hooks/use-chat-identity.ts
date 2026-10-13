import { useMutation } from "@tanstack/react-query";
import { identityQueryKey } from "../api/chat-query-options.ts";
import { useChatContext } from "../state/chat-provider.tsx";
import { isCurrentRuntime, reportChatFailure } from "../state/chat-runtime.ts";
import { emptyPreferences, writePreferences } from "../state/chat-preferences.ts";

/**
 * Exposes identity and non-retryable guest and logout actions.
 *
 * @returns Identity status and synchronous authentication actions.
 */
export function useChatIdentity() {
  const { runtime, identity, ready, identityError, clearIdentityError } = useChatContext();
  const guest = useMutation({
    retry: false,
    mutationFn: async () => {
      runtime.store.setState({ error: null });
      clearIdentityError();
      const next = await runtime.api.guest();
      if (!isCurrentRuntime(runtime)) {
        return;
      }
      await runtime.client.cancelQueries({ queryKey: identityQueryKey });
      if (isCurrentRuntime(runtime)) {
        runtime.client.setQueryData(identityQueryKey, next);
      }
    },
    onError: (error) => reportChatFailure(runtime, error),
  });
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      await runtime.api.logout();
      if (!isCurrentRuntime(runtime)) {
        return;
      }
      await runtime.client.cancelQueries({ queryKey: identityQueryKey });
      if (!isCurrentRuntime(runtime)) {
        return;
      }
      const warning = writePreferences({
        ...emptyPreferences,
        sidebarOpen: runtime.store.getState().preferences.sidebarOpen,
      });
      runtime.store.setState({ warning });
      clearIdentityError();
      runtime.client.setQueryData(identityQueryKey, null);
    },
    onError: (error) => reportChatFailure(runtime, error),
  });
  return { identity, ready, identityError, guest: guest.mutate, logout: logout.mutate };
}
