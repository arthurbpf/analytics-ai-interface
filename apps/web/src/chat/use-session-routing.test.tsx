import { render, screen, waitFor } from "@testing-library/react";
import { useCallback, useSyncExternalStore } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it, vi } from "vitest";
import { ChatController } from "./controller.ts";
import type { ChatApi } from "./api.ts";
import { useSessionRouting } from "./use-session-routing.ts";
import { history, sessionId } from "./test-fixtures.ts";
import type { Identity, StreamEvent } from "@analytics/contracts";

/**
 * Renders the routing hook's selected session for assertions.
 *
 * @param props - Component props.
 * @param props.controller - Controller under test.
 * @returns The rendered probe.
 */
function Probe({ controller }: { controller: ChatController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const reset = useCallback(() => {}, []);
  const { navigationError, select } = useSessionRouting(controller, reset);
  return (
    <>
      <output data-testid="selected">{state.selected ?? "none"}</output>
      <output data-testid="error">{navigationError ?? "none"}</output>
      <button type="button" onClick={() => select(null)}>
        reset
      </button>
    </>
  );
}

/**
 * Builds a ready controller backed by the session fixture.
 *
 * @returns A controller initialized against the fake API.
 */
async function readyController() {
  const saved = history();
  const identity: Identity = {
    id: sessionId,
    kind: "guest",
    name: null,
    email: null,
  };
  const api: ChatApi = {
    identity: vi.fn(async () => identity),
    guest: vi.fn(async () => identity),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => [saved.session]),
    createSession: vi.fn(async () => saved.session),
    history: vi.fn(async () => saved),
    turn: vi.fn(async function* (): AsyncGenerator<StreamEvent> {}),
  };
  const controller = new ChatController(api);
  controller.initialize();
  await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true));
  return controller;
}

/**
 * Renders the routing probe inside a memory router at the given entry.
 *
 * @param controller - Controller under test.
 * @param entry - Initial URL entry.
 * @returns The rendered probe.
 */
function renderAt(controller: ChatController, entry: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    validateSearch: (search: Record<string, unknown>) => ({
      session: typeof search["session"] === "string" ? search["session"] : undefined,
    }),
    component: () => <Probe controller={controller} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  render(<RouterProvider router={router} />);
}

it("restores the selected session from the URL search", async () => {
  const controller = await readyController();
  renderAt(controller, `/?session=${sessionId}`);
  await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent(sessionId));
  controller.dispose();
});
