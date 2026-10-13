import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Composer } from "./chat-composer.tsx";

/**
 * Renders the composer with spies, overriding individual props.
 *
 * @param overrides - Prop overrides for the test.
 * @returns The spies and rendered composer.
 */
function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onJump = vi.fn();
  const onStop = vi.fn();
  render(
    <Composer
      value=""
      maxLength={8000}
      disabled={false}
      showJump={false}
      active={null}
      onChange={onChange}
      onSubmit={onSubmit}
      onJump={onJump}
      onStop={onStop}
      {...overrides}
    />,
  );
  return { onChange, onSubmit, onJump, onStop };
}
it("submits on Enter but not on Shift+Enter", async () => {
  const user = userEvent.setup();
  const { onSubmit } = setup({ value: "Revenue" });
  const box = screen.getByRole("textbox", {
    name: "Ask an analytics question",
  });
  await user.type(box, "{Enter}");
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await user.type(box, "{Shift>}{Enter}{/Shift}");
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
it("reports input changes", async () => {
  const user = userEvent.setup();
  const { onChange } = setup();
  await user.type(screen.getByRole("textbox"), "a");
  expect(onChange).toHaveBeenCalledWith("a");
});
it("blocks over-length prompts and explains the limit", () => {
  setup({ value: "x".repeat(8001) });
  expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  expect(screen.getByText("Questions must be at most 8,000 characters.")).toBeInTheDocument();
});
it("shows the jump control and stops an active response", async () => {
  const user = userEvent.setup();
  const { onJump, onStop } = setup({
    showJump: true,
    active: {
      sessionId: null,
      label: "Revenue",
      turnId: null,
      text: "Revenue",
      clientTurnId: "c",
      charts: [],
      analysis: null,
      clarification: null,
      progress: "Working",
      activities: [],
      finished: false,
    },
  });
  await user.click(screen.getByRole("button", { name: /jump to latest/i }));
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Responding to Revenue")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /stop/i }));
  expect(onStop).toHaveBeenCalledTimes(1);
});
