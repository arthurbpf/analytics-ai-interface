export const schemaGuidance = {
  dataset: "bigquery-public-data.ga4_obfuscated_sample_ecommerce",
  dates: { start: "2020-11-01", end: "2021-01-31" },
  sqlDialect:
    "BigQuery GoogleSQL: GROUP BY may reference SELECT aliases, which override corresponding FROM names. SELECT device.category AS device ... GROUP BY device groups by the category alias, not the source device struct.",
  fields: {
    event_date: "YYYYMMDD string",
    event_timestamp: "microsecond integer",
    event_name: "string",
    user_pseudo_id: "nullable string",
    event_params: "array of key/value structs",
    items: "array of ecommerce item structs",
    ecommerce:
      "struct containing purchase_revenue_in_usd, transaction_id. Valid transaction IDs exclude null, blank, (not set), <Other>, and (data deleted).",
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
