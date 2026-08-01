import type { Card, Rank, Suit } from './cards.ts'

export function cards(...specs: string[]): Card[] {
  return specs.map((spec) => {
    const [rank, suit] = spec.split(':')
    return { rank: rank as Rank, suit: suit as Suit }
  })
}

export function sortedKeys(found: readonly Card[]): string[] {
  return found.map((card) => `${card.rank}:${card.suit}`).sort()
}
