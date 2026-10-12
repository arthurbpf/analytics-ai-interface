import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { Legend, ResponsiveContainer, Tooltip } from "recharts";
import { z } from "zod";

export type ChartConfig = Record<string, { label?: ReactNode; color?: string }>;
const ChartContext = createContext<ChartConfig | null>(null);
function useChart() {
  const config = useContext(ChartContext);
  if (!config) {
    throw new Error("Chart content requires ChartContainer");
  }
  return config;
}
function ChartContainer({
  id,
  config,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  config: ChartConfig;
  children: ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <style>{`[data-chart="${chartId}"] {${Object.entries(config)
          .map(([key, item]) => (item.color ? `--color-${key}: ${item.color};` : ""))
          .join("\n")}}`}</style>
        <ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}
const ChartTooltip = Tooltip;
const ChartLegend = Legend;
const payloadSchema = z.array(
  z.object({
    dataKey: z.union([z.string(), z.number()]).optional(),
    name: z.union([z.string(), z.number()]).optional(),
    value: z
      .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
      .nullable()
      .optional(),
    color: z.string().optional(),
    type: z.string().optional(),
  }),
);
function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
}: {
  active?: boolean | undefined;
  payload?: readonly unknown[] | undefined;
  label?: unknown;
  valueFormatter?: (value: unknown) => string;
  labelFormatter?: (value: unknown) => string;
}) {
  const config = useChart();
  const parsed = payloadSchema.safeParse(payload);
  if (!active || !parsed.success || !parsed.data.length) {
    return null;
  }
  return (
    <div className="grid min-w-32 gap-1.5 border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {(typeof label === "string" || typeof label === "number") && (
        <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {parsed.data
        .filter((item) => item.type !== "none")
        .map((item) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          return (
            <div key={key} className="flex items-center gap-2">
              <div className="size-2 shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-muted-foreground">{config[key]?.label ?? item.name}</span>
              <span className="ml-auto font-medium tabular-nums">
                {valueFormatter
                  ? valueFormatter(item.value)
                  : item.value === null || item.value === undefined
                    ? "—"
                    : typeof item.value === "number"
                      ? item.value.toLocaleString("en-US")
                      : String(item.value)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
function ChartLegendContent({ payload }: { payload?: readonly unknown[] | undefined }) {
  const config = useChart();
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return (
    <div className="flex flex-wrap justify-center gap-4 pt-3">
      {parsed.data
        .filter((item) => item.type !== "none")
        .map((item) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div className="size-2 shrink-0" style={{ backgroundColor: item.color }} />
              {config[key]?.label ?? item.value}
            </div>
          );
        })}
    </div>
  );
}
export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent };
