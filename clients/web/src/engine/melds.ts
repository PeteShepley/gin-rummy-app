import { RANKS, SUITS, cardValue } from './cards.ts'
import type { Card, Rank, Suit } from './cards.ts'

const RANK_COUNT = RANKS.length

function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank)
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

// A meld reads naturally: a set by suit order, a run walked along its
// arc (so a wrap run reads K, A, 2 across the corner). The arc starts
// at the one rank whose predecessor is not in the run.
function orderMeld(meld: readonly Card[]): Card[] {
  if (meld.every((held) => held.rank === meld[0].rank)) {
    return [...meld].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit))
  }
  const present = new Set(meld.map((held) => rankIndex(held.rank)))
  let start = rankIndex(meld[0].rank)
  for (const held of meld) {
    const index = rankIndex(held.rank)
    if (!present.has((index + RANK_COUNT - 1) % RANK_COUNT)) start = index
  }
  const byIndex = new Map(meld.map((held) => [rankIndex(held.rank), held]))
  return Array.from(
    { length: meld.length },
    (_, step) => byIndex.get((start + step) % RANK_COUNT)!,
  )
}

export interface Arrangement {
  readonly melds: readonly (readonly Card[])[]
  readonly deadwood: readonly Card[]
}

// The best way to hold the hand: disjoint melds maximising melded value,
// remainder as deadwood. Deterministic - ties keep the first arrangement
// the search reaches - so both clients always lay down the same proof.
export function bestArrangement(hand: readonly Card[]): Arrangement {
  const meldMasks = candidateMeldMasks(hand)
  const values = hand.map((card) => cardValue(card.rank))
  const meldValues = meldMasks.map((mask) =>
    values.reduce((sum, value, index) => (mask & (1 << index) ? sum + value : sum), 0),
  )
  let bestValue = -1
  let bestMasks: number[] = []
  const search = (used: number, melded: number, from: number, chosen: number[]) => {
    if (melded > bestValue) {
      bestValue = melded
      bestMasks = [...chosen]
    }
    for (let i = from; i < meldMasks.length; i++) {
      if ((meldMasks[i] & used) === 0) {
        chosen.push(meldMasks[i])
        search(used | meldMasks[i], melded + meldValues[i], i + 1, chosen)
        chosen.pop()
      }
    }
  }
  search(0, 0, 0, [])
  const melded = bestMasks.reduce((all, mask) => all | mask, 0)
  return {
    melds: bestMasks.map((mask) => orderMeld(hand.filter((_, index) => mask & (1 << index)))),
    deadwood: hand.filter((_, index) => !(melded & (1 << index))),
  }
}

export function minDeadwood(hand: readonly Card[]): number {
  return bestArrangement(hand).deadwood.reduce((sum, held) => sum + cardValue(held.rank), 0)
}

// Which discards from an 11-card hand leave the remaining ten fully
// melded. Drives the UI's declare-gin offer.
export function ginDiscards(hand: readonly Card[]): Card[] {
  return hand.filter(
    (_, discardIndex) => minDeadwood(hand.filter((_, keptIndex) => keptIndex !== discardIndex)) === 0,
  )
}
