import type { Action, Seat } from './engine/game.ts'
import type { GameStore } from './store.ts'

// The locked message schema from DESIGN.md, spoken verbatim: the phase-3
// relay replaces the sequencer shim and the channel without changing any
// message shape. The creating tab is the sequencer; clients apply only
// stamped actions, in order, including the echoes of their own.

interface Contract {
  readonly seed: number
  readonly dealer: Seat
  readonly seats: { readonly creator: Seat; readonly joiner: Seat }
}

interface Stamped {
  readonly seq: number
  readonly action: Action
}

type WireMessage =
  | ({ kind: 'start' } & Contract)
  | { kind: 'submit'; action: Action }
  | ({ kind: 'action' } & Stamped)
  | { kind: 'resyncRequest' }
  | ({ kind: 'resync' } & Contract & { readonly log: readonly Stamped[] })

export interface LoopbackTransport {
  submit(action: Action): void
  destroy(): void
}

export function createLoopbackTransport(options: {
  role: 'creator' | 'joiner'
  store: GameStore
  seed?: number
  channelName?: string
}): LoopbackTransport {
  const { role, store } = options
  const channel = new BroadcastChannel(options.channelName ?? 'gin-rummy-dev')
  const seats = { creator: 'a', joiner: 'b' } as const
  const mySeat = seats[role]

  let expectedSeq = 1
  let contractApplied = false

  const applyContract = (contract: Contract) => {
    store.start({ seed: contract.seed, dealer: contract.dealer, viewerSeat: mySeat })
    expectedSeq = 1
    contractApplied = true
  }

  const inbox = (stamped: Stamped) => {
    // A stamp outrunning the bootstrap is a gap by another name: ask for
    // the full picture rather than applying into a store with no game.
    if (!contractApplied) {
      channel.postMessage({ kind: 'resyncRequest' } satisfies WireMessage)
      return
    }
    if (stamped.seq < expectedSeq) return
    if (stamped.seq > expectedSeq) {
      channel.postMessage({ kind: 'resyncRequest' } satisfies WireMessage)
      return
    }
    store.apply(stamped.action)
    expectedSeq = stamped.seq + 1
  }

  let sequencer: { contract: Contract; log: Stamped[]; nextSeq: number } | null = null

  const stamp = (action: Action) => {
    const shim = sequencer
    if (!shim) return // narrowing only - callers guard visibly
    const stamped: Stamped = { seq: shim.nextSeq, action }
    shim.nextSeq += 1
    shim.log.push(stamped)
    channel.postMessage({ kind: 'action', ...stamped } satisfies WireMessage)
    // BroadcastChannel never echoes to the posting tab, so the shim hands
    // its own client the stamp directly - the same echo discipline.
    inbox(stamped)
  }

  if (role === 'creator') {
    const contract: Contract = { seed: options.seed ?? 1, dealer: seats.creator, seats }
    sequencer = { contract, log: [], nextSeq: 1 }
    applyContract(contract)
    // A joiner may already be waiting (it opened first): announce the
    // contract so it bootstraps without having to ask again.
    channel.postMessage({ kind: 'start', ...contract } satisfies WireMessage)
  }

  const onMessage = (event: MessageEvent) => {
    const message = event.data as WireMessage
    switch (message.kind) {
      case 'submit':
        // Only the sequencer stamps; a joiner ignores peer submits. (A
        // submit with no sequencer alive anywhere - the creating tab
        // closed - goes unanswered and the submitter sees no change.)
        if (sequencer) stamp(message.action)
        break
      case 'action':
        inbox({ seq: message.seq, action: message.action })
        break
      case 'start':
        if (role === 'joiner') applyContract(message)
        break
      case 'resync':
        if (role === 'joiner') {
          applyContract(message)
          for (const stamped of message.log) inbox(stamped)
        }
        break
      case 'resyncRequest':
        if (sequencer) {
          // The schema's words: `start` marks a second seat joining a
          // fresh room; `resync` is the mid-game bootstrap.
          const reply: WireMessage =
            sequencer.log.length === 0
              ? { kind: 'start', ...sequencer.contract }
              : { kind: 'resync', ...sequencer.contract, log: sequencer.log }
          channel.postMessage(reply)
        }
        break
    }
  }
  channel.addEventListener('message', onMessage)

  if (role === 'joiner') {
    channel.postMessage({ kind: 'resyncRequest' } satisfies WireMessage)
  }

  return {
    submit(action) {
      if (sequencer) stamp(action)
      else channel.postMessage({ kind: 'submit', action } satisfies WireMessage)
    },
    destroy() {
      channel.removeEventListener('message', onMessage)
      channel.close()
    },
  }
}
