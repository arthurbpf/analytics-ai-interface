import { expect, it } from "vitest";
import { QueryBudget } from "./budget.ts";
it("enforces query and cumulative caps, retaining unknown charges", () => {
  const budget = new QueryBudget(100n, 150n, 5);
  expect(() => budget.reserve(101n)).toThrow();
  const first = budget.reserve(80n);
  expect(first).toBe(100n);
  expect(budget.reserve(40n)).toBe(50n);
  expect(() => budget.reserve(1n)).toThrow();
});
it("releases only confirmed unused billing", () => {
  const budget = new QueryBudget(100n, 150n, 5);
  const reserved = budget.reserve(80n);
  budget.settle(reserved, 20n);
  expect(budget.remaining).toBe(130n);
  budget.reserve(80n);
  expect(budget.remaining).toBe(30n);
});
it("limits query submissions independently of bytes", () => {
  const budget = new QueryBudget(100n, 500n, 1);
  budget.reserve(1n);
  expect(() => budget.reserve(1n)).toThrow();
});
