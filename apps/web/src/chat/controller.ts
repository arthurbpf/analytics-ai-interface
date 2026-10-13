import {
  historySchema,
  turnRequestSchema,
  type Identity,
  type StreamEvent,
} from "@analytics/contracts";
import { ApiFailure, chatApi, type ChatApi } from "./api.ts";
import { hasPendingWork } from "./polling.ts";
import {
  applyEvent,
  createResponse,
  mergePublished,
  type ActiveResponse,
  type ChatState,
} from "./response.ts";
import {
  emptyIndex,
  migrateLegacyPreference,
  readIndex,
  remember,
  writeIndex,
  type SessionIndex,
} from "./storage.ts";

/**
 * Client-side controller owning chat state, streaming turns, and persistence.
 *
 * Exposes an immutable snapshot for React and coordinates identity, session lists,
 * in-flight responses, and cross-tab synchronization.
 */
export class ChatController {
  private readonly api: ChatApi;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private selection = 0;
  private refreshRevision = 0;
  private revisions = new Map<string, number>();
  private poll: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private state: ChatState;
  /**
   * Creates a controller over an API client.
   *
   * @param api - API client used for all requests.
   */
  constructor(api: ChatApi = chatApi) {
    this.api = api;
    migrateLegacyPreference();
    const { index, warning } = readIndex();
    this.state = {
      identity: null,
      ready: false,
      index,
      warning,
      selected: null,
      histories: {},
      responses: {},
      creating: false,
      loading: false,
      error: null,
    };
  }
  /**
   * Returns the current state snapshot for external store consumers.
   *
   * @returns The current chat state.
   */
  getSnapshot = () => this.state;
  /**
   * Registers a state listener.
   *
   * @param listener - Callback invoked when state changes.
   * @returns A function that removes the listener.
   */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /**
   * Merges a partial patch into the state and notifies subscribers.
   *
   * @param patch - Fields to merge into the current state.
   */
  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
  /**
   * Persists an index and surfaces a warning when storage is unavailable.
   *
   * @param index - Index to persist.
   */
  private save(index: SessionIndex) {
    const warning = writeIndex(index);
    this.update({ index, ...(warning ? { warning } : {}) });
  }
  /**
   * Aborts in-flight work and resets state for a new identity.
   *
   * @param identity - Identity to reset to, or null for signed out.
   */
  private reset(identity: Identity | null) {
    this.epoch++;
    this.selection++;
    clearTimeout(this.poll);
    for (const response of Object.values(this.state.responses)) {
      response.controller.abort();
    }
    this.revisions.clear();
    const saved = readIndex();
    const index =
      saved.index.identityId === identity?.id
        ? saved.index
        : {
            ...emptyIndex,
            identityId: identity?.id ?? null,
            sidebarOpen: saved.index.sidebarOpen,
          };
    this.update({
      identity,
      index,
      selected: null,
      histories: {},
      responses: {},
      creating: false,
      loading: false,
      error: null,
    });
  }
  /**
   * Records an error, resetting the session when the credential has expired.
   *
   * @param error - Error to report.
   */
  private report(error: unknown) {
    if (this.disposed) {
      return;
    }
    if (error instanceof ApiFailure && error.status === 401) {
      this.reset(null);
    }
    this.update({
      error: error instanceof Error ? error.message : "Request could not complete.",
    });
  }
  /**
   * Runs a task, routing any rejection to the error reporter.
   *
   * @param task - Task to run in the background.
   */
  private run(task: Promise<void>) {
    void task.then(
      () => {},
      (error: unknown) => this.report(error),
    );
  }
  /**
   * Marks the controller live and loads the initial identity and sessions.
   */
  initialize = () => {
    this.disposed = false;
    this.run(this.refresh());
  };
  /**
   * Reloads identity and sessions, used when another tab changes storage.
   */
  synchronize = () => {
    this.run(this.refresh());
  };
  /**
   * Loads the current identity and session list, resetting on identity change.
   */
  private async refresh() {
    const revision = ++this.refreshRevision;
    try {
      const identity = await this.api.identity();
      if (this.disposed || revision !== this.refreshRevision) {
        return;
      }
      if (identity?.id !== this.state.identity?.id) {
        this.reset(identity);
      }
      this.update({ ready: true });
      if (!identity) {
        return;
      }
      const epoch = this.epoch;
      const sessions = await this.api.listSessions();
      if (this.disposed || revision !== this.refreshRevision || epoch !== this.epoch) {
        return;
      }
      this.update({
        index: {
          ...this.state.index,
          sessions: sessions.map((session) => ({
            ...session,
            label: session.title,
          })),
        },
      });
      this.schedulePoll();
    } catch (error) {
      if (!this.disposed && revision === this.refreshRevision) {
        this.report(error);
      }
    }
  }
  /**
   * Starts a guest session.
   */
  guest = () => {
    this.run(this.startGuest());
  };
  /**
   * Creates a guest identity and reloads the session list.
   */
  private async startGuest() {
    this.update({ error: null });
    await this.api.guest();
    await this.refresh();
  }
  /**
   * Signs out and clears session state.
   */
  logout = () => {
    this.run(this.endIdentity());
  };
  /**
   * Revokes the credential, clears state, and persists the signed-out index.
   */
  private async endIdentity() {
    await this.api.logout();
    this.refreshRevision++;
    this.reset(null);
    this.save(this.state.index);
  }
  /**
   * Disposes the controller, aborting work and clearing state.
   */
  dispose = () => {
    this.disposed = true;
    this.refreshRevision++;
    this.reset(null);
  };
  /**
   * Persists the sidebar open state.
   *
   * @param sidebarOpen - Whether the sidebar is open.
   */
  setSidebar = (sidebarOpen: boolean) => {
    this.save({ ...this.state.index, sidebarOpen });
  };
  /**
   * Selects a session and loads its history.
   *
   * @param id - Session id to select, or null for a new analysis.
   */
  select = (id: string | null) => {
    this.selection++;
    this.update({
      selected: id,
      loading: Boolean(id && !this.state.histories[id]),
      error: null,
    });
    if (this.state.identity) {
      this.save({ ...this.state.index, selected: id });
    }
    if (id && this.state.identity) {
      this.run(this.load(id, this.epoch));
    }
  };
  /**
   * Reloads the selected session and the session list.
   */
  reload = () => {
    this.update({ error: null });
    if (this.state.selected && this.state.identity) {
      this.run(this.load(this.state.selected, this.epoch));
    }
    this.run(this.refresh());
  };
  /**
   * Schedules the next poll while any session has pending or running work.
   */
  private schedulePoll() {
    clearTimeout(this.poll);
    if (this.disposed || !this.state.identity) {
      return;
    }
    if (hasPendingWork(this.state.index.sessions, Object.values(this.state.histories))) {
      this.poll = setTimeout(() => this.run(this.pollSaved()), 2000);
    }
  }
  /**
   * Refreshes the index and reloads histories for sessions with running turns.
   */
  private async pollSaved() {
    await this.refresh();
    const epoch = this.epoch;
    const ids = new Set(
      this.state.index.sessions
        .filter((session) => session.runningTurn)
        .map((session) => session.id),
    );
    for (const [id, history] of Object.entries(this.state.histories)) {
      if (history.turns.some((turn) => turn.status === "running")) {
        ids.add(id);
      }
    }
    if (this.state.selected) {
      ids.add(this.state.selected);
    }
    await Promise.all(
      [...ids].filter((id) => !this.state.responses[id]).map((id) => this.load(id, epoch)),
    );
    this.schedulePoll();
  }
  /**
   * Loads a session's saved history, ignoring responses for stale epochs.
   *
   * @param id - Session id to load.
   * @param epoch - Identity epoch that must still be current.
   */
  private async load(id: string, epoch: number) {
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    try {
      const history = await this.api.history(id);
      if (this.disposed || epoch !== this.epoch || revision !== this.revisions.get(id)) {
        return;
      }
      this.update({
        histories: { ...this.state.histories, [id]: history },
        ...(id === this.state.selected ? { loading: false } : {}),
      });
      this.update({ index: remember(this.state.index, history.session) });
      this.schedulePoll();
    } catch (error) {
      if (this.disposed || epoch !== this.epoch || revision !== this.revisions.get(id)) {
        return;
      }
      if (error instanceof ApiFailure && error.status === 404) {
        const histories = { ...this.state.histories };
        delete histories[id];
        this.update({
          histories,
          index: {
            ...this.state.index,
            sessions: this.state.index.sessions.filter((entry) => entry.id !== id),
          },
        });
      }
      if (error instanceof ApiFailure && error.status === 401) {
        this.report(error);
      } else if (id === this.state.selected) {
        this.update({ loading: false });
        this.report(error);
      }
      throw error;
    }
  }
  /**
   * Sends a prompt, creating a session first when none is selected.
   *
   * @param text - User prompt to submit.
   */
  send = (text: string) => {
    const id = this.state.selected;
    const history = id ? this.state.histories[id] : undefined;
    if (
      !this.state.identity ||
      this.state.creating ||
      this.state.loading ||
      (id && this.state.responses[id]) ||
      history?.turns.some((turn) => turn.status === "running") ||
      this.state.index.sessions.find((entry) => entry.id === id)?.runningTurn
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
    const active = createResponse(parsed.data.clientTurnId, parsed.data.message, id);
    this.update({
      responses: {
        ...this.state.responses,
        [id ?? active.clientTurnId]: active,
      },
      creating: !id,
      error: null,
    });
    this.run(this.submit(active, this.epoch, this.selection));
  };
  /**
   * Aborts the selected session's in-flight response.
   */
  stop = () => {
    if (this.state.selected) {
      this.state.responses[this.state.selected]?.controller.abort();
    }
  };
  /**
   * Applies one stream event to the active response being assembled.
   *
   * @param active - In-progress response the event belongs to.
   * @param event - Stream event to apply.
   * @returns The response with the event applied.
   */
  private event(active: ActiveResponse, event: StreamEvent): ActiveResponse {
    if (event.type !== "turn_started" && active.turnId !== event.turnId) {
      throw new Error("Stream contained a different turn.");
    }
    if (event.type === "session_updated") {
      if (event.session.id !== active.sessionId) {
        throw new Error("Stream contained a different session.");
      }
      this.update({ index: remember(this.state.index, event.session) });
    }
    if (event.type === "turn_finished" && event.error && this.state.selected === active.sessionId) {
      this.update({ error: event.error.message });
    }
    const next = applyEvent(active, event);
    if (next.sessionId) {
      this.update({
        responses: { ...this.state.responses, [next.sessionId]: next },
      });
    }
    return next;
  }
  /**
   * Merges a finished response into its cached history when reloading it failed.
   *
   * @param active - Finished response to retain.
   */
  private publishToCache(active: ActiveResponse) {
    const id = active.sessionId;
    const cached = id ? this.state.histories[id] : undefined;
    if (!id || !cached) {
      return;
    }
    this.update({
      histories: {
        ...this.state.histories,
        [id]: mergePublished(cached, active),
      },
    });
  }
  /**
   * Streams a turn to completion, creating the session first when needed.
   *
   * @param active - Response being submitted.
   * @param epoch - Identity epoch that must still be current.
   * @param selection - Selection counter guarding against stale submissions.
   */
  private async submit(active: ActiveResponse, epoch: number, selection: number) {
    let failure: string | null = null;
    try {
      if (!active.sessionId) {
        const session = await this.api.createSession();
        if (this.disposed || epoch !== this.epoch) {
          return;
        }
        active.sessionId = session.id;
        const responses = { ...this.state.responses };
        delete responses[active.clientTurnId];
        responses[session.id] = active;
        this.update({
          responses,
          creating: false,
          histories: {
            ...this.state.histories,
            [session.id]: historySchema.parse({
              session,
              turns: [],
              messages: [],
            }),
          },
          index: remember(this.state.index, session),
        });
        if (this.state.selected === null && selection === this.selection) {
          this.update({ selected: session.id });
          this.save({ ...this.state.index, selected: session.id });
        }
      }
      active.controller.signal.throwIfAborted();
      for await (const event of this.api.turn(
        {
          params: { id: active.sessionId },
          body: { message: active.text, clientTurnId: active.clientTurnId },
        },
        active.controller.signal,
      )) {
        if (this.disposed || epoch !== this.epoch) {
          return;
        }
        active = this.event(active, event);
      }
      if (!active.finished) {
        throw new Error("Connection ended before completion. Saved history has been reloaded.");
      }
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) {
        return;
      }
      if (error instanceof ApiFailure && error.status === 401) {
        this.report(error);
        return;
      }
      failure = active.controller.signal.aborted
        ? "Analysis stopped. Saved artifacts are retained."
        : error instanceof Error
          ? error.message
          : "Connection failed. Reload saved history before sending again.";
    } finally {
      failure = await this.settle(active, epoch, failure);
    }
  }
  /**
   * Publishes a finished response and reconciles it with saved history.
   *
   * @param active - Finished response to settle.
   * @param epoch - Identity epoch that must still be current.
   * @param failure - Failure message accumulated during the turn, if any.
   * @returns The failure message to surface, or null.
   */
  private async settle(
    active: ActiveResponse,
    epoch: number,
    failure: string | null,
  ): Promise<string | null> {
    active.controller.abort();
    active.finished = true;
    active.activities = [];
    if (this.disposed || epoch !== this.epoch) {
      return failure;
    }
    if (active.sessionId) {
      failure = await this.reloadOrPublish(active.sessionId, active, epoch, failure);
    }
    if (epoch === this.epoch && !this.disposed) {
      const responses = { ...this.state.responses };
      delete responses[active.sessionId ?? active.clientTurnId];
      this.update({
        responses,
        creating: false,
        ...(failure && this.state.selected === active.sessionId ? { error: failure } : {}),
      });
      await this.refresh();
    }
    return failure;
  }
  /**
   * Reloads saved history, retaining published artifacts when the reload fails.
   *
   * @param id - Session id whose history is reloaded.
   * @param active - Finished response being reconciled.
   * @param epoch - Identity epoch that must still be current.
   * @param failure - Failure message accumulated during the turn, if any.
   * @returns The failure message to surface, or null.
   */
  private async reloadOrPublish(
    id: string,
    active: ActiveResponse,
    epoch: number,
    failure: string | null,
  ): Promise<string | null> {
    this.update({
      responses: { ...this.state.responses, [id]: { ...active } },
    });
    try {
      await this.load(id, epoch);
    } catch (error) {
      failure ??= error instanceof Error ? error.message : "Could not reload saved history.";
      if (epoch === this.epoch) {
        this.publishToCache(active);
      }
    }
    return failure;
  }
}
