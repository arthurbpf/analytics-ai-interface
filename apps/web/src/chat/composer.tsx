import type { FormEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActiveResponse } from "./response.ts";

/**
 * Composer controls for submitting prompts and managing the active turn.
 */
export interface ComposerProps {
  value: string;
  maxLength: number;
  disabled: boolean;
  showJump: boolean;
  active: ActiveResponse | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onJump: () => void;
  onStop: () => void;
}

/**
 * Renders the prompt composer, jump control, and turn status.
 *
 * @param props - Composer props.
 * @param props.value - Current composer text.
 * @param props.maxLength - Maximum accepted prompt length.
 * @param props.disabled - Whether submission is disabled.
 * @param props.showJump - Whether to show the jump-to-latest control.
 * @param props.active - In-flight response, if a turn is streaming.
 * @param props.onChange - Called with the updated composer text.
 * @param props.onSubmit - Called to submit the current text.
 * @param props.onJump - Called to scroll to the latest content.
 * @param props.onStop - Called to stop the active response.
 * @returns The rendered composer.
 */
export function Composer({
  value,
  maxLength,
  disabled,
  showJump,
  active,
  onChange,
  onSubmit,
  onJump,
  onStop,
}: ComposerProps) {
  /**
   * Submits the composer, preventing default form navigation.
   *
   * @param event - Optional form submit event to prevent default on.
   */
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onSubmit();
  };
  return (
    <footer className="shrink-0 border-t bg-background px-5 py-4 md:px-10">
      <div className="mx-auto max-w-3xl">
        {showJump && (
          <Button type="button" variant="outline" className="mb-3" onClick={onJump}>
            <ArrowDownIcon /> Jump to latest
          </Button>
        )}
        {active && (
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <output className="truncate">Responding to {active.label}</output>
            <Button type="button" variant="outline" onClick={onStop}>
              <StopIcon /> Stop
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="question" className="sr-only">
              Ask an analytics question
            </label>
            <Textarea
              id="question"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Ask about revenue, purchases, customers…"
              rows={2}
              className="max-h-40 resize-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              aria-describedby="composer-help"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label="Send question"
            disabled={disabled || !value.trim() || value.trim().length > maxLength}
          >
            <ArrowUpIcon />
          </Button>
        </form>
        <p id="composer-help" className="mt-2 text-[10px] leading-5 text-muted-foreground">
          {value.trim().length > maxLength
            ? "Questions must be at most 8,000 characters."
            : "Enter to send · Shift+Enter for a new line · Sample data may be obfuscated."}
        </p>
      </div>
    </footer>
  );
}
