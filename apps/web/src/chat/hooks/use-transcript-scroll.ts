import { useEffect, useRef, useState } from "react";
import type { SessionHistory } from "@analytics/contracts";
import type { ActiveResponse } from "../state/stream-events.ts";

/**
 * Follows new output while the reader remains near the transcript's bottom.
 *
 * @param history - Selected saved history.
 * @param active - Selected live response.
 * @returns Transcript ref, scroll actions, and jump-control visibility.
 */
export function useTranscriptScroll(
  history: SessionHistory | undefined,
  active: ActiveResponse | null,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  /**
   * Resets scroll following when a different session is selected.
   */
  const reset = () => {
    nearBottom.current = true;
    setShowJump(false);
  };
  /**
   * Scrolls to the latest output and resumes following it.
   */
  const jumpToLatest = () => {
    const element = viewport.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      reset();
    }
  };
  /**
   * Updates whether the reader is close enough to follow new output.
   */
  const onScroll = () => {
    const element = viewport.current;
    if (element) {
      nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
      setShowJump(!nearBottom.current);
    }
  };
  useEffect(() => {
    const element = viewport.current;
    if (element && nearBottom.current && (history?.messages.length || active)) {
      element.scrollTop = element.scrollHeight;
    }
  }, [history, active]);
  return { viewport, showJump, reset, jumpToLatest, onScroll };
}
