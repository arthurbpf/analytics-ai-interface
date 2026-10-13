import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SessionSidebar } from "./session-sidebar.tsx";
import { history } from "../testing/chat-fixtures.ts";
import { guestIdentity } from "../testing/chat-test-provider.tsx";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function setup(sessions = [history().session]) {
  const choose = vi.fn();
  const onLogout = vi.fn();
  render(
    <SidebarProvider>
      <SessionSidebar
        sessions={sessions}
        selected={null}
        respondingSessionIds={[]}
        identity={guestIdentity}
        choose={choose}
        onLogout={onLogout}
      />
    </SidebarProvider>,
  );
  return { choose, onLogout };
}
it("lists sessions and selects one", async () => {
  const user = userEvent.setup();
  const { choose } = setup();
  await user.click(screen.getByRole("button", { name: "Revenue" }));
  expect(choose).toHaveBeenCalledWith(history().session.id);
});
it("shows an empty state and creates a new chat", async () => {
  const user = userEvent.setup();
  const { choose } = setup([]);
  expect(screen.getByText("Your conversations will appear here.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /new chat/i }));
  expect(choose).toHaveBeenCalledWith(null);
});
it("signs out through its supplied action", async () => {
  const { onLogout } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});
