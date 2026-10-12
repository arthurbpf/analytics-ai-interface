import {
  historySchema,
  turnRequestSchema,
  type Analysis,
  type PublishedChart,
  type SessionHistory,
  type StreamEvent,
} from "@analytics/contracts";
import { ApiFailure, chatApi, type ChatApi } from "./api.ts";
import { readIndex, remember, writeIndex, type SessionIndex } from "./storage.ts";

type ActiveResponse = {
  sessionId: string | null;
  label: string;
  turnId: string | null;
  text: string;
  clientTurnId: string;
  controller: AbortController;
  charts: PublishedChart[];
  analysis: Analysis | null;
  draft: { id: string; text: string } | null;
  progress: string;
  finished: boolean;
};
export interface ChatState {
  index: SessionIndex;
  selected: string | null;
  histories: Record<string, SessionHistory>;
  active: ActiveResponse | null;
  loading: boolean;
  error: string | null;
  warning: string | null;
}

export class ChatController {
  private listeners = new Set<() => void>();
  private generation = 0;
  private revisions = new Map<string, number>();
  private poll: ReturnType<typeof setTimeout> | undefined;
  private state: ChatState;
  constructor(private readonly api: ChatApi = chatApi) {
    const { index, warning } = readIndex();
    this.state = {
      index,
      warning,
      selected: null,
      histories: {},
      active: null,
      loading: false,
      error: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
  private save(index: SessionIndex) {
    // Merge discoveries from another tab before writing preferences.
    const saved = readIndex();
    const merged = {
      ...index,
      sessions: saved.index.sessions
        .reduce((sessions, entry) => {
          return sessions.some((item) => item.id === entry.id) ? sessions : [...sessions, entry];
        }, index.sessions)
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
    const warning = writeIndex(merged);
    this.update({ index: merged, ...(warning ? { warning } : {}) });
  }
  private report = (error: unknown) => {
    this.update({ error: error instanceof Error ? error.message : "Request could not complete." });
  };
  synchronize = () => {
    const saved = readIndex();
    this.update({
      index: { ...saved.index, selected: this.state.selected },
      warning: saved.warning,
    });
  };
  setSidebar = (sidebarOpen: boolean) => {
    this.save({ ...this.state.index, sidebarOpen });
  };
  select = (id: string | null) => {
    this.generation++;
    clearTimeout(this.poll);
    this.update({ selected: id, loading: Boolean(id && !this.state.histories[id]), error: null });
    this.save({ ...this.state.index, selected: id });
    if (id) {
      this.load(id, this.generation).then(() => {}, this.report);
    }
  };
  reload = () => {
    this.update({ error: null });
    if (this.state.selected) {
      this.load(this.state.selected, this.generation).then(() => {}, this.report);
    }
  };
  private async load(id: string, generation: number) {
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    try {
      const history = await this.api.history(id);
      if (
        generation !== this.generation ||
        id !== this.state.selected ||
        revision !== this.revisions.get(id)
      ) {
        return;
      }
      this.update({ histories: { ...this.state.histories, [id]: history }, loading: false });
      const prompt = history.messages.find((message) => message.content.kind === "user");
      const label = prompt?.content.kind === "user" ? prompt.content.text.slice(0, 60) : "New chat";
      this.save(remember(this.state.index, { id, label, updatedAt: history.session.updatedAt }));
      if (
        history.turns.some((turn) => turn.status === "running") &&
        this.state.active?.sessionId !== id
      ) {
        clearTimeout(this.poll);
        this.poll = setTimeout(() => {
          this.load(id, generation).then(() => {}, this.report);
        }, 2000);
      }
    } catch (error) {
      if (
        generation !== this.generation ||
        id !== this.state.selected ||
        revision !== this.revisions.get(id)
      ) {
        return;
      }
      if (error instanceof ApiFailure && error.status === 404) {
        const index = {
          ...this.state.index,
          sessions: this.state.index.sessions.filter((entry) => entry.id !== id),
        };
        this.update({ index });
        const warning = writeIndex(index);
        if (warning) {
          this.update({ warning });
        }
      }
      this.update({ loading: false });
      this.report(error);
    }
  }
  send = (text: string) => {
    const history = this.state.selected ? this.state.histories[this.state.selected] : undefined;
    if (
      this.state.active ||
      this.state.loading ||
      history?.turns.some((turn) => turn.status === "running")
    ) {
      return;
    }
    const parsed = turnRequestSchema.safeParse({
      message: text,
      clientTurnId: crypto.randomUUID(),
    });
    if (!parsed.success) {
      this.update({ error: "Enter a question of 1–8,000 characters." });
      return;
    }
    const active: ActiveResponse = {
      sessionId: this.state.selected,
      label: parsed.data.message.slice(0, 60),
      turnId: null,
      text: parsed.data.message,
      clientTurnId: parsed.data.clientTurnId,
      controller: new AbortController(),
      charts: [],
      analysis: null,
      draft: null,
      progress: "Starting analysis",
      finished: false,
    };
    this.update({ active, error: null });
    this.submit(active, this.generation).then(() => {}, this.report);
  };
  stop = () => {
    this.state.active?.controller.abort();
  };
  private event(active: ActiveResponse, event: StreamEvent) {
    if (event.type !== "turn_started" && active.turnId !== event.turnId) {
      throw new Error("Stream contained a different turn.");
    }
    switch (event.type) {
      case "turn_started":
        active.turnId = event.turnId;
        break;
      case "progress":
        active.progress = event.message;
        break;
      case "chart_ready":
        if (!active.charts.some((chart) => chart.id === event.chart.id)) {
          active.charts.push(event.chart);
        }
        break;
      case "analysis_started":
        active.draft = { id: event.draftId, text: "" };
        break;
      case "analysis_delta":
        if (active.draft?.id !== event.draftId) {
          throw new Error("Unexpected narrative draft.");
        }
        if (active.draft.text.length + event.delta.length > 16000) {
          throw new Error("Narrative exceeded its limit.");
        }
        active.draft.text += event.delta;
        break;
      case "analysis_discarded":
        if (active.draft?.id === event.draftId) {
          active.draft = null;
        }
        break;
      case "analysis_ready":
        active.analysis = event.analysis;
        active.draft = null;
        break;
      case "turn_finished":
        active.finished = true;
        active.draft = null;
        if (event.error) {
          this.update({ error: event.error.message });
        }
        break;
    }
    this.update({ active: { ...active } });
  }
  private async submit(active: ActiveResponse, generation: number) {
    let failure: string | null = null;
    try {
      if (!active.sessionId) {
        const session = await this.api.createSession();
        active.sessionId = session.id;
        this.update({
          histories: {
            ...this.state.histories,
            [session.id]: historySchema.parse({ session, turns: [], messages: [] }),
          },
        });
        this.save(
          remember(this.state.index, {
            id: session.id,
            label: active.label,
            updatedAt: session.updatedAt,
          }),
        );
        if (this.state.selected === null && generation === this.generation) {
          this.update({ selected: session.id });
          this.save({ ...this.state.index, selected: session.id });
        }
      }
      active.controller.signal.throwIfAborted();
      this.save(
        remember(this.state.index, {
          id: active.sessionId,
          label:
            this.state.index.sessions.find((item) => item.id === active.sessionId)?.label ??
            active.label,
          updatedAt: new Date().toISOString(),
        }),
      );
      for await (const event of this.api.turn(
        {
          params: { id: active.sessionId },
          body: { message: active.text, clientTurnId: active.clientTurnId },
        },
        active.controller.signal,
      )) {
        this.event(active, event);
      }
      if (!active.finished) {
        throw new Error("Connection ended before completion. Saved history has been reloaded.");
      }
    } catch (error) {
      failure = active.controller.signal.aborted
        ? "Analysis stopped. Saved artifacts are retained."
        : error instanceof Error
          ? error.message
          : "Connection failed. Reload saved history before sending again.";
    } finally {
      active.controller.abort();
      active.draft = null;
      if (active.sessionId) {
        this.revisions.set(active.sessionId, (this.revisions.get(active.sessionId) ?? 0) + 1);
        try {
          const history = await this.api.history(active.sessionId);
          this.update({ histories: { ...this.state.histories, [active.sessionId]: history } });
        } catch (error) {
          failure ??= error instanceof Error ? error.message : "Could not reload saved history.";
          const cached = this.state.histories[active.sessionId];
          const turnId = active.turnId;
          if (cached && turnId) {
            const messages = [...cached.messages];
            if (
              !messages.some(
                (message) => message.turnId === turnId && message.content.kind === "user",
              )
            ) {
              messages.push({
                id: active.clientTurnId,
                turnId,
                content: { kind: "user", text: active.text },
              });
            }
            for (const chart of active.charts) {
              if (
                !messages.some(
                  (message) =>
                    message.content.kind === "chart" && message.content.chart.id === chart.id,
                )
              ) {
                messages.push({ id: chart.id, turnId, content: { kind: "chart", chart } });
              }
            }
            if (
              active.analysis &&
              !messages.some(
                (message) => message.turnId === turnId && message.content.kind === "analysis",
              )
            ) {
              messages.push({
                id: crypto.randomUUID(),
                turnId,
                content: { kind: "analysis", analysis: active.analysis },
              });
            }
            this.update({
              histories: { ...this.state.histories, [active.sessionId]: { ...cached, messages } },
            });
          }
        }
      }
      this.update({ active: null, ...(failure ? { error: failure } : {}) });
      const selected = this.state.selected;
      if (
        selected &&
        this.state.histories[selected]?.turns.some((turn) => turn.status === "running")
      ) {
        this.load(selected, this.generation).then(() => {}, this.report);
      }
    }
  }
}
