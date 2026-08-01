import { expect, test } from 'vitest'
import { cardAssetUrl } from './cardAssets.ts'
import { newDeck } from './engine/deck.ts'

test('every card in the deck resolves to its own SVG asset URL', () => {
  const urls = newDeck().map(cardAssetUrl)
  expect(new Set(urls).size).toBe(52)
  for (const url of urls) {
    expect(url).toMatch(/\.svg$/)
  }
})
