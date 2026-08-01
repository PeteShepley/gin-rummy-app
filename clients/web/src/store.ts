import { advance, initialState } from './engine/game.ts'
import type { Action, EngineState, Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'

export interface GameSnapshot {
  readonly game: EngineState | null
  readonly viewerSeat: Seat | null
  readonly selectedCard: Card | null
}

export interface GameStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): GameSnapshot
  start(contract: { seed: number; dealer: Seat; viewerSeat: Seat }): void
  apply(action: Action): void
  selectCard(card: Card | null): void
}

export function createGameStore(): GameStore {
  let snapshot: GameSnapshot = { game: null, viewerSeat: null, selectedCard: null }
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
    start({ seed, dealer, viewerSeat }) {
      replace({ ...snapshot, game: initialState(seed, dealer), viewerSeat })
    },
    // Stamped, in-order actions only - sequencing and dedup are the
    // transport's job. A rejection is a deterministic no-op: state and
    // subscribers stay untouched.
    apply(action) {
      if (!snapshot.game) throw new Error('action applied before the start contract')
      const result = advance(snapshot.game, action)
      if (!result.ok) return
      // Any real state change may invalidate what the pointer was over,
      // so an accepted action always resets the selection.
      replace({ ...snapshot, game: result.state, selectedCard: null })
    },
    selectCard(card) {
      replace({ ...snapshot, selectedCard: card })
    },
  }
}
