import { expect, test } from "vitest";
import {
  cardLabel,
  describeAction,
  resultBanner,
  statusLine
} from "./status.ts";
import { initialState } from "./engine/game.ts";
import type { EngineState, Phase, Seat } from "./engine/game.ts";
import { cards } from "./engine/testCards.ts";

const NAMES: Record<Seat, string> = { a: "Alice", b: "Bob" };

// A hand-built state is enough here: these helpers only read phase, toAct,
// result, and the discard pile, never the rules.
function stateWith(patch: Partial<EngineState>): EngineState {
  return { ...initialState(42, "a"), ...patch };
}

// Every phase identifier the engine uses. No status line may ever print one:
// `upcardOfferNonDealer - seat a to act` was the old behaviour.
const PHASES: readonly Phase[] = [
  "awaitingStart",
  "upcardOfferNonDealer",
  "upcardOfferDealer",
  "forcedStockDraw",
  "draw",
  "discard",
  "handOver"
];

test("card labels use suit symbols", () => {
  const [king, seven] = cards("K:spades", "7:hearts");
  expect(cardLabel(king)).toBe("K♠");
  expect(cardLabel(seven)).toBe("7♥");
});

test("the status line addresses the viewer in the second person", () => {
  const state = stateWith({ phase: "discard", toAct: "a" });
  expect(statusLine(state, NAMES, "a")).toBe("Your turn — discard a card");
});

test("the status line names the other player rather than their seat", () => {
  const state = stateWith({ phase: "draw", toAct: "b" });
  expect(statusLine(state, NAMES, "a")).toBe("Bob is drawing");
});

test("the upcard offer explains both choices", () => {
  expect(
    statusLine(
      stateWith({ phase: "upcardOfferNonDealer", toAct: "a" }),
      NAMES,
      "a"
    )
  ).toBe("Your turn — take the upcard or pass");
  expect(
    statusLine(
      stateWith({ phase: "upcardOfferDealer", toAct: "b" }),
      NAMES,
      "a"
    )
  ).toBe("Waiting for Bob to take or pass");
});

test("the forced stock draw says so in both voices", () => {
  expect(
    statusLine(stateWith({ phase: "forcedStockDraw", toAct: "a" }), NAMES, "a")
  ).toBe("You must draw from the stock");
  expect(
    statusLine(stateWith({ phase: "forcedStockDraw", toAct: "b" }), NAMES, "a")
  ).toBe("Bob must draw from the stock");
});

test("a gin win reads as a win for whoever is looking", () => {
  const won = stateWith({
    phase: "handOver",
    toAct: null,
    result: { type: "gin", winner: "a", margin: 24 }
  });
  expect(statusLine(won, NAMES, "a")).toBe("Gin! You win by 24");
  expect(statusLine(won, NAMES, "b")).toBe("Alice wins by 24");
});

test("a dead hand explains why nobody won", () => {
  const dead = stateWith({
    phase: "handOver",
    toAct: null,
    result: { type: "dead" }
  });
  expect(statusLine(dead, NAMES, "a")).toBe("Dead hand — the stock ran out");
});

test("no status line leaks a phase identifier or a bare seat letter", () => {
  // `draw` and `discard` are ordinary English, so a substring check would be
  // meaningless; what must never appear is a camelCase identifier
  // (`upcardOfferNonDealer`, `forcedStockDraw`, `handOver`) or a seat letter.
  for (const phase of PHASES) {
    for (const toAct of ["a", "b", null] as const) {
      for (const viewer of ["a", "b"] as const) {
        const line = statusLine(stateWith({ phase, toAct }), NAMES, viewer);
        expect(line).not.toMatch(/[a-z][A-Z]/);
        expect(line).not.toMatch(/\bseat [ab]\b/i);
      }
    }
  }
});

test("the banner celebrates only the viewer", () => {
  const result = { type: "gin", winner: "a", margin: 24 } as const;
  expect(resultBanner(result, NAMES, "a")).toMatchObject({
    won: true,
    title: "Gin! You win"
  });
  expect(resultBanner(result, NAMES, "b")).toMatchObject({
    won: false,
    title: "Alice wins"
  });
});

test("the banner never celebrates a dead hand", () => {
  expect(resultBanner({ type: "dead" }, NAMES, "a")).toMatchObject({
    won: false,
    title: "Dead hand"
  });
});

// --- the action feed -------------------------------------------------------

const withUpcard = stateWith({ discardPile: cards("K:spades") });

test("the feed names the card taken from the discard pile", () => {
  expect(
    describeAction(withUpcard, { type: "takeUpcard", seat: "b" }, NAMES, "a")
  ).toBe("Bob took the K♠");
  expect(
    describeAction(withUpcard, { type: "drawDiscard", seat: "b" }, NAMES, "a")
  ).toBe("Bob took the K♠ from the pile");
});

test("the feed reports the viewer in the second person", () => {
  expect(
    describeAction(withUpcard, { type: "takeUpcard", seat: "a" }, NAMES, "a")
  ).toBe("You took the K♠");
});

test("a stock draw never names a card, for either player", () => {
  // The client holds the full engine state, so the drawn card is in memory.
  // Printing it - even for your own draw - would teach a reader when to look.
  const drawn = cards("7:hearts")[0];
  for (const seat of ["a", "b"] as const) {
    const line = describeAction(
      withUpcard,
      { type: "drawStock", seat },
      NAMES,
      "a"
    )!;
    expect(line).toContain("from the stock");
    expect(line).not.toContain(drawn.rank);
    expect(line).not.toContain("♥");
  }
});

test("a pass and a discard read plainly", () => {
  expect(
    describeAction(withUpcard, { type: "passUpcard", seat: "b" }, NAMES, "a")
  ).toBe("Bob passed");
  const [queen] = cards("Q:diamonds");
  expect(
    describeAction(
      withUpcard,
      { type: "discard", seat: "b", card: queen, declareGin: false },
      NAMES,
      "a"
    )
  ).toBe("Bob discarded the Q♦");
});

test("a declared gin is called out in the feed", () => {
  const [queen] = cards("Q:diamonds");
  expect(
    describeAction(
      withUpcard,
      { type: "discard", seat: "a", card: queen, declareGin: true },
      NAMES,
      "a"
    )
  ).toBe("You went gin, discarding the Q♦");
});

test("dealing a hand produces no feed entry", () => {
  expect(
    describeAction(withUpcard, { type: "startHand" }, NAMES, "a")
  ).toBeNull();
});
