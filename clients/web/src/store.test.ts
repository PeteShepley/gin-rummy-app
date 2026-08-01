import { expect, test, vi } from 'vitest'
import { createGameStore } from './store.ts'
import { cards } from './engine/testCards.ts'

test('a new store has no game and its snapshot is referentially stable', () => {
  const store = createGameStore()
  expect(store.getSnapshot().game).toBeNull()
  expect(store.getSnapshot()).toBe(store.getSnapshot())
})

test('start creates the engine from the hand contract and notifies subscribers', () => {
  const store = createGameStore()
  const listener = vi.fn()
  store.subscribe(listener)
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  expect(listener).toHaveBeenCalledTimes(1)
  const snapshot = store.getSnapshot()
  expect(snapshot.game?.phase).toBe('awaitingStart')
  expect(snapshot.game?.dealer).toBe('a')
  expect(snapshot.viewerSeat).toBe('b')
})

test('applying a stamped action advances the game in a new snapshot', () => {
  const store = createGameStore()
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  const before = store.getSnapshot()
  const listener = vi.fn()
  store.subscribe(listener)
  store.apply({ type: 'startHand' })
  expect(listener).toHaveBeenCalledTimes(1)
  const after = store.getSnapshot()
  expect(after).not.toBe(before)
  expect(after.game?.phase).toBe('upcardOfferNonDealer')
  expect(after.game?.hands.b).toHaveLength(10)
})

test('a rejected action changes nothing and notifies nobody', () => {
  const store = createGameStore()
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  store.apply({ type: 'startHand' })
  const before = store.getSnapshot()
  const listener = vi.fn()
  store.subscribe(listener)
  store.apply({ type: 'startHand' })
  expect(store.getSnapshot()).toBe(before)
  expect(listener).not.toHaveBeenCalled()
})

test('selecting a card is UI state: new snapshot, subscribers notified', () => {
  const store = createGameStore()
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  store.apply({ type: 'startHand' })
  const listener = vi.fn()
  store.subscribe(listener)
  const card = cards('4:diamonds')[0]
  store.selectCard(card)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(store.getSnapshot().selectedCard).toEqual(card)
  store.selectCard(null)
  expect(store.getSnapshot().selectedCard).toBeNull()
})

test('an accepted action clears the selection; a rejected one leaves it', () => {
  const store = createGameStore()
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  store.apply({ type: 'startHand' })
  store.selectCard(cards('4:diamonds')[0])
  store.apply({ type: 'startHand' })
  expect(store.getSnapshot().selectedCard).toEqual(cards('4:diamonds')[0])
  store.apply({ type: 'passUpcard', seat: 'b' })
  expect(store.getSnapshot().selectedCard).toBeNull()
})

test('a stamped action arriving before the start contract fails loudly', () => {
  const store = createGameStore()
  expect(() => store.apply({ type: 'startHand' })).toThrow('before the start contract')
})

test('auto-group is a persistent preference: toggles, notifies, survives actions', () => {
  const store = createGameStore()
  expect(store.getSnapshot().autoGroup).toBe(false)
  const listener = vi.fn()
  store.subscribe(listener)
  store.toggleAutoGroup()
  expect(listener).toHaveBeenCalledTimes(1)
  expect(store.getSnapshot().autoGroup).toBe(true)
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  store.apply({ type: 'startHand' })
  expect(store.getSnapshot().autoGroup).toBe(true)
  store.toggleAutoGroup()
  expect(store.getSnapshot().autoGroup).toBe(false)
})

test('unsubscribing stops notifications', () => {
  const store = createGameStore()
  const listener = vi.fn()
  const unsubscribe = store.subscribe(listener)
  unsubscribe()
  store.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  expect(listener).not.toHaveBeenCalled()
})
