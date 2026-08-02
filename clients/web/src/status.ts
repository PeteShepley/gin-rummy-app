import type { Action, EngineState, HandResult, Seat } from './engine/game.ts'
import type { Card, Suit } from './engine/cards.ts'

// Everything the table says in words. Kept out of the components so the
// phrasing can be tested without a DOM, and out of engine/ because the engine
// knows only seats - names arrive with the hand contract.

const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
}

export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

// The one-line status in the HUD. Second person for the seat at the bottom of
// the table, the player's name for the other one - never a raw seat letter or
// phase identifier, both of which used to leak into the UI.
export function statusLine(
  game: EngineState,
  names: Record<Seat, string>,
  viewer: Seat,
): string {
  if (game.result) return resultSentence(game.result, names, viewer)

  const acting = game.toAct
  if (!acting) return 'Ready to deal'
  const yours = acting === viewer
  const who = names[acting]

  switch (game.phase) {
    case 'awaitingStart':
      return 'Ready to deal'
    case 'upcardOfferNonDealer':
    case 'upcardOfferDealer':
      return yours ? 'Your turn — take the upcard or pass' : `Waiting for ${who} to take or pass`
    case 'forcedStockDraw':
      return yours ? 'You must draw from the stock' : `${who} must draw from the stock`
    case 'draw':
      return yours ? 'Your turn — draw a card' : `${who} is drawing`
    case 'discard':
      return yours ? 'Your turn — discard a card' : `${who} is discarding`
    case 'handOver':
      return 'Hand over'
  }
}

function resultSentence(
  result: HandResult,
  names: Record<Seat, string>,
  viewer: Seat,
): string {
  if (result.type === 'dead') return 'Dead hand — the stock ran out'
  return result.winner === viewer
    ? `Gin! You win by ${result.margin}`
    : `${names[result.winner]} wins by ${result.margin}`
}

export interface ResultBanner {
  readonly title: string
  readonly detail: string
  // Whether the viewer won: the shell only celebrates its own wins.
  readonly won: boolean
}

export function resultBanner(
  result: HandResult,
  names: Record<Seat, string>,
  viewer: Seat,
): ResultBanner {
  if (result.type === 'dead') {
    return { title: 'Dead hand', detail: 'The stock ran out — nobody scores', won: false }
  }
  if (result.winner === viewer) {
    return { title: 'Gin! You win', detail: `by ${result.margin}`, won: true }
  }
  return {
    title: `${names[result.winner]} wins`,
    detail: `Gin by ${result.margin} — better luck next hand`,
    won: false,
  }
}

// One line for the action feed, or null for an action not worth reporting.
//
// The card an opponent takes from the stock is NEVER named. The client
// replicates the whole engine state, so that card is sitting in memory - not
// printing it is a rendering discipline, and it is the difference between a
// readable game and a cheat. Only the discard pile is public knowledge.
export function describeAction(
  before: EngineState,
  action: Action,
  names: Record<Seat, string>,
  viewer: Seat | null,
): string | null {
  if (action.type === 'startHand') return null

  const mine = action.seat === viewer
  const who = mine ? 'You' : names[action.seat]
  const upcard = before.discardPile[before.discardPile.length - 1]

  switch (action.type) {
    case 'takeUpcard':
      return upcard ? `${who} took the ${cardLabel(upcard)}` : `${who} took the upcard`
    case 'passUpcard':
      return `${who} passed`
    case 'drawStock':
      // Deliberately the same sentence either way: naming the card only when
      // it is your own draw would tell an opponent's reader when to look.
      return `${who} drew from the stock`
    case 'drawDiscard':
      return upcard
        ? `${who} took the ${cardLabel(upcard)} from the pile`
        : `${who} took from the pile`
    case 'discard':
      return action.declareGin
        ? `${who} went gin, discarding the ${cardLabel(action.card)}`
        : `${who} discarded the ${cardLabel(action.card)}`
  }
}
