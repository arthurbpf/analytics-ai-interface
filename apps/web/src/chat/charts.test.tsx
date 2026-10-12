import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChartView } from "./charts.tsx";
import { chart } from "./test-fixtures.ts";
it.each(["bar", "line", "stacked_bar", "table", "kpi"] satisfies Parameters<typeof chart>[0][])(
  "renders %s from saved data without a network request",
  (type) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<ChartView chart={chart(type)} />);
    expect(screen.getByTestId(`chart-${type}`)).toBeInTheDocument();
    expect(screen.getByText("Purchases by device")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("shows empty data, incomplete previews, and duplicate-stack fallback", () => {
  const empty = chart();
  empty.data.rows = [];
  empty.data.complete = false;
  const view = render(<ChartView chart={empty} />);
  expect(screen.getByText(/No data/)).toBeInTheDocument();
  expect(screen.getByText(/Preview/)).toBeInTheDocument();
  const duplicate = chart("stacked_bar");
  duplicate.data.rows.push(...duplicate.data.rows);
  view.rerender(<ChartView chart={duplicate} />);
  expect(screen.getByText(/cannot be stacked/)).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(5);
});
it("escapes content and keeps the selected table columns", () => {
  const value = chart("table");
  value.data.rows[0] = { device: '<img src=x onerror="alert(1)">', purchases: 0 };
  const { container } = render(<ChartView chart={value} />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "device",
    "purchases",
  ]);
});

it("shows saved top-N scope and required caveats before a final answer", () => {
  const value = chart("table");
  value.scope = {
    kind: "top_n",
    topN: {
      by: "purchases",
      requestedCount: 2,
      returnedCount: 2,
      groupCount: "5",
      omittedGroupCount: "3",
    },
  };
  value.requiredCaveats = ["Returned 2 of 5 groups; omitted 3."];
  render(<ChartView chart={value} />);
  expect(screen.getByText(value.requiredCaveats[0] ?? "")).toBeInTheDocument();
});
