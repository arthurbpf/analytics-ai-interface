import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useChatContext, useChatStore } from "../state/chat-provider.tsx";

/**
 * Records a message when navigation rejects.
 *
 * @param navigation - Navigation promise to observe.
 * @param report - Callback recording the failure.
 */
function reportNavigationFailure(
  navigation: Promise<unknown>,
  report: (message: string) => void,
): void {
  void navigation.then(
    () => {},
    () => report("Could not update the session URL."),
  );
}

/**
 * Makes URL selection authoritative after restoring initial identity preferences.
 *
 * @param onReset - Resets composer state when the identity changes.
 * @returns The navigation error and session-selection action.
 */
export function useSessionRouting(onReset: () => void) {
  const { runtime, identity, ready } = useChatContext();
  const selected = useChatStore((state) => state.selected);
  const responses = useChatStore((state) => state.responses);
  const { session } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const initialized = useRef(false);
  const previousIdentity = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (!identity) {
      if (previousIdentity.current) {
        initialized.current = false;
        previousIdentity.current = null;
        onReset();
        reportNavigationFailure(navigate({ search: {}, replace: true }), setNavigationError);
      }
      return;
    }
    if (previousIdentity.current && previousIdentity.current !== identity.id) {
      previousIdentity.current = identity.id;
      initialized.current = true;
      onReset();
      runtime.store.getState().select(null);
      reportNavigationFailure(navigate({ search: {}, replace: true }), setNavigationError);
      return;
    }
    previousIdentity.current = identity.id;
    const state = runtime.store.getState();
    const id = initialized.current ? (session ?? null) : (session ?? state.preferences.selected);
    initialized.current = true;
    if (id !== state.selected) {
      state.select(id);
    }
    if (id && !session) {
      reportNavigationFailure(
        navigate({ search: { session: id }, replace: true }),
        setNavigationError,
      );
    }
  }, [runtime, navigate, onReset, session, ready, identity]);
  useEffect(() => {
    if (selected && responses[selected] && !session) {
      reportNavigationFailure(
        navigate({ search: { session: selected }, replace: true }),
        setNavigationError,
      );
    }
  }, [navigate, session, selected, responses]);
  const select = useCallback(
    (id: string | null) => {
      runtime.store.getState().select(id);
      setNavigationError(null);
      reportNavigationFailure(
        navigate(id ? { search: { session: id } } : { search: {} }),
        setNavigationError,
      );
    },
    [runtime, navigate],
  );
  return { navigationError, select };
}
