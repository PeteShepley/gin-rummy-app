import { expect, test } from "vitest";
import { BASE_CARD_H, BASE_CARD_W, BASE_EDGE, tableMetrics } from "./layout.ts";

// The design viewport: at or above it nothing shrinks, so these assertions
// also pin the geometry the table was built against.
const WIDE = 1200;
const TALL = 800;

test("a viewport at or above the design size renders cards at full size", () => {
  const metrics = tableMetrics(WIDE, TALL);
  expect(metrics.scale).toBe(1);
  expect(metrics.cardW).toBe(BASE_CARD_W);
  expect(metrics.cardH).toBe(BASE_CARD_H);
  expect(metrics.edge).toBe(BASE_EDGE);
});

test("the two piles straddle the centre of the table", () => {
  const metrics = tableMetrics(WIDE, TALL);
  expect(metrics.stock.x).toBeLessThan(WIDE / 2);
  expect(metrics.discard.x).toBeGreaterThan(WIDE / 2);
  expect(WIDE / 2 - metrics.stock.x).toBe(metrics.discard.x - WIDE / 2);
  expect(metrics.stock.y).toBe(TALL / 2);
  expect(metrics.discard.y).toBe(TALL / 2);
});

test("the card rows sit one edge in from the top and bottom", () => {
  const metrics = tableMetrics(WIDE, TALL);
  expect(metrics.opponentY).toBe(BASE_EDGE + BASE_CARD_H / 2);
  expect(metrics.handY).toBe(TALL - BASE_EDGE - BASE_CARD_H / 2);
});

test("the HUD band starts below the piles and above the hand", () => {
  const metrics = tableMetrics(WIDE, TALL);
  expect(metrics.hudTop).toBeGreaterThan(metrics.discard.y + metrics.cardH / 2);
  expect(metrics.hudTop).toBeLessThan(metrics.handY - metrics.cardH / 2);
});

test("a small viewport scales the cards down rather than overlapping the rows", () => {
  // A portrait phone: the design height is what bites here.
  const metrics = tableMetrics(390, 844);
  expect(metrics.scale).toBeLessThan(1);
  expect(metrics.cardW).toBeLessThan(BASE_CARD_W);
  expect(metrics.opponentY + metrics.cardH / 2).toBeLessThan(
    metrics.stock.y - metrics.cardH / 2
  );
  expect(metrics.hudTop).toBeLessThan(metrics.handY - metrics.cardH / 2);
});

test("scaling never collapses the table past the readable floor", () => {
  const metrics = tableMetrics(200, 200);
  expect(metrics.scale).toBe(0.5);
  expect(metrics.cardW).toBe(BASE_CARD_W / 2);
});
