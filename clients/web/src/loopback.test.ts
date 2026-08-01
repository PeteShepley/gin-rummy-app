import { expect, test } from 'vitest'
import { createLoopbackTransport } from './loopback.ts'
import { createGameStore } from './store.ts'
import type { Action } from './engine/game.ts'

// Channel hops chain (request -> reply -> apply), so drain several
// scheduler rounds rather than betting on one.
const flush = async () => {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let channelCount = 0
const freshChannel = () => `gin-loopback-test-${++channelCount}`

test('the joiner bootstraps from the creator and both stores stay identical', async () => {
  const channelName = freshChannel()
  const creatorStore = createGameStore()
  const creator = createLoopbackTransport({
    role: 'creator',
    store: creatorStore,
    seed: 42,
    channelName,
  })
  const joinerStore = createGameStore()
  const joiner = createLoopbackTransport({ role: 'joiner', store: joinerStore, channelName })
  await flush()

  expect(creatorStore.getSnapshot().viewerSeat).toBe('a')
  expect(joinerStore.getSnapshot().viewerSeat).toBe('b')
  expect(joinerStore.getSnapshot().game?.dealer).toBe('a')

  creator.submit({ type: 'startHand' })
  await flush()
  expect(creatorStore.getSnapshot().game?.phase).toBe('upcardOfferNonDealer')
  expect(joinerStore.getSnapshot().game).toEqual(creatorStore.getSnapshot().game)

  joiner.submit({ type: 'passUpcard', seat: 'b' })
  await flush()
  expect(creatorStore.getSnapshot().game?.phase).toBe('upcardOfferDealer')
  expect(joinerStore.getSnapshot().game).toEqual(creatorStore.getSnapshot().game)

  creator.destroy()
  joiner.destroy()
})

test('a joiner arriving mid-game rebuilds from a full resync', async () => {
  const channelName = freshChannel()
  const creatorStore = createGameStore()
  const creator = createLoopbackTransport({
    role: 'creator',
    store: creatorStore,
    seed: 42,
    channelName,
  })
  creator.submit({ type: 'startHand' })
  await flush()

  const joinerStore = createGameStore()
  const joiner = createLoopbackTransport({ role: 'joiner', store: joinerStore, channelName })
  await flush()
  expect(joinerStore.getSnapshot().game).toEqual(creatorStore.getSnapshot().game)

  creator.destroy()
  joiner.destroy()
})

test('a joiner that opened first still bootstraps when the creator arrives', async () => {
  const channelName = freshChannel()
  const joinerStore = createGameStore()
  const joiner = createLoopbackTransport({ role: 'joiner', store: joinerStore, channelName })
  await flush()
  expect(joinerStore.getSnapshot().game).toBeNull()

  const creatorStore = createGameStore()
  const creator = createLoopbackTransport({
    role: 'creator',
    store: creatorStore,
    seed: 42,
    channelName,
  })
  await flush()
  expect(joinerStore.getSnapshot().viewerSeat).toBe('b')
  expect(joinerStore.getSnapshot().game).toEqual(creatorStore.getSnapshot().game)

  creator.destroy()
  joiner.destroy()
})

// A raw channel plays sequencer against a lone joiner, so the gap
// behaviour is observable as MESSAGES, not just as state equality: the
// gap must produce a resyncRequest on the wire, and the resync reply
// must rebuild the client exactly.
test('a gap makes the client request resync by message, then rebuild from the log', async () => {
  const channelName = freshChannel()
  const sequencer = new BroadcastChannel(channelName)
  let resyncRequests = 0
  sequencer.addEventListener('message', (event) => {
    if ((event as MessageEvent).data?.kind === 'resyncRequest') resyncRequests += 1
  })

  const joinerStore = createGameStore()
  const joiner = createLoopbackTransport({ role: 'joiner', store: joinerStore, channelName })
  await flush()
  expect(resyncRequests).toBe(1)

  const contract = {
    seed: 42,
    dealer: 'a',
    seats: { creator: 'a', joiner: 'b' },
  } as const
  sequencer.postMessage({ kind: 'start', ...contract })
  await flush()
  expect(joinerStore.getSnapshot().game?.phase).toBe('awaitingStart')

  const log: { seq: number; action: Action }[] = [
    { seq: 1, action: { type: 'startHand' } },
    { seq: 2, action: { type: 'passUpcard', seat: 'b' } },
    { seq: 3, action: { type: 'passUpcard', seat: 'a' } },
  ]
  sequencer.postMessage({ kind: 'action', ...log[0] })
  await flush()
  sequencer.postMessage({ kind: 'action', ...log[2] })
  await flush()
  expect(resyncRequests).toBe(2)

  sequencer.postMessage({ kind: 'resync', ...contract, log })
  await flush()

  const reference = createGameStore()
  reference.start({ seed: 42, dealer: 'a', viewerSeat: 'b' })
  for (const stamped of log) reference.apply(stamped.action)
  expect(joinerStore.getSnapshot().game).toEqual(reference.getSnapshot().game)

  sequencer.postMessage({ kind: 'action', ...log[0] })
  await flush()
  expect(joinerStore.getSnapshot().game).toEqual(reference.getSnapshot().game)

  sequencer.close()
  joiner.destroy()
})
