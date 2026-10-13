import { useEffect } from "react";
import type { ChatController } from "./controller.ts";
import { storageKey } from "./storage.ts";

/**
 * Starts the controller and keeps it synchronized across tabs and focus.
 *
 * @param controller - Chat controller to manage.
 */
export function useChatLifecycle(controller: ChatController): void {
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
    /**
     * Reloads preferences when another tab changes shared storage.
     *
     * @param event - Storage event from the browser.
     */
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
}
