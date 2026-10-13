import { Component, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { columnLabel, type PublishedChart, type ResultData } from "@analytics/contracts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { plotData } from "./chart-data.ts";
import { formatCell } from "./display.ts";

/**
 * Renders selected result columns as a table.
 *
 * @param props - Component props.
 * @param props.data - Result data to render.
 * @param props.columns - Column names to show, defaulting to all columns.
 * @returns The rendered table.
 */
function ResultTable({
  data,
  columns = data.columns.map((column) => column.name),
}: {
  data: ResultData;
  columns?: string[];
}) {
  const fields = columns.map((name) => data.columns.find((column) => column.name === name));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column, index) => (
            <TableHead
              key={column}
              className={fields[index]?.type === "number" ? "text-right" : undefined}
            >
              {columnLabel(column, fields[index]?.display)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.rows.map((row, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- Identical saved rows have no unique identity; ordinals preserve their order.
          <TableRow key={`${index}-${JSON.stringify(row)}`}>
            {columns.map((column, columnIndex) => (
              <TableCell
                key={column}
                className={
                  fields[columnIndex]?.type === "number" ? "text-right tabular-nums" : undefined
                }
              >
                {formatCell(row[column], fields[columnIndex])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
/**
 * Renders a published chart according to its type.
 *
 * @param props - Component props.
 * @param props.chart - Chart to render.
 * @returns The rendered table, KPI, line, or bar visualization.
 */
function Visualization({ chart }: { chart: PublishedChart }) {
  const { spec, data } = chart;
  if (spec.type === "table") {
    return <ResultTable data={data} columns={spec.columns} />;
  }
  if (!data.rows.length) {
    return <p className="text-muted-foreground text-sm">No data for this visualization.</p>;
  }
  if (spec.type === "kpi") {
    const column = data.columns.find((field) => field.name === spec.column);
    return (
      <p className="text-4xl tracking-tight tabular-nums">
        {formatCell(data.rows[spec.row]?.[spec.column], column)}
        <span className="mt-2 block text-xs text-muted-foreground">
          {columnLabel(spec.column, column?.display)}
        </span>
      </p>
    );
  }
  const plot = plotData(spec, data);
  if (plot.duplicate) {
    return (
      <>
        <p className="mb-3 text-sm text-muted-foreground">
          Repeated category/series pairs cannot be stacked without aggregation. Showing saved data.
        </p>
        <ResultTable data={data} />
      </>
    );
  }
  const config: ChartConfig = Object.fromEntries(
    plot.series.map((item, index) => [
      item.key,
      { label: item.label, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  );
  const xColumn = data.columns.find((column) => column.name === spec.x);
  const yColumn = data.columns.find((column) => column.name === spec.y);
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="x"
        tickLine={false}
        axisLine={false}
        minTickGap={24}
        tickFormatter={(value: unknown) => formatCell(value, xColumn, true)}
      />
      <YAxis
        width={80}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value: unknown) => formatCell(value, yColumn, true)}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            valueFormatter={(value) => formatCell(value, yColumn)}
            labelFormatter={(value) => formatCell(value, xColumn)}
          />
        }
      />
    </>
  );
  return (
    <>
      <ChartContainer config={config} className="h-64 w-full aspect-auto" aria-label={spec.title}>
        {spec.type === "line" ? (
          <LineChart data={plot.rows} accessibilityLayer>
            {axes}
            <Line
              dataKey="s0"
              stroke="var(--color-s0)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        ) : (
          <BarChart data={plot.rows} accessibilityLayer>
            {axes}
            {plot.series.map((item) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                fill={`var(--color-${item.key})`}
                {...(spec.type === "stacked_bar" ? { stackId: "total" } : {})}
                isAnimationActive={false}
              />
            ))}
            {spec.type === "stacked_bar" && <ChartLegend content={<ChartLegendContent />} />}
          </BarChart>
        )}
      </ChartContainer>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground">View chart data</summary>
        <ResultTable data={data} />
      </details>
    </>
  );
}
/**
 * Error boundary that contains chart render failures.
 */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  /**
   * Switches the boundary to its failed state when a child throws.
   *
   * @returns State marking the boundary as failed.
   */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /**
   * Renders the fallback alert or the wrapped children.
   *
   * @returns The failure message or the child content.
   */
  override render() {
    return this.state.failed ? (
      <p role="alert">This visualization could not render. Reload saved history.</p>
    ) : (
      this.props.children
    );
  }
}
/**
 * Renders a published chart within a card, including caveats and a preview warning.
 *
 * @param props - Component props.
 * @param props.chart - Chart to display.
 * @returns The rendered chart card.
 */
export function ChartView({ chart }: { chart: PublishedChart }) {
  return (
    <Card className="my-4 min-w-0" data-testid={`chart-${chart.spec.type}`}>
      <CardHeader>
        <CardTitle>{chart.spec.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!chart.data.complete && (
          <output className="mb-3 block text-destructive">
            Preview — this result is incomplete.
          </output>
        )}
        {chart.requiredCaveats.map((caveat) => (
          <p key={caveat} className="mb-3 text-sm text-muted-foreground">
            {caveat}
          </p>
        ))}
        <ChartBoundary>
          <Visualization chart={chart} />
        </ChartBoundary>
      </CardContent>
    </Card>
  );
}
