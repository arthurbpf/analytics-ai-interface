import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { chart, history, sessionId, turnId } from "../testing/chat-fixtures.ts";
import { Transcript } from "./chat-transcript.tsx";
import type { ActiveResponse } from "../state/stream-events.ts";

it("renders saved messages of every kind", () => {
  const saved = history();
  saved.messages.push(
    { id: "m1", turnId, content: { kind: "user", text: "Revenue?" } },
    { id: "m2", turnId, content: { kind: "chart", chart: chart("table") } },
    {
      id: "m3",
      turnId,
      content: {
        kind: "analysis",
        analysis: {
          narrative: "Revenue grew.",
          caveats: ["Sample"],
          resultRefs: [],
          chartIds: [],
        },
      },
    },
    {
      id: "m4",
      turnId,
      content: {
        kind: "clarification",
        clarification: {
          context: "Which period?",
          questions: ["Which month?"],
        },
      },
    },
  );
  render(<Transcript history={saved} active={null} />);
  expect(screen.getByText("Revenue?")).toBeInTheDocument();
  expect(screen.getByText("Revenue grew.")).toBeInTheDocument();
  expect(screen.getByText("Which period?")).toBeInTheDocument();
  expect(screen.getByTestId("chart-table")).toBeInTheDocument();
});
it("shows an unfinished turn status when nothing is streaming", () => {
  const saved = history();
  saved.turns.push({
    id: turnId,
    clientTurnId: sessionId,
    status: "interrupted",
    createdAt: "2026-10-12T12:00:00.000Z",
    finishedAt: null,
    error: null,
  });
  render(<Transcript history={saved} active={null} />);
  expect(
    screen.getByText("Analysis interrupted. Saved artifacts are retained."),
  ).toBeInTheDocument();
});
it("deduplicates active output already saved and renders new charts", () => {
  const savedChart = chart("table");
  const newChart = {
    ...chart("bar"),
    id: "99999999-9999-4999-8999-999999999999",
  };
  const saved = history();
  saved.messages.push(
    { id: "m1", turnId, content: { kind: "user", text: "Revenue?" } },
    { id: "m2", turnId, content: { kind: "chart", chart: savedChart } },
  );
  const active: ActiveResponse = {
    sessionId,
    label: "Revenue?",
    turnId,
    text: "Revenue?",
    clientTurnId: "client",
    charts: [savedChart, newChart],
    analysis: null,
    clarification: null,
    progress: "Working",
    activities: [],
    finished: false,
  };
  render(<Transcript history={saved} active={active} />);
  expect(screen.getAllByTestId(/chart-/)).toHaveLength(2);
  expect(screen.getAllByText("Revenue?")).toHaveLength(1);
});
