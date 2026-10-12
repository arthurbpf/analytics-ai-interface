export const eventTable = "`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`";
const scan = `FROM ${eventTable} WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20210131'`;
export const definitions = {
  users: {
    definition: "Distinct non-null user_pseudo_id in the selected period; not GA4 active users.",
    sql: `SELECT COUNT(DISTINCT user_pseudo_id) AS users ${scan}`,
  },
  sessions: {
    definition:
      "Distinct (user_pseudo_id, ga_session_id) pairs with both present, inferred from events in the selected period.",
    sql: `WITH events AS (SELECT user_pseudo_id, (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id ${scan}) SELECT COUNT(DISTINCT CONCAT(user_pseudo_id, '.', CAST(session_id AS STRING))) AS sessions FROM events WHERE user_pseudo_id IS NOT NULL AND session_id IS NOT NULL`,
  },
  purchases: {
    definition: "Purchase-event count, not deduplicated transactions.",
    sql: `SELECT COUNTIF(event_name = 'purchase') AS purchases ${scan}`,
  },
  revenue: {
    definition:
      "Sum of ecommerce.purchase_revenue_in_usd on purchase events; missing revenue contributes zero. USD.",
    sql: `SELECT SUM(IF(event_name = 'purchase', COALESCE(ecommerce.purchase_revenue_in_usd, 0), 0)) AS revenue ${scan}`,
  },
  aov: {
    definition: "USD revenue divided by purchase-event count; null when there are no purchases.",
    sql: `SELECT SAFE_DIVIDE(SUM(IF(event_name = 'purchase', COALESCE(ecommerce.purchase_revenue_in_usd, 0), 0)), COUNTIF(event_name = 'purchase')) AS aov ${scan}`,
  },
  conversion: {
    definition:
      "Purchasing sessions divided by all inferred sessions; exclude missing user/session IDs. Null for zero denominator. Count a session once even with multiple purchase events.",
    sql: `WITH events AS (SELECT user_pseudo_id, event_name, (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id ${scan}), sessions AS (SELECT user_pseudo_id, session_id, MAX(IF(event_name = 'purchase', 1, 0)) AS purchased FROM events WHERE user_pseudo_id IS NOT NULL AND session_id IS NOT NULL GROUP BY user_pseudo_id, session_id) SELECT SAFE_DIVIDE(SUM(purchased), COUNT(*)) AS conversion_rate FROM sessions`,
  },
  funnel: {
    definition:
      "Unordered event reach: distinct users with view_item, add_to_cart, begin_checkout, purchase. Does not prove ordered progression.",
    sql: `SELECT event_name, COUNT(DISTINCT user_pseudo_id) AS users ${scan} AND event_name IN ('view_item', 'add_to_cart', 'begin_checkout', 'purchase') GROUP BY event_name`,
  },
  attribution: {
    definition:
      "traffic_source.source and traffic_source.medium are first-user attribution, not session attribution. Label them accordingly.",
    sql: `SELECT COALESCE(traffic_source.source, '(unknown)') AS source, COALESCE(traffic_source.medium, '(unknown)') AS medium, SUM(COALESCE(ecommerce.purchase_revenue_in_usd, 0)) AS revenue ${scan} AND event_name = 'purchase' GROUP BY source, medium`,
  },
};
export const schemaGuidance = {
  dataset: "bigquery-public-data.ga4_obfuscated_sample_ecommerce",
  dates: { start: "2020-11-01", end: "2021-01-31" },
  fields: {
    event_date: "YYYYMMDD string",
    event_timestamp: "microsecond integer",
    event_name: "string",
    user_pseudo_id: "nullable string",
    event_params: "array of key/value structs",
    items: "array of ecommerce item structs",
    ecommerce: "struct containing purchase_revenue_in_usd, transaction_id",
    device: "struct containing category",
    traffic_source: "first-user source/medium/name struct",
  },
  examples: {
    sessionId: "(SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')",
    itemNames: "CROSS JOIN UNNEST(items) AS item",
    daily: "PARSE_DATE('%Y%m%d', event_date)",
    weekly: "DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY))",
  },
  caveat:
    "Obfuscated sample data may have missing values and internal inconsistencies. Report missing IDs and attribution limitations. Never imply production GA4 accuracy.",
};
