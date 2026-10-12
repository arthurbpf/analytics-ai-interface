import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ChartView } from "./charts.tsx";
import { chart } from "./test-fixtures.ts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { formatCell } from "./display.ts";

it("uses explicit labels and units for tables, KPIs, and tooltip values", () => {
  const value = chart("table");
  value.data.columns[1] = {
    name: "purchases",
    type: "number",
    display: { label: "Recorded revenue", format: "usd" },
  };
  value.data.rows[0] = { device: "desktop", purchases: 1234.56 };
  const view = render(<ChartView chart={value} />);
  expect(screen.getByRole("columnheader", { name: "Recorded revenue" })).toHaveClass("text-right");
  expect(screen.getByRole("cell", { name: "$1,234.56" })).toHaveClass("tabular-nums");
  const kpi = chart("kpi");
  kpi.data = value.data;
  view.rerender(<ChartView chart={kpi} />);
  expect(screen.getByTestId("chart-kpi")).toHaveTextContent("$1,234.56");
  expect(screen.getByTestId("chart-kpi")).toHaveTextContent("Recorded revenue");
  view.rerender(
    <ChartContainer config={{ s0: { label: "Recorded revenue" } }}>
      <ChartTooltipContent
        active
        payload={[{ dataKey: "s0", value: 1234.56 }]}
        label="desktop"
        valueFormatter={(cell) => formatCell(cell, value.data.columns[1])}
      />
    </ChartContainer>,
  );
  expect(screen.getByText("Recorded revenue")).toBeInTheDocument();
  expect(screen.getByText("$1,234.56")).toBeInTheDocument();
});
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
    "Device",
    "Purchases",
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
