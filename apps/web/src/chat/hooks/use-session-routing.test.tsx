import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { useSessionRouting } from "./use-session-routing.ts";
import { useChatStore } from "../state/chat-provider.tsx";
import {
  createChatTestApi,
  createChatTestProvider,
  createChatTestRouter,
} from "../testing/chat-test-provider.tsx";
import { sessionId } from "../testing/chat-fixtures.ts";
import { storageKey, emptyPreferences } from "../state/chat-preferences.ts";
import { identityQueryKey } from "../api/chat-query-options.ts";

function Probe() {
  const selected = useChatStore((state) => state.selected);
  const reset = useCallback(() => {}, []);
  const { navigationError, select } = useSessionRouting(reset);
  return (
    <>
      <output data-testid="selected">{selected ?? "none"}</output>
      <output data-testid="error">{navigationError ?? "none"}</output>
      <button type="button" onClick={() => select(null)}>
        reset
      </button>
    </>
  );
}

function renderAt(entry: string) {
  const { api } = createChatTestApi();
  const { client, wrapper } = createChatTestProvider(api);
  const router = createChatTestRouter(Probe, entry);
  const view = render(<RouterProvider router={router} />, { wrapper });
  return { ...view, router, client };
}

it("restores the selected session from URL search and clears it for a new chat", async () => {
  const view = renderAt(`/?session=${sessionId}`);
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(sessionId));
  await userEvent.click(screen.getByRole("button", { name: "reset" }));
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
  expect(view.router.state.location.search).toEqual({ session: undefined, login: undefined });
  act(() => {
    view.router.history.back();
  });
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(sessionId));
  act(() => {
    view.router.history.forward();
  });
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
  view.unmount();
  view.client.clear();
});

it("clears the previous account's session URL when the identity changes", async () => {
  const view = renderAt(`/?session=${sessionId}`);
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(sessionId));
  act(() => {
    view.client.setQueryData(identityQueryKey, {
      id: crypto.randomUUID(),
      kind: "google",
      name: "Other",
      email: "other@example.test",
    });
  });
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
  expect(view.router.state.location.search.session).toBeUndefined();
  view.unmount();
  view.client.clear();
});

it("restores an identity-scoped preference into the URL only on initial loading", async () => {
  const { api } = createChatTestApi();
  const identity = await api.identity();
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...emptyPreferences, identityId: identity?.id, selected: sessionId }),
  );
  const view = renderAt("/");
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(sessionId));
  expect(view.router.state.location.search).toEqual({ session: sessionId, login: undefined });
  await userEvent.click(screen.getByRole("button", { name: "reset" }));
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
  view.unmount();
  view.client.clear();
});
