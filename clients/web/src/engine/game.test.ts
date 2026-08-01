import { expect, test } from 'vitest'
import fc from 'fast-check'
import { advance, initialState, legalActions } from './game.ts'
import { cards, sortedKeys } from './testCards.ts'
import type { Action, EngineState } from './game.ts'

// Applies an action that is expected to be legal; throws on rejection so
// test arrange steps fail loudly.
function apply(state: EngineState, action: Action): EngineState {
  const result = advance(state, action)
  if (!result.ok) throw new Error(`rejected: ${result.reason}`)
  return result.state
}

// Golden deal derived from the reference seed-42 shuffle (see
// deck.test.ts): cards are dealt one at a time alternating from the top,
// non-dealer first; the 21st card is the upcard; the rest is the stock,
// top first.
test('startHand deals the reference hands for seed 42', () => {
  const state = apply(initialState(42, 'a'), { type: 'startHand' })
  expect(sortedKeys(state.hands.b)).toEqual(
    sortedKeys(
      cards(
        '4:diamonds', 'K:hearts', '4:clubs', '7:hearts', '6:spades',
        '10:diamonds', '6:clubs', '8:hearts', '3:clubs', '9:hearts',
      ),
    ),
  )
  expect(sortedKeys(state.hands.a)).toEqual(
    sortedKeys(
      cards(
        'J:clubs', 'Q:clubs', '7:spades', 'A:clubs', '9:spades',
        'J:diamonds', '10:clubs', '2:hearts', 'Q:hearts', '5:spades',
      ),
    ),
  )
  expect(state.discard).toEqual(cards('7:clubs'))
  expect(state.stock).toHaveLength(31)
  expect(state.stock.slice(0, 3)).toEqual(cards('8:diamonds', '3:diamonds', 'A:spades'))
})

test('the deal leaves the PRNG state advanced, so a redeal continues the stream', () => {
  const state = apply(initialState(42, 'a'), { type: 'startHand' })
  expect(state.prng).toBe(3215543289)
})

test('after the deal the non-dealer is offered the upcard', () => {
  const state = apply(initialState(42, 'a'), { type: 'startHand' })
  expect(state.phase).toBe('upcardOfferNonDealer')
  expect(state.toAct).toBe('b')
})

test('startHand is rejected while a hand is in progress', () => {
  const state = apply(initialState(42, 'a'), { type: 'startHand' })
  expect(advance(state, { type: 'startHand' })).toEqual({ ok: false, reason: 'wrongPhase' })
})

// The seed-42 deal: dealer 'a', non-dealer 'b', upcard 7:clubs.
function dealtState(): EngineState {
  return apply(initialState(42, 'a'), { type: 'startHand' })
}

test('taking the upcard is that player’s draw: they discard next', () => {
  const state = apply(dealtState(), { type: 'takeUpcard', seat: 'b' })
  expect(sortedKeys(state.hands.b)).toContain('7:clubs')
  expect(state.hands.b).toHaveLength(11)
  expect(state.discard).toHaveLength(0)
  expect(state.phase).toBe('discard')
  expect(state.toAct).toBe('b')
  expect(state.takenFromDiscard).toEqual(cards('7:clubs')[0])
})

test('when the non-dealer passes, the dealer is offered the upcard', () => {
  const state = apply(dealtState(), { type: 'passUpcard', seat: 'b' })
  expect(state.phase).toBe('upcardOfferDealer')
  expect(state.toAct).toBe('a')
  expect(state.discard).toEqual(cards('7:clubs'))
})

test('the dealer may take the passed upcard', () => {
  const afterPass = apply(dealtState(), { type: 'passUpcard', seat: 'b' })
  const state = apply(afterPass, { type: 'takeUpcard', seat: 'a' })
  expect(sortedKeys(state.hands.a)).toContain('7:clubs')
  expect(state.hands.a).toHaveLength(11)
  expect(state.phase).toBe('discard')
  expect(state.toAct).toBe('a')
  expect(state.takenFromDiscard).toEqual(cards('7:clubs')[0])
})

test('when both pass, the non-dealer must draw from the stock', () => {
  const afterPass = apply(dealtState(), { type: 'passUpcard', seat: 'b' })
  const state = apply(afterPass, { type: 'passUpcard', seat: 'a' })
  expect(state.phase).toBe('forcedStockDraw')
  expect(state.toAct).toBe('b')
  expect(state.discard).toEqual(cards('7:clubs'))
})

test('only the offered seat may act on the upcard', () => {
  expect(advance(dealtState(), { type: 'takeUpcard', seat: 'a' })).toEqual({
    ok: false,
    reason: 'wrongSeat',
  })
  const afterPass = apply(dealtState(), { type: 'passUpcard', seat: 'b' })
  expect(advance(afterPass, { type: 'passUpcard', seat: 'b' })).toEqual({
    ok: false,
    reason: 'wrongSeat',
  })
})

// Both players pass the upcard, so 'b' faces the forced stock draw.
function forcedDrawState(): EngineState {
  const afterPass = apply(dealtState(), { type: 'passUpcard', seat: 'b' })
  return apply(afterPass, { type: 'passUpcard', seat: 'a' })
}

// 'b' completes the first turn: forced stock draw, then discards the
// 4:diamonds dealt to them. 'a' is next, in the draw phase.
function secondTurnState(): EngineState {
  const drawn = apply(forcedDrawState(), { type: 'drawStock', seat: 'b' })
  return apply(drawn, { type: 'discard', seat: 'b', card: cards('4:diamonds')[0], declareGin: false })
}

test('the forced stock draw takes the top of the stock', () => {
  const state = apply(forcedDrawState(), { type: 'drawStock', seat: 'b' })
  expect(state.hands.b).toHaveLength(11)
  expect(sortedKeys(state.hands.b)).toContain('8:diamonds')
  expect(state.stock).toHaveLength(30)
  expect(state.phase).toBe('discard')
  expect(state.toAct).toBe('b')
  expect(state.takenFromDiscard).toBeNull()
})

test('the forced draw must come from the stock, by the forced seat', () => {
  expect(advance(forcedDrawState(), { type: 'drawDiscard', seat: 'b' })).toEqual({
    ok: false,
    reason: 'wrongPhase',
  })
  expect(advance(forcedDrawState(), { type: 'drawStock', seat: 'a' })).toEqual({
    ok: false,
    reason: 'wrongSeat',
  })
})

test('discarding ends the turn: the pile gains the card, the opponent draws next', () => {
  const state = secondTurnState()
  expect(state.hands.b).toHaveLength(10)
  expect(sortedKeys(state.hands.b)).not.toContain('4:diamonds')
  expect(state.discard).toEqual(cards('7:clubs', '4:diamonds'))
  expect(state.phase).toBe('draw')
  expect(state.toAct).toBe('a')
  expect(state.takenFromDiscard).toBeNull()
})

test('a normal turn may draw from the stock', () => {
  const state = apply(secondTurnState(), { type: 'drawStock', seat: 'a' })
  expect(state.hands.a).toHaveLength(11)
  expect(sortedKeys(state.hands.a)).toContain('3:diamonds')
  expect(state.stock).toHaveLength(29)
  expect(state.phase).toBe('discard')
  expect(state.toAct).toBe('a')
  expect(state.takenFromDiscard).toBeNull()
})

test('a normal turn may draw the top of the discard pile', () => {
  const state = apply(secondTurnState(), { type: 'drawDiscard', seat: 'a' })
  expect(state.hands.a).toHaveLength(11)
  expect(sortedKeys(state.hands.a)).toContain('4:diamonds')
  expect(state.discard).toEqual(cards('7:clubs'))
  expect(state.phase).toBe('discard')
  expect(state.takenFromDiscard).toEqual(cards('4:diamonds')[0])
})

test('turns alternate: after the second turn the first player draws again', () => {
  const drawn = apply(secondTurnState(), { type: 'drawStock', seat: 'a' })
  const state = apply(drawn, { type: 'discard', seat: 'a', card: cards('J:clubs')[0], declareGin: false })
  expect(state.phase).toBe('draw')
  expect(state.toAct).toBe('b')
})

test('draw and discard actions are rejected out of phase or out of turn', () => {
  expect(
    advance(secondTurnState(), {
      type: 'discard', seat: 'a', card: cards('J:clubs')[0], declareGin: false,
    }),
  ).toEqual({ ok: false, reason: 'wrongPhase' })
  const drawn = apply(secondTurnState(), { type: 'drawStock', seat: 'a' })
  expect(advance(drawn, { type: 'drawStock', seat: 'a' })).toEqual({
    ok: false,
    reason: 'wrongPhase',
  })
  expect(advance(secondTurnState(), { type: 'drawStock', seat: 'b' })).toEqual({
    ok: false,
    reason: 'wrongSeat',
  })
})

test('the card taken from the discard pile cannot go straight back', () => {
  const drawn = apply(secondTurnState(), { type: 'drawDiscard', seat: 'a' })
  expect(
    advance(drawn, { type: 'discard', seat: 'a', card: cards('4:diamonds')[0], declareGin: false }),
  ).toEqual({ ok: false, reason: 'cannotDiscardTakenCard' })
})

test('the taken upcard cannot go straight back either', () => {
  const taken = apply(dealtState(), { type: 'takeUpcard', seat: 'b' })
  expect(
    advance(taken, { type: 'discard', seat: 'b', card: cards('7:clubs')[0], declareGin: false }),
  ).toEqual({ ok: false, reason: 'cannotDiscardTakenCard' })
})

test('the taken card may be discarded on a later turn', () => {
  const aTook = apply(secondTurnState(), { type: 'drawDiscard', seat: 'a' })
  const aDone = apply(aTook, { type: 'discard', seat: 'a', card: cards('Q:clubs')[0], declareGin: false })
  const bDrew = apply(aDone, { type: 'drawStock', seat: 'b' })
  const bDone = apply(bDrew, { type: 'discard', seat: 'b', card: cards('K:hearts')[0], declareGin: false })
  const aDrewStock = apply(bDone, { type: 'drawStock', seat: 'a' })
  const state = apply(aDrewStock, {
    type: 'discard', seat: 'a', card: cards('4:diamonds')[0], declareGin: false,
  })
  expect(sortedKeys(state.hands.a)).not.toContain('4:diamonds')
  expect(state.discard[state.discard.length - 1]).toEqual(cards('4:diamonds')[0])
})

test('a card drawn from the stock may be discarded immediately', () => {
  const drawn = apply(secondTurnState(), { type: 'drawStock', seat: 'a' })
  const state = apply(drawn, {
    type: 'discard', seat: 'a', card: cards('3:diamonds')[0], declareGin: false,
  })
  expect(state.discard[state.discard.length - 1]).toEqual(cards('3:diamonds')[0])
})

test('a card you do not hold cannot be discarded', () => {
  const drawn = apply(secondTurnState(), { type: 'drawStock', seat: 'a' })
  expect(
    advance(drawn, { type: 'discard', seat: 'a', card: cards('2:spades')[0], declareGin: false }),
  ).toEqual({ ok: false, reason: 'cardNotInHand' })
})

// A crafted mid-hand state: 'b' holds a fully-meldable 10 (run 2-3-4c,
// set of 5s, four 9s) plus the junk K:spades; 'a' holds 68 points of
// pure deadwood.
function ginReadyState(): EngineState {
  return {
    prng: 123,
    dealer: 'a',
    phase: 'discard',
    hands: {
      a: cards(
        'K:hearts', 'Q:diamonds', 'J:hearts', '10:diamonds', '8:hearts',
        '6:spades', '4:hearts', '2:spades', 'A:diamonds', '7:spades',
      ),
      b: cards(
        '2:clubs', '3:clubs', '4:clubs', '5:diamonds', '5:hearts',
        '5:spades', '9:clubs', '9:diamonds', '9:hearts', '9:spades', 'K:spades',
      ),
    },
    stock: cards('6:hearts', '6:diamonds', '8:clubs'),
    discard: cards('Q:spades'),
    toAct: 'b',
    takenFromDiscard: null,
    result: null,
  }
}

test('a declared gin ends the hand with the loser’s deadwood as margin', () => {
  const state = apply(ginReadyState(), {
    type: 'discard', seat: 'b', card: cards('K:spades')[0], declareGin: true,
  })
  expect(state.phase).toBe('handOver')
  expect(state.result).toEqual({ type: 'gin', winner: 'b', margin: 68 })
  expect(state.hands.b).toHaveLength(10)
  expect(state.discard[state.discard.length - 1]).toEqual(cards('K:spades')[0])
})

test('declaring gin on a discard that does not leave gin is rejected', () => {
  expect(
    advance(ginReadyState(), {
      type: 'discard', seat: 'b', card: cards('9:spades')[0], declareGin: true,
    }),
  ).toEqual({ ok: false, reason: 'notGin' })
})

test('declaring is optional: an undeclared gin hand keeps playing', () => {
  const state = apply(ginReadyState(), {
    type: 'discard', seat: 'b', card: cards('K:spades')[0], declareGin: false,
  })
  expect(state.phase).toBe('draw')
  expect(state.toAct).toBe('a')
  expect(state.result).toBeNull()
})

test('a gin whose arrangement needs a wrap run is accepted by the engine', () => {
  const wrapReady: EngineState = {
    ...ginReadyState(),
    hands: {
      a: ginReadyState().hands.a,
      b: cards(
        'K:clubs', 'A:clubs', '2:clubs', '3:clubs', '5:diamonds', '5:hearts',
        '5:spades', '9:clubs', '9:diamonds', '9:hearts', 'J:spades',
      ),
    },
  }
  const state = apply(wrapReady, {
    type: 'discard', seat: 'b', card: cards('J:spades')[0], declareGin: true,
  })
  expect(state.phase).toBe('handOver')
  expect(state.result).toEqual({ type: 'gin', winner: 'b', margin: 68 })
})

// ginReadyState with the stock down to two cards: the current discard is
// the hand's last act.
function lastTurnState(): EngineState {
  return { ...ginReadyState(), stock: cards('6:hearts', '6:diamonds') }
}

test('a non-gin discard with two stock cards left kills the hand', () => {
  const state = apply(lastTurnState(), {
    type: 'discard', seat: 'b', card: cards('9:spades')[0], declareGin: false,
  })
  expect(state.phase).toBe('handOver')
  expect(state.result).toEqual({ type: 'dead' })
  expect(state.toAct).toBeNull()
})

test('the last discard may still declare gin and win', () => {
  const state = apply(lastTurnState(), {
    type: 'discard', seat: 'b', card: cards('K:spades')[0], declareGin: true,
  })
  expect(state.phase).toBe('handOver')
  expect(state.result).toEqual({ type: 'gin', winner: 'b', margin: 68 })
})

test('with three stock cards left, play continues', () => {
  const state = apply(ginReadyState(), {
    type: 'discard', seat: 'b', card: cards('9:spades')[0], declareGin: false,
  })
  expect(state.phase).toBe('draw')
  expect(state.result).toBeNull()
})

test('a dead hand is redealt by the same dealer, continuing the PRNG stream', () => {
  const dead = apply(lastTurnState(), {
    type: 'discard', seat: 'b', card: cards('9:spades')[0], declareGin: false,
  })
  const redealt = apply(dead, { type: 'startHand' })
  expect(redealt.dealer).toBe('a')
  expect(redealt.phase).toBe('upcardOfferNonDealer')
  expect(redealt.hands.a).toHaveLength(10)
  expect(redealt.hands.b).toHaveLength(10)
  expect(redealt.stock).toHaveLength(31)
  expect(redealt.prng).not.toBe(dead.prng)
})

test('legalActions names what each seat may do in every phase', () => {
  const fresh = initialState(42, 'a')
  expect(legalActions(fresh, 'a')).toEqual(['startHand'])
  expect(legalActions(fresh, 'b')).toEqual(['startHand'])

  const dealt = dealtState()
  expect(legalActions(dealt, 'b')).toEqual(['takeUpcard', 'passUpcard'])
  expect(legalActions(dealt, 'a')).toEqual([])

  const offerDealer = apply(dealt, { type: 'passUpcard', seat: 'b' })
  expect(legalActions(offerDealer, 'a')).toEqual(['takeUpcard', 'passUpcard'])
  expect(legalActions(offerDealer, 'b')).toEqual([])

  const forced = forcedDrawState()
  expect(legalActions(forced, 'b')).toEqual(['drawStock'])
  expect(legalActions(forced, 'a')).toEqual([])

  const drawPhase = secondTurnState()
  expect(legalActions(drawPhase, 'a')).toEqual(['drawStock', 'drawDiscard'])
  expect(legalActions(drawPhase, 'b')).toEqual([])

  const discardPhase = ginReadyState()
  expect(legalActions(discardPhase, 'b')).toEqual(['discard'])
  expect(legalActions(discardPhase, 'a')).toEqual([])

  const over = apply(lastTurnState(), {
    type: 'discard', seat: 'b', card: cards('9:spades')[0], declareGin: false,
  })
  expect(legalActions(over, 'a')).toEqual(['startHand'])
  expect(legalActions(over, 'b')).toEqual(['startHand'])
})

// The determinism invariant: client state is a pure function of
// (seed, ordered action log). The log format here is the future resync
// payload. Two independent instances must agree after every action.
test('two instances replaying one action log stay deep-equal after every action', () => {
  const log: Action[] = [
    { type: 'startHand' },
    { type: 'passUpcard', seat: 'b' },
    { type: 'takeUpcard', seat: 'a' },
    { type: 'discard', seat: 'a', card: cards('J:clubs')[0], declareGin: false },
    { type: 'drawStock', seat: 'b' },
    { type: 'discard', seat: 'b', card: cards('8:diamonds')[0], declareGin: false },
    { type: 'drawDiscard', seat: 'a' },
    { type: 'discard', seat: 'a', card: cards('Q:clubs')[0], declareGin: false },
  ]
  let one = initialState(42, 'a')
  let two = initialState(42, 'a')
  for (const action of log) {
    one = apply(one, action)
    two = apply(two, action)
    expect(two).toEqual(one)
  }
  expect(one.phase).toBe('draw')
  expect(one.toAct).toBe('b')
})

test('scripted full hands are deterministic and always end', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
      let one = initialState(seed, 'a')
      let two = initialState(seed, 'a')
      const step = (action: Action) => {
        one = apply(one, action)
        two = apply(two, action)
        expect(two).toEqual(one)
      }
      step({ type: 'startHand' })
      step({ type: 'passUpcard', seat: 'b' })
      step({ type: 'passUpcard', seat: 'a' })
      let guard = 0
      while (one.phase !== 'handOver') {
        if (++guard > 200) throw new Error('hand did not end')
        const seat = one.toAct
        if (seat === null) throw new Error('no seat to act mid-hand')
        if (one.phase === 'forcedStockDraw' || one.phase === 'draw') {
          step({ type: 'drawStock', seat })
        } else {
          step({ type: 'discard', seat, card: one.hands[seat][0], declareGin: false })
        }
      }
      expect(one.result).toEqual({ type: 'dead' })
    }),
    { numRuns: 25 },
  )
})

test('upcard actions are rejected outside the offer phases', () => {
  const forced = apply(apply(dealtState(), { type: 'passUpcard', seat: 'b' }), {
    type: 'passUpcard',
    seat: 'a',
  })
  expect(advance(forced, { type: 'takeUpcard', seat: 'b' })).toEqual({
    ok: false,
    reason: 'wrongPhase',
  })
  expect(advance(initialState(42, 'a'), { type: 'passUpcard', seat: 'b' })).toEqual({
    ok: false,
    reason: 'wrongPhase',
  })
})
