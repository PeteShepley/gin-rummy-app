import { cardKey } from './engine/cards.ts'
import type { Card } from './engine/cards.ts'

// How the viewer has chosen to arrange their own hand. This is presentation
// state the engine never reads (per the design's "cards are identities, never
// indexes"), so it lives here rather than in engine/: it is per-client, is
// never stamped into an action, and two players may hold the same hand in
// different orders.

// Resolve a hand into display order. `order` is a list of cardKeys; a card the
// order does not name - one just drawn - goes to the right-hand end, and a key
// for a card no longer held - one just discarded - is skipped. `null` means the
// caller wants the engine's own order.
export function orderHand(
  hand: readonly Card[],
  order: readonly string[] | null,
): readonly Card[] {
  if (!order) return hand
  const held = new Map(hand.map((card) => [cardKey(card), card]))
  const arranged: Card[] = []
  for (const key of order) {
    const card = held.get(key)
    if (!card) continue // discarded since the order was recorded
    held.delete(key) // a duplicated key must not place the same card twice
    arranged.push(card)
  }
  // Whatever the order never mentioned is new; newest goes to the right.
  return [...arranged, ...held.values()]
}

// Move one key within the list. Drives the live drag preview: the dragged card
// is lifted out and re-inserted, so its neighbours close up and slide aside.
export function moveKey(order: readonly string[], from: number, to: number): string[] {
  const next = [...order]
  if (from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1)
  // Clamp rather than reject, so a pointer dragged past either end simply
  // parks the card at that end.
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}
