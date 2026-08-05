import { expect, test } from "vitest";
import { cardValue } from "./cards.ts";
import type { Rank } from "./cards.ts";

test("ace counts 1", () => {
  expect(cardValue("A")).toBe(1);
});

test("pip cards count their number", () => {
  const pips: Array<[Rank, number]> = [
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["5", 5],
    ["6", 6],
    ["7", 7],
    ["8", 8],
    ["9", 9],
    ["10", 10]
  ];
  for (const [rank, value] of pips) {
    expect(cardValue(rank)).toBe(value);
  }
});

test("face cards count 10", () => {
  expect(cardValue("J")).toBe(10);
  expect(cardValue("Q")).toBe(10);
  expect(cardValue("K")).toBe(10);
});
