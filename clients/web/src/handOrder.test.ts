import { expect, test } from "vitest";
import { moveKey, orderHand } from "./handOrder.ts";
import { cards } from "./engine/testCards.ts";
import { cardKey } from "./engine/cards.ts";

const keys = (hand: readonly { rank: string; suit: string }[]) =>
  hand.map((card) => `${card.rank}:${card.suit}`);

test("a null order leaves the hand in the engine order", () => {
  const hand = cards("4:diamonds", "K:spades", "A:clubs");
  expect(orderHand(hand, null)).toBe(hand);
});

test("a manual order rearranges the hand to match it", () => {
  const hand = cards("4:diamonds", "K:spades", "A:clubs");
  const arranged = orderHand(hand, ["A:clubs", "K:spades", "4:diamonds"]);
  expect(keys(arranged)).toEqual(["A:clubs", "K:spades", "4:diamonds"]);
});

test("a card the order does not name lands at the right-hand end", () => {
  // The just-drawn card: the order predates it, so it joins on the right
  // rather than jumping into the middle of an arrangement.
  const hand = cards("4:diamonds", "K:spades", "A:clubs", "7:hearts");
  const arranged = orderHand(hand, ["A:clubs", "K:spades", "4:diamonds"]);
  expect(keys(arranged)).toEqual([
    "A:clubs",
    "K:spades",
    "4:diamonds",
    "7:hearts"
  ]);
});

test("a key for a card no longer held is ignored", () => {
  // The K was discarded; the rest of the arrangement must survive intact.
  const hand = cards("4:diamonds", "A:clubs");
  const arranged = orderHand(hand, ["A:clubs", "K:spades", "4:diamonds"]);
  expect(keys(arranged)).toEqual(["A:clubs", "4:diamonds"]);
});

test("a duplicated key does not place the same card twice", () => {
  const hand = cards("4:diamonds", "A:clubs");
  const arranged = orderHand(hand, ["A:clubs", "A:clubs", "4:diamonds"]);
  expect(arranged.map(cardKey)).toEqual(["A:clubs", "4:diamonds"]);
});

test("an empty order still shows the whole hand", () => {
  const hand = cards("4:diamonds", "A:clubs");
  expect(keys(orderHand(hand, []))).toEqual(["4:diamonds", "A:clubs"]);
});

test("moveKey moves a card rightwards", () => {
  expect(moveKey(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
});

test("moveKey moves a card leftwards", () => {
  expect(moveKey(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
});

test("moveKey clamps a drag past either end to that end", () => {
  expect(moveKey(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
  expect(moveKey(["a", "b", "c"], 1, -5)).toEqual(["b", "a", "c"]);
});

test("moveKey leaves the list alone when the source index is out of range", () => {
  expect(moveKey(["a", "b"], 7, 0)).toEqual(["a", "b"]);
});
