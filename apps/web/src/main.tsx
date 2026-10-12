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
  component: () => <h1>HockeyStack Analytics</h1>,
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
