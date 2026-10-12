import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Analysis, Clarification } from "@analytics/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartBarIcon,
  PlusIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatController } from "./controller.ts";
import { ChartView } from "./charts.tsx";
import { Markdown } from "./markdown.tsx";
import { storageKey } from "./storage.ts";

function ClarificationView({ clarification }: { clarification: Clarification }) {
  return (
    <div className="space-y-4">
      <Markdown>{clarification.context}</Markdown>
      <ol className="list-decimal space-y-2 pl-5">
        {clarification.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
    </div>
  );
}
function AnalysisView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="space-y-4">
      <Markdown>{analysis.narrative}</Markdown>
      {analysis.caveats.length > 0 && (
        <div className="border-l-2 pl-4 text-xs leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Caveats</p>
          <ul className="list-disc pl-4">
            {[...new Set(analysis.caveats)].map((caveat) => (
              <li key={caveat}>
                <Markdown>{caveat}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
function SessionSidebar({
  controller,
  choose,
}: {
  controller: ChatController;
  choose: (id: string | null) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { setOpenMobile } = useSidebar();
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
        {state.identity?.kind === "guest" && (
          <a className="underline" href="/api/auth/google">
            Sign in with Google
          </a>
        )}
        <Button type="button" variant="outline" onClick={controller.logout}>
          Log out
        </Button>
        GA4 ecommerce sample · Nov 2020–Jan 2021
      </SidebarFooter>
    </Sidebar>
  );
}
export function ChatPage() {
  const { session } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const [controller] = useState(() => new ChatController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [input, setInput] = useState("");
  const loginError =
    new URLSearchParams(window.location.search).get("login") === "failed"
      ? "Google login failed. Your guest chats are still available."
      : null;
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const initialized = useRef(false);
  const previousIdentity = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const history = state.selected ? state.histories[state.selected] : undefined;
  const active = state.selected ? (state.responses[state.selected] ?? null) : null;
  const hasRunningTurn = history?.turns.some((turn) => turn.status === "running") ?? false;
  const disabled = Boolean(active || state.creating || state.loading || hasRunningTurn);
  const label =
    state.index.sessions.find((entry) => entry.id === state.selected)?.label ?? "New analysis";
  const choose = (id: string | null) => {
    setInput("");
    nearBottom.current = true;
    setShowJump(false);
    controller.select(id);
    navigate({ search: id ? { session: id } : {} }).then(
      () => {},
      () => {
        setNavigationError("Could not update the session URL.");
      },
    );
  };
  useEffect(() => {
    controller.initialize();
    const refresh = () => controller.synchronize();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (!state.ready) {
      return;
    }
    if (!state.identity) {
      if (previousIdentity.current) {
        initialized.current = false;
        previousIdentity.current = null;
        navigate({ search: {}, replace: true }).then(
          () => {},
          () => setNavigationError("Could not reset the session URL."),
        );
      }
      return;
    }
    if (previousIdentity.current && previousIdentity.current !== state.identity.id) {
      previousIdentity.current = state.identity.id;
      initialized.current = true;
      setInput("");
      controller.select(null);
      navigate({ search: {}, replace: true }).then(
        () => {},
        () => setNavigationError("Could not reset the session URL."),
      );
      return;
    }
    previousIdentity.current = state.identity.id;
    const id = initialized.current
      ? (session ?? null)
      : (session ?? controller.getSnapshot().index.selected);
    initialized.current = true;
    if (
      id !== controller.getSnapshot().selected ||
      (id && !controller.getSnapshot().histories[id])
    ) {
      controller.select(id);
    }
    if (id && !session) {
      navigate({ search: { session: id }, replace: true }).then(
        () => {},
        () => {
          setNavigationError("Could not restore the session URL.");
        },
      );
    }
  }, [controller, navigate, session, state.ready, state.identity]);
  useEffect(() => {
    if (state.selected && state.responses[state.selected] && !session) {
      navigate({ search: { session: state.selected }, replace: true }).then(
        () => {},
        () => {
          setNavigationError("Could not update the session URL.");
        },
      );
    }
  }, [navigate, session, state.selected, state.responses]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        controller.synchronize();
      }
    };
    window.addEventListener("storage", synchronize);
    return () => {
      window.removeEventListener("storage", synchronize);
    };
  }, [controller]);

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
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (disabled || !input.trim() || input.trim().length > 8000) {
      return;
    }
    controller.send(input);
    setInput("");
  };
  if (!state.ready || !state.identity) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6">
        <h1 className="text-2xl font-medium">Ecommerce analytics</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Explore the GA4 ecommerce sample with private conversations.
        </p>
        {state.error && <p role="alert">{state.error}</p>}
        {loginError && <p role="alert">{loginError}</p>}
        {state.ready ? (
          <>
            <a className="border px-4 py-3 text-center text-sm" href="/api/auth/google">
              Sign in with Google
            </a>
            <Button type="button" variant="outline" onClick={controller.guest}>
              Continue as guest
            </Button>
          </>
        ) : (
          <p>Loading account…</p>
        )}
      </main>
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
            <Badge variant="outline" className="ml-auto shrink-0">
              GA4 sample
            </Badge>
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
              {(state.warning || state.error || navigationError || loginError) && (
                <Alert variant={state.error ? "destructive" : "default"}>
                  <AlertDescription>
                    {state.error ?? navigationError ?? loginError ?? state.warning}
                    <Button type="button" variant="link" onClick={controller.reload}>
                      Reload saved history
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {state.loading && (
                <div aria-label="Loading conversation" className="space-y-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              )}
              {!state.loading && !history?.messages.length && !active && !state.error && (
                <div className="py-16 md:py-24">
                  <ChartBarIcon size={32} className="mb-6" />
                  <h2 className="text-2xl font-medium tracking-tight">
                    Explore your ecommerce data.
                  </h2>
                  <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
                    Ask a question, inspect the charts, and follow up. Each analysis uses the GA4
                    ecommerce sample.
                  </p>
                  <div className="mt-8 grid gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-3 text-left"
                      onClick={() => setInput("How did revenue change over November 2020?")}
                    >
                      How did revenue change over November 2020?
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-3 text-left"
                      onClick={() => setInput("Compare purchases by device category.")}
                    >
                      Compare purchases by device category.
                    </Button>
                  </div>
                </div>
              )}
              {history?.messages.map((message) => (
                <div key={message.id}>
                  {message.content.kind === "user" ? (
                    <div className="ml-auto max-w-[90%] border bg-muted px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                      {message.content.text}
                    </div>
                  ) : message.content.kind === "chart" ? (
                    <ChartView chart={message.content.chart} />
                  ) : message.content.kind === "clarification" ? (
                    <ClarificationView clarification={message.content.clarification} />
                  ) : (
                    <AnalysisView analysis={message.content.analysis} />
                  )}
                </div>
              ))}
              {active && (
                <div className="space-y-5">
                  {!history?.messages.some(
                    (message) =>
                      message.turnId === active.turnId && message.content.kind === "user",
                  ) && (
                    <div className="ml-auto max-w-[90%] border bg-muted px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                      {active.text}
                    </div>
                  )}
                  {active.charts
                    .filter(
                      (chart) =>
                        !history?.messages.some(
                          (message) =>
                            message.content.kind === "chart" &&
                            message.content.chart.id === chart.id,
                        ),
                    )
                    .map((chart) => (
                      <ChartView key={chart.id} chart={chart} />
                    ))}
                  {active.draft && (
                    <div data-testid="narrative-draft">
                      <Badge variant="outline">Draft — awaiting validation</Badge>
                      <div className="mt-3">
                        <Markdown>{active.draft.text}</Markdown>
                      </div>
                    </div>
                  )}
                  {active.clarification &&
                    !history?.messages.some(
                      (message) =>
                        message.turnId === active.turnId &&
                        message.content.kind === "clarification",
                    ) && <ClarificationView clarification={active.clarification} />}
                  {active.analysis &&
                    !history?.messages.some(
                      (message) =>
                        message.turnId === active.turnId && message.content.kind === "analysis",
                    ) && <AnalysisView analysis={active.analysis} />}
                  <output aria-live="polite" className="text-xs text-muted-foreground">
                    {active.progress}…
                  </output>
                </div>
              )}
              {!active &&
                history?.turns
                  .filter((turn) => turn.status !== "completed")
                  .map((turn) => (
                    <output key={turn.id} className="text-xs text-muted-foreground">
                      {turn.status === "running"
                        ? "Analysis is still running. Checking saved history…"
                        : (turn.error?.message ??
                          `Analysis ${turn.status}. Saved artifacts are retained.`)}
                    </output>
                  ))}
            </div>
          </div>
          <footer className="shrink-0 border-t bg-background px-5 py-4 md:px-10">
            <div className="mx-auto max-w-3xl">
              {showJump && (
                <Button
                  type="button"
                  variant="outline"
                  className="mb-3"
                  onClick={() => {
                    const element = viewport.current;
                    if (element) {
                      element.scrollTop = element.scrollHeight;
                      nearBottom.current = true;
                      setShowJump(false);
                    }
                  }}
                >
                  <ArrowDownIcon /> Jump to latest
                </Button>
              )}
              {active && (
                <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <output className="truncate">Responding to {active.label}</output>
                  <Button type="button" variant="outline" onClick={controller.stop}>
                    <StopIcon /> Stop
                  </Button>
                </div>
              )}
              <form onSubmit={send} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="question" className="sr-only">
                    Ask an analytics question
                  </label>
                  <Textarea
                    id="question"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask about revenue, purchases, customers…"
                    rows={2}
                    className="max-h-40 resize-none"
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        send();
                      }
                    }}
                    aria-describedby="composer-help"
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send question"
                  disabled={disabled || !input.trim() || input.trim().length > 8000}
                >
                  <ArrowUpIcon />
                </Button>
              </form>
              <p id="composer-help" className="mt-2 text-[10px] leading-5 text-muted-foreground">
                {input.trim().length > 8000
                  ? "Questions must be at most 8,000 characters."
                  : "Enter to send · Shift+Enter for a new line · Sample data may be obfuscated."}
              </p>
            </div>
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
