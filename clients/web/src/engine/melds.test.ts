import { expect, test } from 'vitest'
import fc from 'fast-check'
import { ginDiscards, minDeadwood } from './melds.ts'
import { RANKS, cardValue } from './cards.ts'
import { newDeck } from './deck.ts'
import { cards, sortedKeys } from './testCards.ts'
import type { Card } from './cards.ts'

// Independent oracle for the property tests below. It re-implements meld
// legality (rotate-and-check, not the engine's gap-count) and finds the
// true minimum by trying every disjoint combination of every meld-shaped
// subset of the hand. Slow and obviously correct.
function oracleIsMeld(candidate: readonly Card[]): boolean {
  if (candidate.length < 3) return false
  if (candidate.every((card) => card.rank === candidate[0].rank)) {
    return candidate.length <= 4
  }
  if (!candidate.every((card) => card.suit === candidate[0].suit)) return false
  const indexes = candidate.map((card) => RANKS.indexOf(card.rank))
  if (new Set(indexes).size !== indexes.length) return false
  for (let offset = 0; offset < RANKS.length; offset++) {
    const rotated = indexes
      .map((index) => (index + offset) % RANKS.length)
      .sort((a, b) => a - b)
    if (rotated.every((value, position) => value === position)) return true
  }
  return false
}

function oracleMinDeadwood(hand: readonly Card[]): number {
  const meldMasks: number[] = []
  for (let mask = 0; mask < 1 << hand.length; mask++) {
    const subset = hand.filter((_, index) => mask & (1 << index))
    if (subset.length >= 3 && oracleIsMeld(subset)) meldMasks.push(mask)
  }
  const handValue = hand.reduce((sum, card) => sum + cardValue(card.rank), 0)
  let best = handValue
  const search = (used: number, melded: number, from: number) => {
    best = Math.min(best, handValue - melded)
    for (let m = from; m < meldMasks.length; m++) {
      const mask = meldMasks[m]
      if ((mask & used) !== 0) continue
      const meldValue = hand.reduce(
        (sum, card, index) => (mask & (1 << index) ? sum + cardValue(card.rank) : sum),
        0,
      )
      search(used | mask, melded + meldValue, m + 1)
    }
  }
  search(0, 0, 0)
  return best
}

// Run-legality spec, asserted through the search that actually plays the
// game: a hand of two clean sets plus the probed trio melds fully exactly
// when the trio is a legal run, leaving only the named junk card.
test('an ace-low run melds: A-2-3 plus two sets leaves only the junk', () => {
  const hand = cards(
    'A:clubs', '2:clubs', '3:clubs', '6:diamonds', '6:hearts',
    '6:clubs', '9:diamonds', '9:hearts', '9:clubs', 'K:spades',
  )
  expect(minDeadwood(hand)).toBe(10)
})

test('an ace-high run melds: Q-K-A plus two sets leaves only the junk', () => {
  const hand = cards(
    'Q:spades', 'K:spades', 'A:spades', '6:diamonds', '6:hearts',
    '6:clubs', '9:diamonds', '9:hearts', '9:clubs', '4:hearts',
  )
  expect(minDeadwood(hand)).toBe(4)
})

test('a wrap run melds: K-A-2 plus two sets leaves only the junk', () => {
  const hand = cards(
    'K:diamonds', 'A:diamonds', '2:diamonds', '6:hearts', '6:clubs',
    '6:spades', '9:hearts', '9:clubs', '9:spades', '5:clubs',
  )
  expect(minDeadwood(hand)).toBe(5)
})

test('Q-A-2 is not a run: it skips the king, so all three count as deadwood', () => {
  const hand = cards(
    'Q:spades', 'A:spades', '2:spades', '6:diamonds', '6:hearts',
    '6:clubs', '9:diamonds', '9:hearts', '9:clubs', 'K:hearts',
  )
  expect(minDeadwood(hand)).toBe(23)
})

test('a hand with no melds is worth its full card total', () => {
  const hand = cards(
    'K:spades', 'Q:diamonds', 'A:clubs', '2:clubs', '9:diamonds',
    '4:hearts', '6:spades', '8:hearts', '10:diamonds', 'J:hearts',
  )
  expect(minDeadwood(hand)).toBe(70)
})

test('unmelded cards outside the single meld count as deadwood', () => {
  const hand = cards(
    '7:clubs', '7:diamonds', '7:hearts', 'K:spades', 'Q:diamonds',
    'A:clubs', '2:clubs', '9:diamonds', '4:hearts', '5:spades',
  )
  expect(minDeadwood(hand)).toBe(41)
})

test('a gin that requires splitting a four-of-a-kind is found', () => {
  const hand = cards(
    '5:clubs', '6:clubs', '7:clubs', '7:diamonds', '7:hearts',
    '7:spades', '8:clubs', '9:clubs', '10:clubs', 'J:clubs',
  )
  expect(minDeadwood(hand)).toBe(0)
})

test('a gin that requires splitting a long run is found', () => {
  const hand = cards(
    '3:spades', '4:spades', '5:spades', '6:spades', '6:diamonds',
    '6:hearts', '7:clubs', '8:clubs', '9:clubs', '10:clubs',
  )
  expect(minDeadwood(hand)).toBe(0)
})

test('a gin that requires a wrap run is found', () => {
  const hand = cards(
    'K:clubs', 'A:clubs', '2:clubs', '3:clubs', '5:diamonds',
    '5:hearts', '5:spades', '9:clubs', '9:diamonds', '9:hearts',
  )
  expect(minDeadwood(hand)).toBe(0)
})

test('ginDiscards names the one discard that leaves gin', () => {
  const hand = cards(
    '5:clubs', '6:clubs', '7:clubs', '7:diamonds', '7:hearts', '7:spades',
    '8:clubs', '9:clubs', '10:clubs', 'J:clubs', 'K:diamonds',
  )
  expect(sortedKeys(ginDiscards(hand))).toEqual(['K:diamonds'])
})

test('a fully melded 11-card hand offers every run-end discard', () => {
  const hand = cards(
    '2:clubs', '3:clubs', '4:clubs', '5:clubs', '6:clubs',
    '7:diamonds', '7:hearts', '7:spades', '9:diamonds', '9:hearts', '9:spades',
  )
  expect(sortedKeys(ginDiscards(hand))).toEqual(['2:clubs', '6:clubs'])
})

test('a gin reachable only through a wrap run is offered', () => {
  const hand = cards(
    'K:clubs', 'A:clubs', '2:clubs', '3:clubs', '5:diamonds', '5:hearts',
    '5:spades', '9:clubs', '9:diamonds', '9:hearts', 'Q:spades',
  )
  expect(sortedKeys(ginDiscards(hand))).toEqual(['Q:spades'])
})

test('a discard that leaves one point of deadwood is not gin', () => {
  const hand = cards(
    '5:clubs', '6:clubs', '7:clubs', '7:diamonds', '7:hearts', '7:spades',
    '8:clubs', '9:clubs', '10:clubs', 'J:clubs', 'A:diamonds',
  )
  expect(sortedKeys(ginDiscards(hand))).toEqual(['A:diamonds'])
})

test('a hand with no gin offers no discards', () => {
  const hand = cards(
    'K:spades', 'Q:diamonds', 'A:clubs', '2:clubs', '9:diamonds', '4:hearts',
    '6:spades', '8:hearts', '10:diamonds', 'J:hearts', '7:spades',
  )
  expect(ginDiscards(hand)).toEqual([])
})

test('minDeadwood matches the brute-force oracle on random 10-card hands', () => {
  fc.assert(
    fc.property(fc.shuffledSubarray(newDeck(), { minLength: 10, maxLength: 10 }), (hand) => {
      expect(minDeadwood(hand)).toBe(oracleMinDeadwood(hand))
    }),
  )
})
