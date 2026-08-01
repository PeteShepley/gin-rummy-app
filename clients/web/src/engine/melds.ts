import { RANKS, cardValue } from './cards.ts'
import type { Card, Rank, Suit } from './cards.ts'

const RANK_COUNT = RANKS.length

function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank)
}

export function isSet(cards: readonly Card[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false
  return cards.every((card) => card.rank === cards[0].rank)
}

// True when sorted rank indexes form a single contiguous arc on the
// 13-rank cycle (aces wrap): every cyclic step between neighbours is 1,
// except the one step that closes the circle.
function isOneCyclicArc(sortedIndexes: readonly number[]): boolean {
  let nonAdjacentSteps = 0
  for (let i = 0; i < sortedIndexes.length; i++) {
    const current = sortedIndexes[i]
    const next = sortedIndexes[(i + 1) % sortedIndexes.length]
    if ((next - current + RANK_COUNT) % RANK_COUNT !== 1) nonAdjacentSteps++
  }
  return nonAdjacentSteps <= 1
}

// A run is 3+ cards of one suit whose ranks are one cyclic arc.
export function isRun(cards: readonly Card[]): boolean {
  if (cards.length < 3 || cards.length > RANK_COUNT) return false
  if (!cards.every((card) => card.suit === cards[0].suit)) return false
  const indexes = [...new Set(cards.map((card) => rankIndex(card.rank)))].sort((a, b) => a - b)
  if (indexes.length !== cards.length) return false
  return isOneCyclicArc(indexes)
}

// Every candidate meld as a bitmask over hand indexes: all 3- and 4-card
// subsets of each rank, and every cyclic-contiguous same-suit window of
// length >= 3. Sub-melds are enumerated deliberately - some gins exist
// only by splitting a four-of-a-kind or a long run.
function candidateMeldMasks(hand: readonly Card[]): number[] {
  const masks = new Set<number>()

  const byRank = new Map<Rank, number[]>()
  const bySuit = new Map<Suit, Map<number, number>>()
  hand.forEach((card, index) => {
    const rankGroup = byRank.get(card.rank) ?? []
    rankGroup.push(index)
    byRank.set(card.rank, rankGroup)
    const suitRanks = bySuit.get(card.suit) ?? new Map<number, number>()
    suitRanks.set(rankIndex(card.rank), index)
    bySuit.set(card.suit, suitRanks)
  })

  for (const group of byRank.values()) {
    if (group.length < 3) continue
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        for (let c = b + 1; c < group.length; c++) {
          masks.add((1 << group[a]) | (1 << group[b]) | (1 << group[c]))
        }
      }
    }
    if (group.length === 4) {
      masks.add(group.reduce((mask, index) => mask | (1 << index), 0))
    }
  }

  for (const suitRanks of bySuit.values()) {
    for (let start = 0; start < RANK_COUNT; start++) {
      let mask = 0
      for (let length = 1; length <= RANK_COUNT; length++) {
        const index = suitRanks.get((start + length - 1) % RANK_COUNT)
        if (index === undefined) break
        mask |= 1 << index
        if (length >= 3) masks.add(mask)
      }
    }
  }

  return [...masks]
}

export function minDeadwood(hand: readonly Card[]): number {
  const meldMasks = candidateMeldMasks(hand)
  const values = hand.map((card) => cardValue(card.rank))
  const meldValues = meldMasks.map((mask) =>
    values.reduce((sum, value, index) => (mask & (1 << index) ? sum + value : sum), 0),
  )
  const total = values.reduce((sum, value) => sum + value, 0)
  // Highest total value meldable with disjoint melds picked from position
  // `from` onwards, given the cards already used.
  const bestMelded = (used: number, from: number): number => {
    let best = 0
    for (let i = from; i < meldMasks.length; i++) {
      if ((meldMasks[i] & used) === 0) {
        const candidate = meldValues[i] + bestMelded(used | meldMasks[i], i + 1)
        if (candidate > best) best = candidate
      }
    }
    return best
  }
  return total - bestMelded(0, 0)
}

// Which discards from an 11-card hand leave the remaining ten fully
// melded. Drives the UI's declare-gin offer.
export function ginDiscards(hand: readonly Card[]): Card[] {
  return hand.filter(
    (_, discarded) => minDeadwood(hand.filter((_, kept) => kept !== discarded)) === 0,
  )
}
