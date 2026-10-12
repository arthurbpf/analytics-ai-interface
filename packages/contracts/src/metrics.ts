import { z } from "zod";

export const metricIdSchema = z.enum([
  "users",
  "purchases",
  "revenue",
  "aov",
  "transactions",
  "sessions",
  "conversion",
  "add_to_cart_rate",
  "checkout_abandonment",
  "engagement_rate",
  "avg_observed_session_duration",
  "avg_recorded_engagement_time",
  "new_vs_returning_sessions",
  "purchasers_by_purchasing_session_count",
  "items_per_purchase",
  "item_performance",
  "event_counts",
  "funnel",
]);
export type MetricId = z.infer<typeof metricIdSchema>;
export const dimensionSchema = z.enum([
  "device",
  "country",
  "source",
  "medium",
  "event_name",
  "item_id",
  "item_name",
  "item_category",
]);
export const funnelSteps = [
  "view_item",
  "view_item_list",
  "select_item",
  "add_to_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
] as const;
export const defaultFunnelSteps = [
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "purchase",
] as const;
const calendar = z.iso.date().refine((value) => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const metricRequestSchema = z
  .object({
    metric: metricIdSchema,
    startDate: calendar,
    endDate: calendar,
    dimensions: z.array(dimensionSchema).max(7).default([]),
    grain: z.enum(["day", "week"]).optional(),
    filters: z
      .array(
        z.discriminatedUnion("op", [
          z
            .object({ field: dimensionSchema, op: z.literal("eq"), value: z.string().max(500) })
            .strict(),
          z
            .object({
              field: dimensionSchema,
              op: z.literal("in"),
              value: z.array(z.string().max(500)).min(1).max(100),
            })
            .strict(),
        ]),
      )
      .max(10)
      .default([]),
    steps: z.array(z.enum(funnelSteps)).min(1).max(8).optional(),
    topN: z
      .object({ by: z.string().min(1).max(100), count: z.number().int().min(1).max(500) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (
      args.startDate < "2020-11-01" ||
      args.endDate > "2021-01-31" ||
      args.startDate > args.endDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Dates must be ordered within 2020-11-01 through 2021-01-31",
      });
    }
    if (
      new Set(args.dimensions).size !== args.dimensions.length ||
      (args.steps && new Set(args.steps).size !== args.steps.length)
    ) {
      ctx.addIssue({ code: "custom", message: "Dimensions and steps must be unique" });
    }
    if (args.steps && args.metric !== "funnel") {
      ctx.addIssue({ code: "custom", message: "Steps are only supported for funnel" });
    }
  });
export type MetricRequest = z.infer<typeof metricRequestSchema>;
export const clarificationSchema = z
  .object({
    context: z.string().trim().min(1).max(2000),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
  })
  .strict();
export type Clarification = z.infer<typeof clarificationSchema>;
export const resultScopeSchema = z.object({
  kind: z.enum(["unspecified", "full", "top_n"]),
  topN: z
    .object({
      by: z.string(),
      requestedCount: z.number().int().min(1).max(500),
      returnedCount: z.number().int().nonnegative(),
      groupCount: z.string().regex(/^\d+$/),
      omittedGroupCount: z.string().regex(/^\d+$/),
    })
    .nullable()
    .default(null),
});
export type ResultScope = z.infer<typeof resultScopeSchema>;
export const queryParametersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.array(z.string())]),
);
export type QueryParameters = z.infer<typeof queryParametersSchema>;
