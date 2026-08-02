import { advance, initialState } from './engine/game.ts'
import { cardKey } from './engine/cards.ts'
import type { Action, EngineState, Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'

export interface GameSnapshot {
  readonly game: EngineState | null
  readonly viewerSeat: Seat | null
  // The display name shown on each seat, from the hand contract. Dev modes
  // and a contract that omits names fall back to static labels.
  readonly names: Record<Seat, string>
  readonly selectedCard: Card | null
  readonly autoGroup: boolean
  readonly lastDrawn: { readonly seat: Seat; readonly card: Card } | null
}

const DEFAULT_NAMES: Record<Seat, string> = { a: 'Seat A', b: 'Seat B' }

// The card an accepted draw added to the acting hand, tagged with whose
// draw it was so readers must say which seat they care about; anything
// else (a discard, a deal) ends the turn's "just drawn" marker.
function drawnBy(
  before: EngineState,
  after: EngineState,
  action: Action,
): { seat: Seat; card: Card } | null {
  if (
    action.type !== 'drawStock' &&
    action.type !== 'drawDiscard' &&
    action.type !== 'takeUpcard'
  ) {
    return null
  }
  const held = new Set(before.hands[action.seat].map(cardKey))
  const card = after.hands[action.seat].find((added) => !held.has(cardKey(added)))
  return card ? { seat: action.seat, card } : null
}

export interface GameStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): GameSnapshot
  start(contract: {
    seed: number
    dealer: Seat
    viewerSeat: Seat
    names?: Record<Seat, string>
  }): void
  apply(action: Action): void
  selectCard(card: Card | null): void
  toggleAutoGroup(): void
}

export function createGameStore(): GameStore {
  let snapshot: GameSnapshot = {
    game: null,
    viewerSeat: null,
    names: DEFAULT_NAMES,
    selectedCard: null,
    autoGroup: false,
    lastDrawn: null,
  }
  const listeners = new Set<() => void>()

  const replace = (next: GameSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
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
      })
    },
    // Transport-fed actions arrive stamped and in order - sequencing and
    // dedup are the transport's job. The solo hotseat harness applies
    // directly by design; if apply ever grows sequencing parameters,
    // solo grows its trivial counter then. A rejection is a
    // deterministic no-op: state and subscribers stay untouched.
    apply(action) {
      if (!snapshot.game) throw new Error('action applied before the start contract')
      const result = advance(snapshot.game, action)
      if (!result.ok) return
      // Any real state change may invalidate what the pointer was over,
      // so an accepted action always resets the selection.
      replace({
        ...snapshot,
        game: result.state,
        selectedCard: null,
        lastDrawn: drawnBy(snapshot.game, result.state, action),
      })
    },
    selectCard(card) {
      replace({ ...snapshot, selectedCard: card })
    },
    toggleAutoGroup() {
      replace({ ...snapshot, autoGroup: !snapshot.autoGroup })
    },
  }
}
