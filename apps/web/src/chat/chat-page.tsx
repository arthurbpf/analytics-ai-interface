import { useCallback, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "./components/auth-gate.tsx";
import { EmptyState } from "./components/chat-empty-state.tsx";
import { StatusAlerts } from "./components/chat-status-alerts.tsx";
import { Composer } from "./components/chat-composer.tsx";
import { SessionSidebar } from "./components/session-sidebar.tsx";
import { Transcript } from "./components/chat-transcript.tsx";
import { useChatIdentity } from "./hooks/use-chat-identity.ts";
import { useChatSessions } from "./hooks/use-chat-sessions.ts";
import { useChatHistory } from "./hooks/use-chat-history.ts";
import { useChatActions } from "./hooks/use-chat-actions.ts";
import { useSessionRouting } from "./hooks/use-session-routing.ts";
import { useTranscriptScroll } from "./hooks/use-transcript-scroll.ts";
import { useChatStore, useChatResponseIds } from "./state/chat-provider.tsx";

const maxPromptLength = 8000;

/**
 * Composes the chat shell from server queries, live state, and presentation.
 *
 * @returns The rendered chat page.
 */
export function ChatPage() {
  const { login } = useSearch({ from: "/" });
  const { identity, ready, identityError, guest, logout } = useChatIdentity();
  const sessions = useChatSessions();
  const historyQuery = useChatHistory();
  const actions = useChatActions();
  const selected = useChatStore((state) => state.selected);
  const respondingSessionIds = useChatResponseIds();
  const creating = useChatStore((state) => state.creating);
  const error = useChatStore((state) => state.error) ?? identityError;
  const warning = useChatStore((state) => state.warning);
  const sidebarOpen = useChatStore((state) => state.preferences.sidebarOpen);
  const setSidebar = useChatStore((state) => state.setSidebar);
  const [input, setInput] = useState("");
  const resetInput = useCallback(() => setInput(""), []);
  const { navigationError, select } = useSessionRouting(resetInput);
  const loginError =
    login === "failed" ? "Google login failed. Your guest chats are still available." : null;
  const history = historyQuery.data;
  const { active, loading } = historyQuery;
  const { viewport, showJump, reset, jumpToLatest, onScroll } = useTranscriptScroll(
    history,
    active,
  );
  const session = sessions.data?.find((entry) => entry.id === selected);
  const running = session?.runningTurn || historyQuery.running;
  const disabled = Boolean(active || creating || loading || running);
  const empty = !loading && !history?.messages.length && !active && !error;
  /**
   * Selects a conversation and resets its composer and scroll following.
   *
   * @param id - Session id, or null for a new chat.
   */
  const choose = (id: string | null) => {
    resetInput();
    reset();
    select(id);
  };
  /**
   * Clears the composer only when its prompt is accepted.
   *
   * @param text - Prompt to submit.
   */
  const submit = (text: string) => {
    if (!disabled && actions.send(text)) {
      setInput("");
    }
  };
  if (!ready || !identity) {
    return <AuthGate ready={ready} error={error} loginError={loginError} onGuest={() => guest()} />;
  }
  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebar}
        className="h-dvh min-h-0 overflow-hidden"
      >
        <SessionSidebar
          sessions={sessions.data ?? []}
          selected={selected}
          respondingSessionIds={respondingSessionIds}
          identity={identity}
          choose={choose}
          onLogout={() => logout()}
        />
        <SidebarInset className="min-w-0 flex-1">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
            <SidebarTrigger />
            <h1 className="min-w-0 truncate text-xs font-medium">
              {session?.title ?? "New analysis"}
            </h1>
          </header>
          <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>
            <div className="mx-auto max-w-3xl space-y-7 px-5 py-8 md:px-10">
              <StatusAlerts
                warning={warning}
                error={error}
                navigationError={navigationError}
                loginError={loginError}
                onReload={actions.reload}
              />
              {loading && (
                <div aria-label="Loading conversation" className="space-y-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              )}
              {empty && <EmptyState onSubmit={submit} />}
              <Transcript history={history} active={active} />
            </div>
          </div>
          <Composer
            value={input}
            maxLength={maxPromptLength}
            disabled={disabled}
            showJump={showJump}
            active={active}
            onChange={setInput}
            onSubmit={() => submit(input)}
            onJump={jumpToLatest}
            onStop={actions.stop}
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
