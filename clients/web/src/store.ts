import { advance, initialState } from "./engine/game.ts";
import { cardKey } from "./engine/cards.ts";
import { describeAction } from "./status.ts";
import type { Action, EngineState, Seat } from "./engine/game.ts";
import type { Card } from "./engine/cards.ts";

export interface FeedEntry {
  readonly id: number;
  readonly text: string;
}

export interface GameSnapshot {
  readonly game: EngineState | null;
  readonly viewerSeat: Seat | null;
  // The display name shown on each seat, from the hand contract. Dev modes
  // and a contract that omits names fall back to static labels.
  readonly names: Record<Seat, string>;
  readonly selectedCard: Card | null;
  readonly autoGroup: boolean;
  readonly lastDrawn: { readonly seat: Seat; readonly card: Card } | null;
  // How each seat has chosen to arrange its own hand, as cardKeys; null means
  // the engine's order. Purely local presentation state - it is never stamped
  // into an action, so two clients may hold the same hand in different orders.
  // Keyed by seat because the ?solo hotseat flips perspective mid-hand.
  readonly handOrder: Readonly<Record<Seat, readonly string[] | null>>;
  // What just happened, oldest first. In gin you have to remember what your
  // opponent picked up two turns ago, so these persist for the hand rather
  // than fading.
  readonly feed: readonly FeedEntry[];
}

const DEFAULT_NAMES: Record<Seat, string> = { a: "Seat A", b: "Seat B" };
const NO_HAND_ORDER: Record<Seat, readonly string[] | null> = {
  a: null,
  b: null
};
const FEED_LIMIT = 4;

// The card an accepted draw added to the acting hand, tagged with whose
// draw it was so readers must say which seat they care about; anything
// else (a discard, a deal) ends the turn's "just drawn" marker.
function drawnBy(
  before: EngineState,
  after: EngineState,
  action: Action
): { seat: Seat; card: Card } | null {
  if (
    action.type !== "drawStock" &&
    action.type !== "drawDiscard" &&
    action.type !== "takeUpcard"
  ) {
    return null;
  }
  const held = new Set(before.hands[action.seat].map(cardKey));
  const card = after.hands[action.seat].find(
    (added) => !held.has(cardKey(added))
  );
  return card ? { seat: action.seat, card } : null;
}

export interface GameStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): GameSnapshot;
  start(contract: {
    seed: number;
    dealer: Seat;
    viewerSeat: Seat;
    names?: Record<Seat, string>;
  }): void;
  apply(action: Action): void;
  selectCard(card: Card | null): void;
  // Record a seat's manual arrangement - what a completed drag commits. It
  // takes over from auto-grouping: the two cannot both own the layout.
  setHandOrder(seat: Seat, keys: readonly string[]): void;
  // Hand the arrangement back to the meld search, discarding the manual order.
  autoSort(seat: Seat): void;
}

export function createGameStore(): GameStore {
  let snapshot: GameSnapshot = {
    game: null,
    viewerSeat: null,
    names: DEFAULT_NAMES,
    selectedCard: null,
    autoGroup: false,
    lastDrawn: null,
    handOrder: NO_HAND_ORDER,
    feed: []
  };
  const listeners = new Set<() => void>();
  // A counter, not a timestamp: feed ids only have to be stable React keys,
  // and the engine's ban on Date is a habit worth keeping at this layer too.
  let nextFeedId = 1;

  const replace = (next: GameSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    // A start rebuilds from scratch, per the resync contract: no UI
    // residue from the discarded game survives.
    start({ seed, dealer, viewerSeat, names }) {
      replace({
        ...snapshot,
        game: initialState(seed, dealer),
        viewerSeat,
        names: names ?? DEFAULT_NAMES,
        selectedCard: null,
        lastDrawn: null,
        handOrder: NO_HAND_ORDER,
        feed: []
      });
    },
    // Transport-fed actions arrive stamped and in order - sequencing and
    // dedup are the transport's job. The solo hotseat harness applies
    // directly by design; if apply ever grows sequencing parameters,
    // solo grows its trivial counter then. A rejection is a
    // deterministic no-op: state and subscribers stay untouched.
    apply(action) {
      if (!snapshot.game)
        throw new Error("action applied before the start contract");
      const before = snapshot.game;
      const result = advance(before, action);
      if (!result.ok) return;
      // A fresh deal must not inherit the last hand's arrangement or its
      // running commentary; both describe cards nobody holds any more.
      const dealt = action.type === "startHand";
      const entry = describeAction(
        before,
        action,
        snapshot.names,
        snapshot.viewerSeat
      );
      // Any real state change may invalidate what the pointer was over,
      // so an accepted action always resets the selection.
      replace({
        ...snapshot,
        game: result.state,
        selectedCard: null,
        lastDrawn: drawnBy(before, result.state, action),
        handOrder: dealt ? NO_HAND_ORDER : snapshot.handOrder,
        feed: dealt
          ? []
          : entry
            ? [...snapshot.feed, { id: nextFeedId++, text: entry }].slice(
                -FEED_LIMIT
              )
            : snapshot.feed
      });
    },
    selectCard(card) {
      replace({ ...snapshot, selectedCard: card });
    },
    setHandOrder(seat, keys) {
      replace({
        ...snapshot,
        autoGroup: false,
        handOrder: { ...snapshot.handOrder, [seat]: keys }
      });
    },
    autoSort(seat) {
      replace({
        ...snapshot,
        autoGroup: true,
        handOrder: { ...snapshot.handOrder, [seat]: null }
      });
    }
  };
}
