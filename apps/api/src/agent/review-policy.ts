import type { PublishedChart, QueryResult } from "@analytics/contracts";

const higherRiskMetrics = new Set([
  "aov",
  "conversion",
  "add_to_cart_rate",
  "checkout_abandonment",
  "engagement_rate",
  "new_vs_returning_sessions",
  "purchasers_by_purchasing_session_count",
  "items_per_purchase",
  "funnel",
]);

/**
 * Decides whether an answer must pass analytical review before publication.
 *
 * Single catalog results are exempt only when they use a low-risk metric with no extra
 * dimensions, filters, grain, top-N, or steps; everything else is reviewed.
 *
 * @param results - Saved results referenced by the proposed analysis.
 * @param charts - Charts selected for publication with the analysis.
 * @returns True when the answer must be reviewed before it is published.
 */
export function requiresReview(results: QueryResult[], charts: PublishedChart[]): boolean {
  if (results.length === 0) {
    return false;
  }
  if (results.length !== 1 || charts.length > 0) {
    return true;
  }
  const [result] = results;
  if (!result || result.origin !== "catalog" || !result.catalog) {
    return true;
  }
  const { metric, dimensions, filters, grain, topN, steps } = result.catalog.arguments;
  return (
    higherRiskMetrics.has(metric) ||
    dimensions.length > 1 ||
    filters.length > 0 ||
    grain !== undefined ||
    topN !== undefined ||
    steps !== undefined
  );
}
