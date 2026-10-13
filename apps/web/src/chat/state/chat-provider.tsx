import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Identity } from "@analytics/contracts";
import { chatApi, type ChatApi } from "../api/chat-api.ts";
import { identityQueryOptions, refreshChatIdentity } from "../api/chat-query-options.ts";
import { migrateLegacyPreference, storageKey } from "./chat-preferences.ts";
import {
  createChatRuntime,
  disposeChatRuntime,
  startChatRuntime,
  isCurrentRuntime,
  runChatTask,
  type ChatRuntime,
} from "./chat-runtime.ts";
import type { ChatStoreState } from "./chat-store.ts";

interface ChatContextValue {
  runtime: ChatRuntime;
  identity: Identity | null;
  ready: boolean;
  identityError: string | null;
  clearIdentityError: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Provides private chat state and synchronizes credentials across browser tabs.
 *
 * @param props - Provider configuration.
 * @param props.children - Chat UI consuming the runtime.
 * @param props.api - Injectable transport, defaulting to the browser API.
 * @returns The chat context provider.
 */
export function ChatProvider({ children, api = chatApi }: { children: ReactNode; api?: ChatApi }) {
  const client = useQueryClient();
  const identityQuery = useQuery(identityQueryOptions(api));
  const identity = identityQuery.data ?? null;
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const runtime = useMemo(
    () => createChatRuntime(api, client, identity?.id ?? null, setCredentialError),
    [api, client, identity?.id],
  );
  useEffect(() => {
    startChatRuntime(runtime);
    migrateLegacyPreference();
    return () => runChatTask(runtime, disposeChatRuntime(runtime));
  }, [runtime]);
  useEffect(() => {
    /**
     * Refreshes credentials first, then the current identity's saved data.
     */
    const synchronize = async () => {
      await refreshChatIdentity(client, api);
      if (isCurrentRuntime(runtime)) {
        await client.invalidateQueries({ queryKey: runtime.queries.scope });
      }
    };
    const refresh = () => runChatTask(runtime, synchronize());
    /**
     * Synchronizes after shared preferences or credentials change.
     *
     * @param event - Browser storage event.
     */
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storageChanged);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storageChanged);
    };
  }, [api, client, runtime]);
  return (
    <ChatContext.Provider
      value={{
        runtime,
        identity,
        ready: !identityQuery.isPending,
        identityError: identityQuery.error?.message ?? (!identity ? credentialError : null),
        clearIdentityError: () => setCredentialError(null),
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

/**
 * Reads the chat runtime and current server identity.
 *
 * @returns The chat context.
 * @throws When called outside ChatProvider.
 */
export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("Chat hooks must be used within ChatProvider.");
  }
  return context;
}

/**
 * Subscribes to only the client state needed by a consumer.
 *
 * @param selector - Selects a stable slice of client state.
 * @returns The selected slice.
 */
export function useChatStore<T>(selector: (state: ChatStoreState) => T): T {
  const { runtime } = useChatContext();
  return useStore(runtime.store, selector);
}

/**
 * Subscribes to stream membership without observing background response content.
 *
 * @returns The ids of sessions or provisional turns with live responses.
 */
export function useChatResponseIds(): string[] {
  return useChatStore(useShallow((state) => Object.keys(state.responses)));
}
