import { newDeck, shuffle } from './deck.ts'
import { sameCard } from './cards.ts'
import { minDeadwood } from './melds.ts'
import type { Card } from './cards.ts'

export type Seat = 'a' | 'b'

export type Phase =
  | 'awaitingStart'
  | 'upcardOfferNonDealer'
  | 'upcardOfferDealer'
  | 'forcedStockDraw'
  | 'draw'
  | 'discard'
  | 'handOver'

export type HandResult = { type: 'gin'; winner: Seat; margin: number } | { type: 'dead' }

export interface EngineState {
  readonly prng: number
  readonly dealer: Seat
  readonly phase: Phase
  readonly hands: Readonly<Record<Seat, readonly Card[]>>
  readonly stock: readonly Card[]
  readonly discard: readonly Card[]
  readonly toAct: Seat | null
  readonly takenFromDiscard: Card | null
  readonly result: HandResult | null
}

export type Action =
  | { type: 'startHand' }
  | { type: 'takeUpcard'; seat: Seat }
  | { type: 'passUpcard'; seat: Seat }
  | { type: 'drawStock'; seat: Seat }
  | { type: 'drawDiscard'; seat: Seat }
  | { type: 'discard'; seat: Seat; card: Card; declareGin: boolean }

export type RejectReason =
  | 'wrongPhase'
  | 'wrongSeat'
  | 'cardNotInHand'
  | 'cannotDiscardTakenCard'
  | 'notGin'

export type AdvanceResult = { ok: true; state: EngineState } | { ok: false; reason: RejectReason }

export function otherSeat(seat: Seat): Seat {
  return seat === 'a' ? 'b' : 'a'
}

export function initialState(seed: number, dealer: Seat): EngineState {
  return {
    prng: seed,
    dealer,
    phase: 'awaitingStart',
    hands: { a: [], b: [] },
    stock: [],
    discard: [],
    toAct: null,
    takenFromDiscard: null,
    result: null,
  }
}

export function advance(state: EngineState, action: Action): AdvanceResult {
  switch (action.type) {
    case 'startHand':
      return startHand(state)
    case 'takeUpcard':
      return takeUpcard(state, action.seat)
    case 'passUpcard':
      return passUpcard(state, action.seat)
    case 'drawStock':
      return drawStock(state, action.seat)
    case 'drawDiscard':
      return drawDiscard(state, action.seat)
    case 'discard':
      return discard(state, action.seat, action.card, action.declareGin)
  }
}

// What the given seat may legally do right now. Drives all UI
// affordances; the reducer's own guards remain the authority.
export function legalActions(state: EngineState, seat: Seat): Action['type'][] {
  switch (state.phase) {
    case 'awaitingStart':
    case 'handOver':
      return ['startHand']
    case 'upcardOfferNonDealer':
    case 'upcardOfferDealer':
      return seat === state.toAct ? ['takeUpcard', 'passUpcard'] : []
    case 'forcedStockDraw':
      return seat === state.toAct ? ['drawStock'] : []
    case 'draw':
      return seat === state.toAct ? ['drawStock', 'drawDiscard'] : []
    case 'discard':
      return seat === state.toAct ? ['discard'] : []
  }
}

function actionRejection(
  state: EngineState,
  seat: Seat,
  phases: readonly Phase[],
): RejectReason | null {
  if (!phases.includes(state.phase)) return 'wrongPhase'
  if (seat !== state.toAct) return 'wrongSeat'
  return null
}

// Taking the upcard is that player's draw: they discard next, and the
// no-return rule remembers the card via takenFromDiscard.
function takeUpcard(state: EngineState, seat: Seat): AdvanceResult {
  const rejection = actionRejection(state, seat, ['upcardOfferNonDealer', 'upcardOfferDealer'])
  if (rejection) return { ok: false, reason: rejection }
  const upcard = state.discard[state.discard.length - 1]
  return {
    ok: true,
    state: {
      ...state,
      phase: 'discard',
      hands: { ...state.hands, [seat]: [...state.hands[seat], upcard] },
      discard: state.discard.slice(0, -1),
      toAct: seat,
      takenFromDiscard: upcard,
    },
  }
}

// A pass hands the offer to the dealer; when both have passed, the
// non-dealer must draw from the stock (the refused upcard may not be
// taken - the forcedStockDraw phase only accepts a stock draw).
function passUpcard(state: EngineState, seat: Seat): AdvanceResult {
  const rejection = actionRejection(state, seat, ['upcardOfferNonDealer', 'upcardOfferDealer'])
  if (rejection) return { ok: false, reason: rejection }
  if (state.phase === 'upcardOfferNonDealer') {
    return { ok: true, state: { ...state, phase: 'upcardOfferDealer', toAct: state.dealer } }
  }
  return {
    ok: true,
    state: { ...state, phase: 'forcedStockDraw', toAct: otherSeat(state.dealer) },
  }
}

function drawStock(state: EngineState, seat: Seat): AdvanceResult {
  const rejection = actionRejection(state, seat, ['forcedStockDraw', 'draw'])
  if (rejection) return { ok: false, reason: rejection }
  return {
    ok: true,
    state: {
      ...state,
      phase: 'discard',
      hands: { ...state.hands, [seat]: [...state.hands[seat], state.stock[0]] },
      stock: state.stock.slice(1),
      takenFromDiscard: null,
    },
  }
}

function drawDiscard(state: EngineState, seat: Seat): AdvanceResult {
  const rejection = actionRejection(state, seat, ['draw'])
  if (rejection) return { ok: false, reason: rejection }
  const top = state.discard[state.discard.length - 1]
  return {
    ok: true,
    state: {
      ...state,
      phase: 'discard',
      hands: { ...state.hands, [seat]: [...state.hands[seat], top] },
      discard: state.discard.slice(0, -1),
      takenFromDiscard: top,
    },
  }
}

function discard(state: EngineState, seat: Seat, card: Card, declareGin: boolean): AdvanceResult {
  const rejection = actionRejection(state, seat, ['discard'])
  if (rejection) return { ok: false, reason: rejection }
  const hand = state.hands[seat]
  const held = hand.findIndex((heldCard) => sameCard(heldCard, card))
  if (held === -1) return { ok: false, reason: 'cardNotInHand' }
  if (state.takenFromDiscard && sameCard(card, state.takenFromDiscard)) {
    return { ok: false, reason: 'cannotDiscardTakenCard' }
  }
  const remaining = hand.filter((_, index) => index !== held)
  const afterDiscard = {
    ...state,
    hands: { ...state.hands, [seat]: remaining },
    discard: [...state.discard, hand[held]],
    takenFromDiscard: null,
  }
  if (declareGin) {
    if (minDeadwood(remaining) !== 0) return { ok: false, reason: 'notGin' }
    return {
      ok: true,
      state: {
        ...afterDiscard,
        phase: 'handOver',
        toAct: null,
        result: { type: 'gin', winner: seat, margin: minDeadwood(state.hands[otherSeat(seat)]) },
      },
    }
  }
  // Stock exhaustion: a non-gin discard with two stock cards left ends
  // the hand as a draw, to be redealt by the same dealer.
  if (state.stock.length === 2) {
    return {
      ok: true,
      state: { ...afterDiscard, phase: 'handOver', toAct: null, result: { type: 'dead' } },
    }
  }
  return {
    ok: true,
    state: { ...afterDiscard, phase: 'draw', toAct: otherSeat(seat) },
  }
}

// Deal: one card at a time from the top of the shuffled deck, non-dealer
// first; the 21st card starts the discard pile; the rest is the stock,
// top first. The discard pile's top is its last element.
function startHand(state: EngineState): AdvanceResult {
  if (state.phase !== 'awaitingStart' && state.phase !== 'handOver') {
    return { ok: false, reason: 'wrongPhase' }
  }
  const shuffled = shuffle(newDeck(), state.prng)
  const nonDealer = otherSeat(state.dealer)
  const hands: Record<Seat, Card[]> = { a: [], b: [] }
  for (let i = 0; i < 20; i++) {
    hands[i % 2 === 0 ? nonDealer : state.dealer].push(shuffled.cards[i])
  }
  return {
    ok: true,
    state: {
      ...state,
      prng: shuffled.state,
      phase: 'upcardOfferNonDealer',
      hands,
      stock: shuffled.cards.slice(21),
      discard: [shuffled.cards[20]],
      toAct: nonDealer,
      takenFromDiscard: null,
      result: null,
    },
  }
}
