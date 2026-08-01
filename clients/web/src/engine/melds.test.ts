import { expect, test } from 'vitest'
import fc from 'fast-check'
import { ginDiscards, isRun, isSet, minDeadwood } from './melds.ts'
import { RANKS, cardValue } from './cards.ts'
import { newDeck } from './deck.ts'
import type { Card, Rank, Suit } from './cards.ts'

function cards(...specs: string[]): Card[] {
  return specs.map((spec) => {
    const [rank, suit] = spec.split(':')
    return { rank: rank as Rank, suit: suit as Suit }
  })
}

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

test('three or more consecutive cards of one suit form a run', () => {
  expect(isRun(cards('A:clubs', '2:clubs', '3:clubs'))).toBe(true)
  expect(isRun(cards('4:hearts', '5:hearts', '6:hearts', '7:hearts'))).toBe(true)
})

test('runs wrap round the corner', () => {
  expect(isRun(cards('Q:spades', 'K:spades', 'A:spades'))).toBe(true)
  expect(isRun(cards('K:diamonds', 'A:diamonds', '2:diamonds'))).toBe(true)
  expect(isRun(cards('J:clubs', 'Q:clubs', 'K:clubs', 'A:clubs', '2:clubs'))).toBe(true)
})

test('non-contiguous ranks are not a run, even near the corner', () => {
  expect(isRun(cards('Q:spades', 'A:spades', '2:spades'))).toBe(false)
  expect(isRun(cards('3:clubs', '4:clubs', '6:clubs'))).toBe(false)
})

test('a run needs one suit and at least three cards', () => {
  expect(isRun(cards('4:hearts', '5:spades', '6:hearts'))).toBe(false)
  expect(isRun(cards('4:hearts', '5:hearts'))).toBe(false)
})

test('run recognition ignores the order the cards are held in', () => {
  expect(isRun(cards('3:clubs', 'A:clubs', '2:clubs'))).toBe(true)
  expect(isRun(cards('A:spades', 'Q:spades', 'K:spades'))).toBe(true)
})

test('three or four cards of one rank form a set', () => {
  expect(isSet(cards('7:clubs', '7:diamonds', '7:hearts'))).toBe(true)
  expect(isSet(cards('Q:clubs', 'Q:diamonds', 'Q:hearts', 'Q:spades'))).toBe(true)
})

test('fewer than three cards or mixed ranks are not a set', () => {
  expect(isSet(cards('7:clubs', '7:diamonds'))).toBe(false)
  expect(isSet(cards('7:clubs', '7:diamonds', '8:hearts'))).toBe(false)
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

function sortedKeys(found: readonly Card[]): string[] {
  return found.map((card) => `${card.rank}:${card.suit}`).sort()
}

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
    fc.property(fc.subarray(newDeck(), { minLength: 10, maxLength: 10 }), (hand) => {
      expect(minDeadwood(hand)).toBe(oracleMinDeadwood(hand))
    }),
  )
})
