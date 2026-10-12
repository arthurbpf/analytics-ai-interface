import {
  metricRequestSchema,
  dimensionSchema,
  funnelSteps,
  defaultFunnelSteps,
  type MetricId,
  type MetricRequest,
  type QueryParameters,
} from "@analytics/contracts";
import { ToolError } from "../errors.ts";

export const availableHistory = { start: "2020-11-01", end: "2021-01-31" };
export const eventTable = "`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`";
const eventDimensions: readonly string[] = ["device", "country", "source", "medium"] as const;
const itemDimensions: readonly string[] = [
  ...eventDimensions,
  "item_id",
  "item_name",
  "item_category",
] as const;
const sessionMetrics = new Set<string>([
  "sessions",
  "conversion",
  "add_to_cart_rate",
  "checkout_abandonment",
  "engagement_rate",
  "avg_observed_session_duration",
  "avg_recorded_engagement_time",
  "new_vs_returning_sessions",
]);
const aggregates = {
  users: {
    definition: "Distinct non-null user IDs on events in the period. Dimension groups can overlap.",
    sql: "COUNT(DISTINCT user_pseudo_id) AS users, COUNTIF(user_pseudo_id IS NULL) AS missing_user_events",
  },
  purchases: {
    definition: "Purchase-event count; not reconstructed orders.",
    sql: "COUNT(*) AS purchases",
  },
  revenue: {
    definition:
      "Recorded USD purchase-event revenue; missing revenue contributes nothing and is counted separately.",
    sql: "COALESCE(SUM(revenue), 0) AS revenue, COUNTIF(revenue IS NULL) AS missing_revenue_events",
  },
  aov: {
    definition:
      "Average recorded USD revenue per purchase event, including events with missing revenue in the denominator. Null for zero purchase events.",
    sql: "SAFE_DIVIDE(COALESCE(SUM(revenue), 0), COUNT(*)) AS aov, COUNT(*) AS purchases, COUNTIF(revenue IS NULL) AS missing_revenue_events",
  },
  transactions: {
    definition:
      "Distinct valid transaction IDs on purchase events, excluding null, blank, (not set), <Other>, and (data deleted). Not reconstructed orders; dimension groups can overlap.",
    sql: "COUNT(DISTINCT IF(transaction_id IS NOT NULL AND TRIM(transaction_id) != '' AND LOWER(TRIM(transaction_id)) NOT IN ('(not set)', '<other>', '(data deleted)'), transaction_id, NULL)) AS transactions, COUNTIF(transaction_id IS NULL OR TRIM(transaction_id) = '' OR LOWER(TRIM(transaction_id)) IN ('(not set)', '<other>', '(data deleted)')) AS invalid_transaction_events",
  },
  sessions: {
    definition:
      "Distinct valid user/session pairs starting in the period, with complete recorded membership from all available history.",
    sql: "COUNT(*) AS sessions",
  },
  conversion: {
    definition:
      "Purchasing sessions divided by qualifying sessions starting in the period. Multiple purchase events count once; null for no sessions.",
    sql: "SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)) AS conversion_rate, COUNTIF(purchased) AS purchasing_sessions, COUNT(*) AS sessions",
  },
  add_to_cart_rate: {
    definition:
      "Sessions containing add_to_cart divided by qualifying sessions starting in the period; null for no sessions.",
    sql: "SAFE_DIVIDE(COUNTIF(cart), COUNT(*)) AS add_to_cart_rate, COUNTIF(cart) AS cart_sessions, COUNT(*) AS sessions",
  },
  checkout_abandonment: {
    definition:
      "Observed same-session checkout abandonment: sessions with begin_checkout and no purchase at or after the first checkout, divided by checkout sessions. Null for no checkout sessions.",
    sql: "SAFE_DIVIDE(COUNTIF(checkout_at IS NOT NULL AND (purchase_at IS NULL OR purchase_at < checkout_at)), COUNTIF(checkout_at IS NOT NULL)) AS checkout_abandonment, COUNTIF(checkout_at IS NOT NULL AND (purchase_at IS NULL OR purchase_at < checkout_at)) AS abandoned_checkout_sessions, COUNTIF(checkout_at IS NOT NULL) AS checkout_sessions",
  },
  engagement_rate: {
    definition:
      "Sessions with a valid engaged flag of 1 divided by sessions with a known valid flag (0 or 1). Null for no known flags; unknown sessions remain separate.",
    sql: "SAFE_DIVIDE(COUNTIF(engaged = 1), COUNTIF(engaged IS NOT NULL)) AS engagement_rate, COUNTIF(engaged = 1) AS engaged_sessions, COUNTIF(engaged IS NOT NULL) AS known_sessions, COUNTIF(engaged IS NULL) AS unknown_sessions, COUNT(*) AS sessions",
  },
  avg_observed_session_duration: {
    definition:
      "Average seconds between first and last recorded events in sessions starting in the period. Single-event sessions contribute zero.",
    sql: "AVG(duration_seconds) AS avg_observed_session_duration, COUNT(*) AS sessions",
  },
  avg_recorded_engagement_time: {
    definition:
      "Recorded engagement milliseconds divided by qualifying sessions, converted to seconds. Missing recordings contribute nothing; not total engagement.",
    sql: "SAFE_DIVIDE(SUM(engagement_ms), COUNT(*) * 1000) AS avg_recorded_engagement_time, COUNTIF(engagement_records = 0) AS sessions_without_recorded_engagement, COUNT(*) AS sessions",
  },
  new_vs_returning_sessions: {
    definition:
      "First observed session per user versus later observed sessions in the application's entire available history. Not lifetime new/returning behavior or exported session numbers.",
    sql: "COUNTIF(session_rank = 1) AS first_observed_sessions, COUNTIF(session_rank > 1) AS later_observed_sessions, COUNT(*) AS sessions",
  },
  purchasers_by_purchasing_session_count: {
    definition:
      "Users purchasing in the period, split into one versus multiple purchasing sessions in available history through the selected end date (each bucket's end for time buckets). Missing user/session IDs are excluded; not lifetime customer frequency.",
    sql: "COUNTIF(purchasing_sessions = 1) AS one_purchasing_session_users, COUNTIF(purchasing_sessions > 1) AS multiple_purchasing_session_users, COUNT(*) AS purchasers",
  },
  items_per_purchase: {
    definition:
      "Recorded purchase-item quantity divided by purchase-event count. Missing quantities and events without item rows are reported; not complete merchandise quantity.",
    sql: "SAFE_DIVIDE(COALESCE(SUM(item_quantity), 0), COUNT(*)) AS items_per_purchase, COALESCE(SUM(item_quantity), 0) AS recorded_item_quantity, COUNT(*) AS purchases, COALESCE(SUM(missing_item_quantities), 0) AS missing_item_quantities, COUNTIF(item_rows = 0) AS purchase_events_without_items",
  },
  item_performance: {
    definition:
      "Recorded item quantity and item USD revenue on purchase events, grouped by recorded item ID/name by default. Placeholder identities are preserved. Missing values are reported; event revenue is never duplicated over items.",
    sql: "COALESCE(SUM(item_quantity), 0) AS recorded_item_quantity, COALESCE(SUM(item_revenue), 0) AS recorded_item_revenue, COUNTIF(item_quantity IS NULL) AS missing_item_quantities, COUNTIF(item_revenue IS NULL) AS missing_item_revenues",
  },
  event_counts: {
    definition: "Event counts grouped by event name.",
    sql: "COUNT(*) AS event_count",
  },
  funnel: {
    definition:
      "Distinct-user reach for each requested event without ordered progression. Dimensions describe event-level reach; groups may overlap.",
    sql: "COUNT(DISTINCT user_pseudo_id) AS users, COUNTIF(user_pseudo_id IS NULL) AS missing_user_events",
  },
} satisfies Record<MetricId, { definition: string; sql: string }>;

export const catalog = Object.fromEntries(
  Object.entries(aggregates).map(([metric, value]) => {
    const dimensions =
      metric === "purchasers_by_purchasing_session_count"
        ? []
        : metric === "item_performance"
          ? itemDimensions
          : metric === "event_counts"
            ? [...eventDimensions, "event_name"]
            : eventDimensions;
    return [
      metric,
      {
        definition: value.definition,
        dimensions,
        filters: dimensions,
        outputColumns: [...value.sql.matchAll(/ AS (\w+)/g)].map((match) => match[1]),
        acceptedParameters: {
          dates: availableHistory,
          grain: ["day", "week"],
          filters: ["eq", "in"],
          topN: "Numeric output column, 1–500; applied after aggregation",
          ...(metric === "funnel"
            ? {
                steps: funnelSteps,
              }
            : {}),
        },
        guidance: sessionMetrics.has(metric)
          ? "Build full-history sessions first, then filter by first recorded event date/dimensions. Include complete session events outside the period."
          : "Use exported event dates, Monday weeks, and first-user source/medium. No implicit top-N.",
      },
    ];
  }),
);

export const historyEvents = `SELECT event_date, event_timestamp, event_name, user_pseudo_id,
  device.category AS device, geo.country AS country, traffic_source.source AS source, traffic_source.medium AS medium,
  ecommerce.purchase_revenue_in_usd AS revenue, ecommerce.transaction_id AS transaction_id, items,
  (SELECT MAX(value.int_value) FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
  (SELECT MAX(SAFE_CAST(COALESCE(CAST(value.int_value AS STRING), value.string_value) AS INT64)) FROM UNNEST(event_params) WHERE key = 'session_engaged' AND COALESCE(CAST(value.int_value AS STRING), value.string_value) IN ('0', '1')) AS engaged_flag,
  (SELECT SUM(COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))) FROM UNNEST(event_params) WHERE key = 'engagement_time_msec') AS engagement_time
FROM ${eventTable} WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20210131'`;
const sessionCtes = `ordered AS (
 SELECT *, ROW_NUMBER() OVER (PARTITION BY user_pseudo_id, session_id ORDER BY event_timestamp, event_name, device, country, source, medium, event_date) AS event_rank
 FROM events WHERE user_pseudo_id IS NOT NULL AND session_id IS NOT NULL
), sessions AS (
 SELECT user_pseudo_id, session_id, MAX(IF(event_rank = 1, event_date, NULL)) AS event_date,
 MAX(IF(event_rank = 1, device, NULL)) AS device, MAX(IF(event_rank = 1, country, NULL)) AS country,
 MAX(IF(event_rank = 1, source, NULL)) AS source, MAX(IF(event_rank = 1, medium, NULL)) AS medium,
 MIN(event_timestamp) AS first_timestamp,
 COUNTIF(event_name = 'purchase') > 0 AS purchased, COUNTIF(event_name = 'add_to_cart') > 0 AS cart,
 MIN(IF(event_name = 'begin_checkout', event_timestamp, NULL)) AS checkout_at,
 MAX(IF(event_name = 'purchase', event_timestamp, NULL)) AS purchase_at,
 MAX(engaged_flag) AS engaged, (MAX(event_timestamp) - MIN(event_timestamp)) / 1000000.0 AS duration_seconds,
 COALESCE(SUM(engagement_time), 0) AS engagement_ms, COUNT(engagement_time) AS engagement_records
 FROM ordered GROUP BY user_pseudo_id, session_id
), ranked_sessions AS (
 SELECT *, ROW_NUMBER() OVER (PARTITION BY user_pseudo_id ORDER BY first_timestamp, session_id) AS session_rank FROM sessions
)`;

export interface BuiltMetric {
  sql: string;
  parameters: QueryParameters;
  arguments: MetricRequest;
  definition: string;
  requiredCaveats: string[];
}
export function buildMetric(value: unknown): BuiltMetric {
  const args = metricRequestSchema.parse(value);
  const info = catalog[args.metric];
  if (!info) {
    throw new ToolError("Unknown catalog metric");
  }
  for (const dimension of args.dimensions) {
    if (!info.dimensions.includes(dimension)) {
      throw new ToolError(`Unsupported dimension ${dimension} for ${args.metric}`);
    }
  }
  for (const filter of args.filters) {
    if (!info.filters.includes(filter.field)) {
      throw new ToolError(`Unsupported filter ${filter.field} for ${args.metric}`);
    }
  }
  if (args.topN && !info.outputColumns.includes(args.topN.by)) {
    throw new ToolError("Ranking must use a permitted numeric output column");
  }
  const parameters: QueryParameters = {
    start: args.startDate.replaceAll("-", ""),
    end: args.endDate.replaceAll("-", ""),
  };
  const predicates = ["event_date BETWEEN @start AND @end"];
  for (const [index, filter] of args.filters.entries()) {
    const name = `filter_${index}`;
    parameters[name] = filter.value;
    predicates.push(
      filter.op === "eq" ? `${filter.field} = @${name}` : `${filter.field} IN UNNEST(@${name})`,
    );
  }
  let dimensions: string[] = [...args.dimensions];
  if (args.metric === "item_performance" && dimensions.length === 0) {
    dimensions = ["item_id", "item_name"];
  }
  if (["event_counts", "funnel"].includes(args.metric) && !dimensions.includes("event_name")) {
    dimensions.push("event_name");
  }
  args.dimensions = dimensions.map((dimension) => dimensionSchema.parse(dimension));
  if (args.grain) {
    dimensions.unshift(args.grain);
  }
  const bucket =
    args.grain === "week"
      ? "DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY))"
      : "PARSE_DATE('%Y%m%d', event_date)";
  const selectors = dimensions.map((name) => (name === args.grain ? `${bucket} AS ${name}` : name));
  let ctes = `events AS (${historyEvents})`;
  let source = "events";
  if (sessionMetrics.has(args.metric)) {
    ctes += `, ${sessionCtes}`;
    source = "ranked_sessions";
  } else if (args.metric === "purchasers_by_purchasing_session_count") {
    // Distinct pair counts avoid concatenation collisions; event dates bound historical purchases.
    const group = args.grain ? `${bucket} AS ${args.grain}, ` : "";
    const grouped = args.grain ? `, ${args.grain}` : "";
    const end =
      args.grain === "day"
        ? "selected.day"
        : args.grain === "week"
          ? "LEAST(DATE_ADD(selected.week, INTERVAL 6 DAY), PARSE_DATE('%Y%m%d', @end))"
          : "PARSE_DATE('%Y%m%d', @end)";
    ctes += `, purchase_sessions AS (SELECT user_pseudo_id, session_id, MIN(event_date) AS first_purchase_date FROM events WHERE event_name = 'purchase' AND user_pseudo_id IS NOT NULL AND session_id IS NOT NULL AND event_date <= @end GROUP BY user_pseudo_id, session_id), selected AS (SELECT ${group} user_pseudo_id FROM events WHERE event_name = 'purchase' AND user_pseudo_id IS NOT NULL AND session_id IS NOT NULL AND event_date BETWEEN @start AND @end GROUP BY user_pseudo_id${grouped}), classified AS (SELECT selected.*, (SELECT COUNT(*) FROM purchase_sessions AS prior WHERE prior.user_pseudo_id = selected.user_pseudo_id AND PARSE_DATE('%Y%m%d', prior.first_purchase_date) <= ${end}) AS purchasing_sessions FROM selected)`;
    source = "classified";
    predicates.length = 0;
    selectors.splice(0, selectors.length, ...dimensions);
  } else if (args.metric === "items_per_purchase") {
    ctes += `, purchase_items AS (SELECT *, (SELECT SUM(item.quantity) FROM UNNEST(items) AS item) AS item_quantity, (SELECT COUNTIF(item.quantity IS NULL) FROM UNNEST(items) AS item) AS missing_item_quantities, (SELECT COUNT(*) FROM UNNEST(items) AS item) AS item_rows FROM events WHERE event_name = 'purchase')`;
    source = "purchase_items";
  } else if (args.metric === "item_performance") {
    ctes += `, purchase_items AS (SELECT events.* EXCEPT(items), item.item_id, item.item_name, item.item_category, item.quantity AS item_quantity, item.item_revenue_in_usd AS item_revenue FROM events CROSS JOIN UNNEST(items) AS item WHERE event_name = 'purchase')`;
    source = "purchase_items";
  } else if (!["users", "event_counts", "funnel"].includes(args.metric)) {
    predicates.push("event_name = 'purchase'");
  }
  if (args.metric === "funnel") {
    args.steps ??= [...defaultFunnelSteps];
    parameters["steps"] = args.steps;
    predicates.push("event_name IN UNNEST(@steps)");
  }
  const aggregate = aggregates[args.metric];
  ctes += `, aggregated AS (SELECT ${[...selectors, aggregate.sql].join(", ")} FROM ${source}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}${dimensions.length ? ` GROUP BY ${dimensions.join(", ")}` : ""})`;
  const qualityColumns = info.outputColumns.filter(
    (column): column is string =>
      typeof column === "string" &&
      /^(missing_|invalid_|unknown_|sessions_without_|purchase_events_without_)/.test(column),
  );
  const identityMetric =
    sessionMetrics.has(args.metric) || args.metric === "purchasers_by_purchasing_session_count";
  ctes += `, totals AS (SELECT COUNT(*) AS _group_count${qualityColumns.map((column) => `, COALESCE(SUM(${column}), 0) AS _quality_${column}`).join("")} FROM aggregated)`;
  if (identityMetric) {
    ctes += `, excluded AS (SELECT COUNT(*) AS _quality_excluded_identity_events FROM events WHERE event_date BETWEEN @start AND @end AND (user_pseudo_id IS NULL OR session_id IS NULL)${args.metric === "purchasers_by_purchasing_session_count" ? " AND event_name = 'purchase'" : ""})`;
  }
  const ties = dimensions.map((column) => `${column} ASC`);
  const ordering = args.topN ? [`${args.topN.by} DESC`, ...ties] : ties;
  if (args.topN) {
    parameters["top_count"] = args.topN.count;
  }
  ctes += `, selection AS (SELECT *, 1 AS _present FROM aggregated${ordering.length ? ` ORDER BY ${ordering.join(", ")}` : ""}${args.topN ? " LIMIT @top_count" : ""})`;
  const sql = `WITH ${ctes} SELECT selection.*, totals.*${identityMetric ? ", excluded.*" : ""} FROM totals${identityMetric ? " CROSS JOIN excluded" : ""} LEFT JOIN selection ON TRUE${ordering.length ? ` ORDER BY ${ordering.join(", ")}` : ""}`;
  const caveats = [
    "Observations cover only the obfuscated sample history, November 1, 2020 through January 31, 2021; they do not describe production GA4 or lifetime customer behavior.",
    aggregate.definition,
  ];
  if (sessionMetrics.has(args.metric)) {
    caveats.push(
      "Sessions are assigned the date and dimensions of their first recorded event, with complete recorded membership even outside the selected period.",
    );
  }
  if (identityMetric) {
    caveats.push(
      "Events missing user/session IDs are excluded. The exclusion count covers selected event dates before dimension filtering, not a count of excluded sessions.",
    );
  }
  if (
    args.dimensions.some((dimension) => dimension === "source" || dimension === "medium") ||
    args.filters.some((filter) => filter.field === "source" || filter.field === "medium")
  ) {
    caveats.push("Source and medium are first-user attribution, not session attribution.");
  }
  if (args.topN) {
    caveats.push(
      `Top ${args.topN.count} groups ranked by ${args.topN.by}; evidence supports only this selection, not the whole breakdown.`,
    );
  }
  return {
    sql,
    parameters,
    arguments: args,
    definition: aggregate.definition,
    requiredCaveats: caveats,
  };
}
