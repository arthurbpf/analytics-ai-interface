import type { ChartSpec, PublishedChart, SessionHistory } from "@analytics/contracts";
export const sessionId = "11111111-1111-4111-8111-111111111111";
export const turnId = "22222222-2222-4222-8222-222222222222";
export const draftId = "33333333-3333-4333-8333-333333333333";
export const resultRef = "44444444-4444-4444-8444-444444444444";
export const timestamp = "2026-10-12T12:00:00.000Z";
export function history(): SessionHistory {
  return {
    session: {
      id: sessionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      title: "Revenue",
      titleStatus: "idle",
      titleRevision: 0,
      runningTurn: false,
    },
    turns: [],
    messages: [],
  };
}
export function chart(type: ChartSpec["type"] = "bar"): PublishedChart {
  const base = { title: "Purchases by device", resultRef };
  let spec: ChartSpec;
  switch (type) {
    case "bar":
    case "line":
      spec = { ...base, type, x: "device", y: "purchases" };
      break;
    case "stacked_bar":
      spec = { ...base, type, x: "device", y: "purchases", series: "source" };
      break;
    case "table":
      spec = { ...base, type, columns: ["device", "purchases"] };
      break;
    case "kpi":
      spec = { ...base, type, column: "purchases", row: 0 };
      break;
  }
  return {
    id: draftId,
    spec,
    data: {
      columns: [
        { name: "device", type: "string" },
        { name: "purchases", type: "number" },
        { name: "source", type: "string" },
      ],
      rows: [
        { device: "desktop", purchases: 12, source: "organic" },
        { device: "mobile", purchases: 0, source: "paid" },
      ],
      complete: true,
      totalRows: "2",
    },
  };
}
