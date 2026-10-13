import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ChatController } from "./controller.ts";

/**
 * Records a message when a navigation promise rejects.
 *
 * @param navigation - Navigation promise to observe.
 * @param report - Callback that records the failure message.
 * @param message - Failure message to record.
 */
function reportNavigationFailure(
  navigation: Promise<unknown>,
  report: (message: string) => void,
  message: string,
): void {
  void navigation.then(
    () => {},
    () => {
      report(message);
    },
  );
}

/**
 * Owns identity-driven session selection and URL synchronization.
 *
 * @param controller - Chat controller whose state drives routing.
 * @param onReset - Callback invoked when the identity changes or signs out.
 * @returns The current navigation error and a session selector.
 */
export function useSessionRouting(
  controller: ChatController,
  onReset: () => void,
): { navigationError: string | null; select: (id: string | null) => void } {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { session } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const initialized = useRef(false);
  const previousIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!state.ready) {
      return;
    }
    if (!state.identity) {
      if (previousIdentity.current) {
        initialized.current = false;
        previousIdentity.current = null;
        reportNavigationFailure(
          navigate({ search: {}, replace: true }),
          setNavigationError,
          "Could not reset the session URL.",
        );
      }
      return;
    }
    if (previousIdentity.current && previousIdentity.current !== state.identity.id) {
      previousIdentity.current = state.identity.id;
      initialized.current = true;
      onReset();
      controller.select(null);
      reportNavigationFailure(
        navigate({ search: {}, replace: true }),
        setNavigationError,
        "Could not reset the session URL.",
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
      reportNavigationFailure(
        navigate({ search: { session: id }, replace: true }),
        setNavigationError,
        "Could not restore the session URL.",
      );
    }
  }, [controller, navigate, onReset, session, state.ready, state.identity]);

  useEffect(() => {
    if (state.selected && state.responses[state.selected] && !session) {
      reportNavigationFailure(
        navigate({ search: { session: state.selected }, replace: true }),
        setNavigationError,
        "Could not update the session URL.",
      );
    }
  }, [navigate, session, state.selected, state.responses]);

  const select = useCallback(
    (id: string | null) => {
      controller.select(id);
      reportNavigationFailure(
        navigate(id ? { search: { session: id } } : { search: {} }),
        setNavigationError,
        "Could not update the session URL.",
      );
    },
    [controller, navigate],
  );

  return { navigationError, select };
}
