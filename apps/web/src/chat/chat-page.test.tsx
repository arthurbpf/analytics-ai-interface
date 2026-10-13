import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "@tanstack/react-router";
import { expect, it, vi } from "vitest";
import type { StreamEvent } from "@analytics/contracts";
import type { ChatApi } from "./api/chat-api.ts";
import { ChatPage } from "./chat-page.tsx";
import { chart, draftId, sessionId, turnId } from "./testing/chat-fixtures.ts";
import {
  createChatTestApi,
  createChatTestProvider,
  createChatTestRouter,
} from "./testing/chat-test-provider.tsx";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

it("enters as a guest, submits once in StrictMode, and displays saved output", async () => {
  const { api, saved } = createChatTestApi();
  api.identity = vi.fn(async () => null);
  const clarification = { context: "Specify a period.", questions: ["Which month?"] };
  api.turn = vi.fn(async function* (
    input: Parameters<ChatApi["turn"]>[0],
  ): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "clarification_ready", turnId, clarification };
    saved.messages = [
      { id: input.body.clientTurnId, turnId, content: { kind: "user", text: input.body.message } },
      { id: draftId, turnId, content: { kind: "clarification", clarification } },
    ];
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  const { wrapper, client } = createChatTestProvider(api);
  const router = createChatTestRouter(ChatPage);
  const view = render(<RouterProvider router={router} />, { wrapper });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Continue as guest" }));
  const input = await screen.findByRole("textbox", { name: "Ask an analytics question" });
  await user.type(input, "Compare purchases{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(),
  );
  expect(await screen.findAllByText("Which month?")).toHaveLength(1);
  expect(input).toHaveValue("");
  expect(api.createSession).toHaveBeenCalledOnce();
  expect(api.turn).toHaveBeenCalledOnce();
  expect(router.state.location.search.session).toBe(sessionId);
  await user.click(screen.getByRole("button", { name: "Log out" }));
  expect(await screen.findByRole("button", { name: "Continue as guest" })).toBeInTheDocument();
  expect(screen.queryByText("Which month?")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(client.getQueriesData({ queryKey: ["chat", draftId] })).toHaveLength(0),
  );
  view.unmount();
  client.clear();
});

it("retains published output after a disconnected stream and failed history reload", async () => {
  const { api } = createChatTestApi();
  api.history = vi.fn(async () => {
    throw new Error("History unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart("table") };
  });
  const { wrapper, client } = createChatTestProvider(api);
  const router = createChatTestRouter(ChatPage);
  const view = render(<RouterProvider router={router} />, { wrapper });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox"), "Purchases{Enter}");
  expect(await screen.findByTestId("chart-table")).toBeInTheDocument();
  expect(await screen.findByText(/Connection ended before completion/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(),
  );
  expect(screen.getAllByTestId("chart-table")).toHaveLength(1);
  expect(api.turn).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox")).not.toBeDisabled();
  view.unmount();
  client.clear();
});
