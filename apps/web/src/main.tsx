// oxlint-disable-next-line import/no-unassigned-import -- Vite loads the application stylesheet for its side effect.
import "./index.css";
import { idSchema } from "@analytics/contracts";
import { ChatPage } from "./chat/page.tsx";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (
    search: Record<string, unknown>,
  ): { session?: string | undefined; login?: "failed" | undefined } => {
    const parsed = idSchema.safeParse(search["session"]);
    return {
      session: parsed.success ? parsed.data : undefined,
      login: search["login"] === "failed" ? "failed" : undefined,
    };
  },
  component: ChatPage,
});
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
