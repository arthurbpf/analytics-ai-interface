import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChatController } from "./controller.ts";
import type { ChatApi } from "./api.ts";
import { SessionSidebar } from "./session-sidebar.tsx";
import { history } from "./test-fixtures.ts";
import type { Identity, StreamEvent } from "@analytics/contracts";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

/**
 * Builds a ready controller listing the given sessions.
 *
 * @param sessions - Sessions the fake API should return.
 * @returns A controller initialized against the fake API.
 */
async function readyController(sessions = [history().session]) {
  const saved = history();
  const guest: Identity = {
    id: saved.session.id,
    kind: "guest",
    name: null,
    email: null,
  };
  const api: ChatApi = {
    identity: vi.fn(async () => guest),
    guest: vi.fn(async () => guest),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => sessions),
    createSession: vi.fn(async () => saved.session),
    history: vi.fn(async () => saved),
    turn: vi.fn(async function* (): AsyncGenerator<StreamEvent> {}),
  };
  const controller = new ChatController(api);
  controller.initialize();
  await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true));
  return controller;
}

it("lists sessions and selects one", async () => {
  const user = userEvent.setup();
  const controller = await readyController();
  const choose = vi.fn();
  render(
    <SidebarProvider>
      <SessionSidebar controller={controller} choose={choose} />
    </SidebarProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Revenue" }));
  expect(choose).toHaveBeenCalledWith(history().session.id);
  controller.dispose();
});
it("shows an empty state and creates a new chat", async () => {
  const user = userEvent.setup();
  const controller = await readyController([]);
  const choose = vi.fn();
  render(
    <SidebarProvider>
      <SessionSidebar controller={controller} choose={choose} />
    </SidebarProvider>,
  );
  expect(screen.getByText("Your conversations will appear here.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /new chat/i }));
  expect(choose).toHaveBeenCalledWith(null);
  controller.dispose();
});
