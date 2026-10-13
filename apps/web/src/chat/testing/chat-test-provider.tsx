import { StrictMode, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouteComponent,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { idSchema, type Identity, type StreamEvent } from "@analytics/contracts";
import type { ChatApi } from "../api/chat-api.ts";
import { ChatProvider, useChatContext } from "../state/chat-provider.tsx";
import { useChatIdentity } from "../hooks/use-chat-identity.ts";
import { useChatSessions } from "../hooks/use-chat-sessions.ts";
import { useChatHistory } from "../hooks/use-chat-history.ts";
import { useChatActions } from "../hooks/use-chat-actions.ts";
import { draftId, history, turnId } from "./chat-fixtures.ts";

export const guestIdentity: Identity = { id: draftId, kind: "guest", name: null, email: null };

/**
 * Builds a scripted transport whose methods can be overridden by a test.
 *
 * @returns The API and its saved-history fixture.
 */
export function createChatTestApi() {
  const saved = history();
  const api: ChatApi = {
    identity: vi.fn(async () => guestIdentity),
    guest: vi.fn(async () => guestIdentity),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => [saved.session]),
    createSession: vi.fn(async () => saved.session),
    history: vi.fn(async () => saved),
    turn: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "turn_started", turnId };
      yield { type: "turn_finished", turnId, status: "completed", error: null };
    }),
  };
  return { saved, api };
}

/**
 * Creates isolated provider instances for hooks and page tests.
 *
 * @param api - Scripted API.
 * @returns The query client and StrictMode wrapper.
 */
export function createChatTestProvider(api: ChatApi) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  /**
   * Mounts children in isolated chat and query providers.
   *
   * @param props - Wrapper props.
   * @param props.children - Test content.
   * @returns The provider tree.
   */
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ChatProvider api={api}>{children}</ChatProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  return { client, wrapper };
}

/**
 * Mounts production hooks together and exposes synchronous test actions.
 *
 * @param api - Scripted API.
 * @returns Hook results, query client, and actions wrapped in act.
 */
export function renderChatHooks(api: ChatApi) {
  const { client, wrapper } = createChatTestProvider(api);
  const view = renderHook(
    () => {
      const context = useChatContext();
      const identity = useChatIdentity();
      const sessions = useChatSessions();
      const historyQuery = useChatHistory();
      const actions = useChatActions();
      return { ...context, ...identity, sessions, history: historyQuery, actions };
    },
    { wrapper },
  );
  return {
    client,
    result: view.result,
    unmount: view.unmount,
    send: (text: string) =>
      act(() => {
        view.result.current.actions.send(text);
      }),
    select: (id: string | null) =>
      act(() => view.result.current.runtime.store.getState().select(id)),
    stop: () => act(() => view.result.current.actions.stop()),
    reload: () => act(() => view.result.current.actions.reload()),
    synchronize: () =>
      act(() => {
        window.dispatchEvent(new Event("focus"));
      }),
    logout: () => act(() => view.result.current.logout()),
    guest: () => act(() => view.result.current.guest()),
  };
}

export type ChatTestHarness = ReturnType<typeof renderChatHooks>;

/**
 * Builds a memory router matching the production chat route's search fields.
 *
 * @param component - Component rendered at the chat route.
 * @param entry - Initial URL.
 * @returns The memory router.
 */
export function createChatTestRouter(component: RouteComponent, entry = "/") {
  const rootRoute = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    validateSearch: (search: Record<string, unknown>) => {
      const parsed = idSchema.safeParse(search["session"]);
      return {
        session: parsed.success ? parsed.data : undefined,
        login: search["login"] === "failed" ? "failed" : undefined,
      };
    },
    component,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
}
