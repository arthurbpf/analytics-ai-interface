import { useSyncExternalStore } from "react";
import { ChartBarIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ChatController } from "./controller.ts";
import { GoogleSignIn } from "./google-sign-in.tsx";

/**
 * Renders the session list sidebar and its selection controls.
 *
 * @param props - Component props.
 * @param props.controller - Controller providing session state.
 * @param props.choose - Callback that selects a session.
 * @returns The rendered sidebar.
 */
export function SessionSidebar({
  controller,
  choose,
}: {
  controller: ChatController;
  choose: (id: string | null) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { setOpenMobile } = useSidebar();
  /**
   * Selects a session and closes the mobile sidebar.
   *
   * @param id - Session id to select, or null for a new analysis.
   */
  const select = (id: string | null) => {
    choose(id);
    setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-6 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ChartBarIcon size={20} /> Ecommerce analytics
        </div>
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          onClick={() => select(null)}
        >
          <PlusIcon /> New chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Previous sessions</SidebarGroupLabel>
          <SidebarMenu>
            {state.index.sessions.map((entry) => (
              <SidebarMenuItem key={entry.id}>
                <SidebarMenuButton
                  isActive={state.selected === entry.id}
                  onClick={() => select(entry.id)}
                  title={entry.label}
                  aria-label={entry.label}
                >
                  <span className="truncate">{entry.label}</span>
                  {(state.responses[entry.id] || entry.runningTurn) && (
                    <span
                      aria-label="Responding"
                      className="ml-auto size-1.5 shrink-0 bg-primary"
                    />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {!state.index.sessions.length && (
            <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
              Your conversations will appear here.
            </p>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-5 text-[11px] leading-5 text-muted-foreground">
        <span>
          {state.identity?.kind === "google"
            ? (state.identity.name ?? state.identity.email ?? "Google account")
            : "Guest"}
        </span>
        {state.identity?.email && <span className="break-all">{state.identity.email}</span>}
        {state.identity?.kind === "guest" && <GoogleSignIn className="underline" />}
        <Button type="button" variant="outline" onClick={controller.logout}>
          Log out
        </Button>
        GA4 ecommerce sample · Nov 2020–Jan 2021
      </SidebarFooter>
    </Sidebar>
  );
}
