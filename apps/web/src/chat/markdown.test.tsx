import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Markdown } from "./markdown.tsx";
it("renders headings, emphasis, lists, quotes, safe links, tables and fenced code", () => {
  const { container } = render(
    <Markdown>
      {
        "# Findings\n\n**Revenue** grew *quickly*.\n\n- First\n- Second\n\n> Sample\n\n[Source](https://example.com)\n\n| Device | Purchases |\n| --- | --- |\n| desktop | 12 |\n\n```sql\nSELECT 1\n```"
      }
    </Markdown>,
  );
  expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
  expect(container.querySelector("strong")).toHaveTextContent("Revenue");
  expect(container.querySelector("em")).toHaveTextContent("quickly");
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(container.querySelector("blockquote")).toHaveTextContent("Sample");
  expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com");
  expect(screen.getByRole("table").parentElement).toHaveClass("markdown-table");
  expect(container.querySelector("pre code")).toHaveTextContent("SELECT 1");
});
it("removes raw HTML and embedded images and sanitizes unsafe URLs", () => {
  const { container } = render(
    <Markdown>
      {
        '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n![tracking](https://example.com/image)\n\n[unsafe](javascript:alert%281%29)'
      }
    </Markdown>,
  );
  expect(container.querySelector("script, img")).toBeNull();
  expect(screen.getByText("unsafe")).toHaveAttribute("href", "");
});
it("accepts incomplete streaming syntax without injecting HTML", () => {
  const { rerender } = render(<Markdown>{"**Incomplete\n\n```sql\nSELECT"}</Markdown>);
  expect(screen.getByText("SELECT")).toBeInTheDocument();
  rerender(<Markdown>{"**Complete**\n\n```sql\nSELECT 1\n```"}</Markdown>);
  expect(screen.getByText("Complete").tagName).toBe("STRONG");
});
