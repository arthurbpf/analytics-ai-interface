import { useSyncExternalStore } from "react";

const query = "(max-width: 767px)";
/**
 * Subscribes to changes in the mobile viewport media query.
 *
 * @param listener - Callback invoked when the media query result changes.
 * @returns A function that removes the listener.
 */
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => {
    media.removeEventListener("change", listener);
  };
}
/**
 * Reports whether the viewport currently matches the mobile media query.
 *
 * @returns True when the viewport is mobile-sized.
 */
function snapshot() {
  return window.matchMedia(query).matches;
}
/**
 * Provides the server-side snapshot, which assumes a non-mobile viewport.
 *
 * @returns False, since there is no viewport during server rendering.
 */
function serverSnapshot() {
  return false;
}
/**
 * Reports whether the current viewport is mobile-sized, updating on resize.
 *
 * @returns True when the viewport is narrower than the mobile breakpoint.
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
