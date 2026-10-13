import { useChatContext } from "../state/chat-provider.tsx";
import { isCurrentRuntime, runChatTask } from "../state/chat-runtime.ts";
import { sendChatPrompt, stopChatTurn } from "../state/turn-stream.ts";
import { refreshChatIdentity } from "../api/chat-query-options.ts";

/**
 * Exposes prompt, cancellation, and explicit reload actions.
 *
 * @returns Actions bound to the current identity's runtime.
 */
export function useChatActions() {
  const { runtime } = useChatContext();
  /**
   * Reloads credentials and saved data without repeating submitted work.
   */
  const reload = async () => {
    runtime.store.setState({ error: null });
    const selected = runtime.store.getState().selected;
    await refreshChatIdentity(runtime.client, runtime.api);
    if (isCurrentRuntime(runtime)) {
      await runtime.client.invalidateQueries({ queryKey: runtime.queries.sessions.queryKey });
      if (selected && runtime.identityId && isCurrentRuntime(runtime)) {
        const options = runtime.queries.history(selected);
        await runtime.client.cancelQueries({ queryKey: options.queryKey });
        if (isCurrentRuntime(runtime)) {
          await runtime.client.fetchQuery(options);
        }
      }
    }
  };
  return {
    send: (text: string) => sendChatPrompt(runtime, text),
    stop: () => stopChatTurn(runtime),
    reload: () => runChatTask(runtime, reload()),
  };
}
