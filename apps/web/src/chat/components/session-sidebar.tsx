import type { Identity, Session } from "@analytics/contracts";
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
import { GoogleSignIn } from "./google-sign-in.tsx";

/**
 * Renders the session list sidebar and its selection controls.
 *
 * @param props - Component props.
 * @param props.sessions - Saved sessions to list.
 * @param props.selected - Selected session id.
 * @param props.respondingSessionIds - Sessions with live responses.
 * @param props.identity - Signed-in identity.
 * @param props.onLogout - Callback that signs out.
 * @param props.choose - Callback that selects a session.
 * @returns The rendered sidebar.
 */
export function SessionSidebar({
  sessions,
  selected,
  respondingSessionIds,
  identity,
  onLogout,
  choose,
}: {
  sessions: Session[];
  selected: string | null;
  respondingSessionIds: string[];
  identity: Identity;
  onLogout: () => void;
  choose: (id: string | null) => void;
}) {
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
            {sessions.map((entry) => (
              <SidebarMenuItem key={entry.id}>
                <SidebarMenuButton
                  isActive={selected === entry.id}
                  onClick={() => select(entry.id)}
                  title={entry.title}
                  aria-label={entry.title}
                >
                  <span className="truncate">{entry.title}</span>
                  {(respondingSessionIds.includes(entry.id) || entry.runningTurn) && (
                    <span
                      aria-label="Responding"
                      className="ml-auto size-1.5 shrink-0 bg-primary"
                    />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {!sessions.length && (
            <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
              Your conversations will appear here.
            </p>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-5 text-[11px] leading-5 text-muted-foreground">
        <span>
          {identity.kind === "google"
            ? (identity.name ?? identity.email ?? "Google account")
            : "Guest"}
        </span>
        {identity.email && <span className="break-all">{identity.email}</span>}
        {identity.kind === "guest" && <GoogleSignIn className="underline" />}
        <Button type="button" variant="outline" onClick={onLogout}>
          Log out
        </Button>
        GA4 ecommerce sample · Nov 2020–Jan 2021
      </SidebarFooter>
    </Sidebar>
  );
}
