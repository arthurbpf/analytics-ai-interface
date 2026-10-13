import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityList } from "./turn-activity.tsx";

it("shows accessible current progress and ordered activity states", () => {
  render(
    <ActivityList
      progress="Writing the answer"
      activities={[
        {
          id: "0:0",
          stage: "thinking",
          message: "Checking metric definitions",
          status: "completed",
        },
        { id: "1:0", stage: "querying", message: "Preparing a query", status: "failed" },
        { id: "2:0", stage: "querying", message: "Preparing a narrower query", status: "running" },
      ]}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Writing the answer");
  expect(screen.getByRole("list", { name: "Analysis activity" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").map((item) => item.dataset["status"])).toEqual([
    "completed",
    "failed",
    "running",
  ]);
});
