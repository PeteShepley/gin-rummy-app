import { expect, test, vi } from "vitest";
import { createGameStore } from "./store.ts";
import { cards } from "./engine/testCards.ts";

test("a new store has no game and its snapshot is referentially stable", () => {
  const store = createGameStore();
  expect(store.getSnapshot().game).toBeNull();
  expect(store.getSnapshot()).toBe(store.getSnapshot());
});

test("start creates the engine from the hand contract and notifies subscribers", () => {
  const store = createGameStore();
  const listener = vi.fn();
  store.subscribe(listener);
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  expect(listener).toHaveBeenCalledTimes(1);
  const snapshot = store.getSnapshot();
  expect(snapshot.game?.phase).toBe("awaitingStart");
  expect(snapshot.game?.dealer).toBe("a");
  expect(snapshot.viewerSeat).toBe("b");
});

test("applying a stamped action advances the game in a new snapshot", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  const before = store.getSnapshot();
  const listener = vi.fn();
  store.subscribe(listener);
  store.apply({ type: "startHand" });
  expect(listener).toHaveBeenCalledTimes(1);
  const after = store.getSnapshot();
  expect(after).not.toBe(before);
  expect(after.game?.phase).toBe("upcardOfferNonDealer");
  expect(after.game?.hands.b).toHaveLength(10);
});

test("a rejected action changes nothing and notifies nobody", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  const before = store.getSnapshot();
  const listener = vi.fn();
  store.subscribe(listener);
  store.apply({ type: "startHand" });
  expect(store.getSnapshot()).toBe(before);
  expect(listener).not.toHaveBeenCalled();
});

test("selecting a card is UI state: new snapshot, subscribers notified", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  const listener = vi.fn();
  store.subscribe(listener);
  const card = cards("4:diamonds")[0];
  store.selectCard(card);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().selectedCard).toEqual(card);
  store.selectCard(null);
  expect(store.getSnapshot().selectedCard).toBeNull();
});

test("an accepted action clears the selection; a rejected one leaves it", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  store.selectCard(cards("4:diamonds")[0]);
  store.apply({ type: "startHand" });
  expect(store.getSnapshot().selectedCard).toEqual(cards("4:diamonds")[0]);
  store.apply({ type: "passUpcard", seat: "b" });
  expect(store.getSnapshot().selectedCard).toBeNull();
});

test("a stamped action arriving before the start contract fails loudly", () => {
  const store = createGameStore();
  expect(() => store.apply({ type: "startHand" })).toThrow(
    "before the start contract"
  );
});

test("the just-drawn card is remembered, with its seat, until the turn ends", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  expect(store.getSnapshot().lastDrawn).toBeNull();
  store.apply({ type: "passUpcard", seat: "b" });
  store.apply({ type: "passUpcard", seat: "a" });
  const stockTop = store.getSnapshot().game!.stock[0];
  store.apply({ type: "drawStock", seat: "b" });
  expect(store.getSnapshot().lastDrawn).toEqual({ seat: "b", card: stockTop });
  const held = store.getSnapshot().game!.hands.b[0];
  store.apply({ type: "discard", seat: "b", card: held, declareGin: false });
  expect(store.getSnapshot().lastDrawn).toBeNull();
});

test("taking the upcard also marks the drawn card with its seat", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  const pile = store.getSnapshot().game!.discardPile;
  const upcard = pile[pile.length - 1];
  store.apply({ type: "takeUpcard", seat: "b" });
  expect(store.getSnapshot().lastDrawn).toEqual({ seat: "b", card: upcard });
});

test("start rebuilds from scratch: selection and draw marker reset", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  store.apply({ type: "passUpcard", seat: "b" });
  store.apply({ type: "passUpcard", seat: "a" });
  store.apply({ type: "drawStock", seat: "b" });
  store.selectCard(store.getSnapshot().game!.hands.b[0]);
  expect(store.getSnapshot().lastDrawn).not.toBeNull();
  expect(store.getSnapshot().selectedCard).not.toBeNull();
  store.start({ seed: 7, dealer: "a", viewerSeat: "b" });
  expect(store.getSnapshot().selectedCard).toBeNull();
  expect(store.getSnapshot().lastDrawn).toBeNull();
});

test("auto-sort is a persistent preference: notifies, survives actions", () => {
  const store = createGameStore();
  expect(store.getSnapshot().autoGroup).toBe(false);
  const listener = vi.fn();
  store.subscribe(listener);
  store.autoSort("b");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().autoGroup).toBe(true);
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  expect(store.getSnapshot().autoGroup).toBe(true);
});

// --- manual hand order -----------------------------------------------------

test("a manual hand order takes over from auto-grouping", () => {
  // The two cannot both own the layout, so committing a drag turns grouping off.
  const store = createGameStore();
  store.autoSort("b");
  expect(store.getSnapshot().autoGroup).toBe(true);
  store.setHandOrder("b", ["4:diamonds", "K:spades"]);
  expect(store.getSnapshot().autoGroup).toBe(false);
  expect(store.getSnapshot().handOrder.b).toEqual(["4:diamonds", "K:spades"]);
});

test("auto-sorting discards the manual order for that seat alone", () => {
  const store = createGameStore();
  store.setHandOrder("a", ["A:clubs"]);
  store.setHandOrder("b", ["K:spades"]);
  store.autoSort("b");
  expect(store.getSnapshot().handOrder.b).toBeNull();
  expect(store.getSnapshot().handOrder.a).toEqual(["A:clubs"]);
});

test("a manual order survives draws and discards within the hand", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  store.setHandOrder("b", ["4:diamonds", "K:spades"]);
  store.apply({ type: "passUpcard", seat: "b" });
  store.apply({ type: "passUpcard", seat: "a" });
  store.apply({ type: "drawStock", seat: "b" });
  const held = store.getSnapshot().game!.hands.b[0];
  store.apply({ type: "discard", seat: "b", card: held, declareGin: false });
  expect(store.getSnapshot().handOrder.b).toEqual(["4:diamonds", "K:spades"]);
});

test("dealing clears the manual order, which named cards nobody holds now", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.setHandOrder("b", ["4:diamonds", "K:spades"]);
  store.apply({ type: "startHand" });
  expect(store.getSnapshot().handOrder).toEqual({ a: null, b: null });
});

// --- the action feed -------------------------------------------------------

test("the feed records what each player did, newest last", () => {
  const store = createGameStore();
  store.start({
    seed: 42,
    dealer: "a",
    viewerSeat: "b",
    names: { a: "Alice", b: "Bob" }
  });
  store.apply({ type: "startHand" });
  expect(store.getSnapshot().feed).toEqual([]);
  store.apply({ type: "passUpcard", seat: "b" });
  store.apply({ type: "passUpcard", seat: "a" });
  const texts = store.getSnapshot().feed.map((entry) => entry.text);
  expect(texts).toEqual(["You passed", "Alice passed"]);
});

test("the feed caps at four entries and keeps the most recent", () => {
  const store = createGameStore();
  store.start({
    seed: 42,
    dealer: "a",
    viewerSeat: "b",
    names: { a: "Alice", b: "Bob" }
  });
  store.apply({ type: "startHand" });
  store.apply({ type: "passUpcard", seat: "b" });
  store.apply({ type: "passUpcard", seat: "a" });
  store.apply({ type: "drawStock", seat: "b" });
  store.apply({
    type: "discard",
    seat: "b",
    card: store.getSnapshot().game!.hands.b[0],
    declareGin: false
  });
  store.apply({ type: "drawStock", seat: "a" });
  const feed = store.getSnapshot().feed;
  expect(feed).toHaveLength(4);
  expect(feed[3].text).toBe("Alice drew from the stock");
  expect(feed.map((entry) => entry.id)).toEqual([2, 3, 4, 5]);
});

test("a fresh deal clears the feed", () => {
  const store = createGameStore();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  store.apply({ type: "startHand" });
  store.apply({ type: "passUpcard", seat: "b" });
  expect(store.getSnapshot().feed.length).toBeGreaterThan(0);
  store.start({ seed: 7, dealer: "a", viewerSeat: "b" });
  expect(store.getSnapshot().feed).toEqual([]);
  expect(store.getSnapshot().handOrder).toEqual({ a: null, b: null });
});

test("unsubscribing stops notifications", () => {
  const store = createGameStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  unsubscribe();
  store.start({ seed: 42, dealer: "a", viewerSeat: "b" });
  expect(listener).not.toHaveBeenCalled();
});
