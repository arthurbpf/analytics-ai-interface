import { useSyncExternalStore } from "react";
const query = "(max-width: 767px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => {
    media.removeEventListener("change", listener);
  };
}
function snapshot() {
  return window.matchMedia(query).matches;
}
function serverSnapshot() {
  return false;
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
