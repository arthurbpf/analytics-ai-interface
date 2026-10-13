import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearch } from "@tanstack/react-router";
import { ChartBarIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "./composer.tsx";
import { ChatController } from "./controller.ts";
import { GoogleSignIn } from "./google-sign-in.tsx";
import { SessionSidebar } from "./session-sidebar.tsx";
import { Transcript } from "./transcript.tsx";
import { useChatLifecycle } from "./use-chat-lifecycle.ts";
import { useSessionRouting } from "./use-session-routing.ts";

const maxPromptLength = 8000;
/**
 * Renders the signed-out gate with login and guest options.
 *
 * @param props - Component props.
 * @param props.ready - Whether the identity request has completed.
 * @param props.error - Current error message, if any.
 * @param props.loginError - Login failure message, if any.
 * @param props.onGuest - Callback that starts a guest session.
 * @returns The rendered sign-in gate.
 */
function AuthGate({
  ready,
  error,
  loginError,
  onGuest,
}: {
  ready: boolean;
  error: string | null;
  loginError: string | null;
  onGuest: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6">
      <h1 className="text-2xl font-medium">Ecommerce analytics</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        Explore the GA4 ecommerce sample with private conversations.
      </p>
      {error && <p role="alert">{error}</p>}
      {loginError && <p role="alert">{loginError}</p>}
      {ready ? (
        <>
          <GoogleSignIn className="border px-4 py-3 text-center text-sm" />
          <Button type="button" variant="outline" onClick={onGuest}>
            Continue as guest
          </Button>
        </>
      ) : (
        <p>Loading account…</p>
      )}
    </main>
  );
}
/**
 * Renders the empty-state prompt suggestions.
 *
 * @param props - Component props.
 * @param props.onSubmit - Callback that submits a suggested prompt.
 * @returns The rendered empty state.
 */
function EmptyState({ onSubmit }: { onSubmit: (text: string) => void }) {
  const suggestions = [
    "How did revenue change over November 2020?",
    "Compare purchases by device category.",
  ];
  return (
    <div className="py-16 md:py-24">
      <ChartBarIcon size={32} className="mb-6" />
      <h2 className="text-2xl font-medium tracking-tight">Explore your ecommerce data.</h2>
      <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
        Ask a question, inspect the charts, and follow up. Each analysis uses the GA4 ecommerce
        sample.
      </p>
      <div className="mt-8 grid gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            variant="outline"
            className="h-auto justify-start whitespace-normal py-3 text-left"
            onClick={() => onSubmit(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}
/**
 * Renders the dismissible status and error banner.
 *
 * @param props - Component props.
 * @param props.warning - Storage warning message, if any.
 * @param props.error - Current error message, if any.
 * @param props.navigationError - URL synchronization error, if any.
 * @param props.loginError - Login failure message, if any.
 * @param props.onReload - Callback that reloads saved history.
 * @returns The rendered banner, or null when there is nothing to show.
 */
function StatusAlerts({
  warning,
  error,
  navigationError,
  loginError,
  onReload,
}: {
  warning: string | null;
  error: string | null;
  navigationError: string | null;
  loginError: string | null;
  onReload: () => void;
}) {
  if (!warning && !error && !navigationError && !loginError) {
    return null;
  }
  return (
    <Alert variant={error ? "destructive" : "default"}>
      <AlertDescription>
        {error ?? navigationError ?? loginError ?? warning}
        <Button type="button" variant="link" onClick={onReload}>
          Reload saved history
        </Button>
      </AlertDescription>
    </Alert>
  );
}
/**
 * Renders the full chat experience: sidebar, transcript, composer, and charts.
 *
 * @returns The rendered chat page.
 */
export function ChatPage() {
  const { login } = useSearch({ from: "/" });
  const [controller] = useState(() => new ChatController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [input, setInput] = useState("");
  const resetInput = useCallback(() => setInput(""), []);
  const { navigationError, select } = useSessionRouting(controller, resetInput);
  const loginError =
    login === "failed" ? "Google login failed. Your guest chats are still available." : null;
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const history = state.selected ? state.histories[state.selected] : undefined;
  const active = state.selected ? (state.responses[state.selected] ?? null) : null;
  const hasRunningTurn = history?.turns.some((turn) => turn.status === "running") ?? false;
  const disabled = Boolean(active || state.creating || state.loading || hasRunningTurn);
  const label =
    state.index.sessions.find((entry) => entry.id === state.selected)?.label ?? "New analysis";
  const empty = !state.loading && !history?.messages.length && !active && !state.error;
  /**
   * Selects a session and resets the composer and scroll position.
   *
   * @param id - Session id to select, or null for a new analysis.
   */
  const choose = (id: string | null) => {
    setInput("");
    nearBottom.current = true;
    setShowJump(false);
    select(id);
  };
  /**
   * Scrolls the transcript to its latest content.
   */
  const jumpToLatest = () => {
    const element = viewport.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      nearBottom.current = true;
      setShowJump(false);
    }
  };
  /**
   * Sends a prompt when it is non-empty and the page is idle.
   *
   * @param text - Prompt text to submit.
   */
  const submit = (text: string) => {
    if (disabled || !text.trim() || text.trim().length > maxPromptLength) {
      return;
    }
    controller.send(text);
    setInput("");
  };
  useChatLifecycle(controller);
  useEffect(() => {
    const element = viewport.current;
    if (!history?.messages.length && !active) {
      return;
    }
    if (!element) {
      return;
    }
    if (nearBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [history, active]);
  if (!state.ready || !state.identity) {
    return (
      <AuthGate
        ready={state.ready}
        error={state.error}
        loginError={loginError}
        onGuest={controller.guest}
      />
    );
  }
  return (
    <TooltipProvider>
      <SidebarProvider
        open={state.index.sidebarOpen}
        onOpenChange={controller.setSidebar}
        className="h-dvh min-h-0 overflow-hidden"
      >
        <SessionSidebar controller={controller} choose={choose} />
        <SidebarInset className="min-w-0 flex-1">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
            <SidebarTrigger />
            <h1 className="min-w-0 truncate text-xs font-medium">{label}</h1>
          </header>
          <div
            ref={viewport}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={() => {
              const element = viewport.current;
              if (element) {
                nearBottom.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 100;
                setShowJump(!nearBottom.current);
              }
            }}
          >
            <div className="mx-auto max-w-3xl space-y-7 px-5 py-8 md:px-10">
              <StatusAlerts
                warning={state.warning}
                error={state.error}
                navigationError={navigationError}
                loginError={loginError}
                onReload={controller.reload}
              />
              {state.loading && (
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
            onStop={controller.stop}
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
