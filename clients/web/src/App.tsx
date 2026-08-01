import { useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { TableCanvas } from './TableCanvas.tsx'
import { createGameStore } from './store.ts'
import { createLoopbackTransport } from './loopback.ts'
import { legalActions } from './engine/game.ts'
import { ginDiscards } from './engine/melds.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import type { Action, Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'

// ?seat=a runs the creating tab (sequencer shim), ?seat=b joins it over
// the BroadcastChannel loopback; no param is the single-tab hotseat
// harness. In loopback modes every action goes submit -> stamp -> echo;
// the store only ever applies stamped actions.
const params = new URLSearchParams(window.location.search)
const mode: 'solo' | 'creator' | 'joiner' =
  params.get('seat') === 'b' ? 'joiner' : params.get('seat') === 'a' ? 'creator' : 'solo'

const store = createGameStore()
let submit: (action: Action) => void
if (mode === 'solo') {
  store.start({ seed: Date.now() >>> 0, dealer: 'a', viewerSeat: 'a' })
  submit = (action) => store.apply(action)
} else {
  const transport = createLoopbackTransport({ role: mode, store, seed: Date.now() >>> 0 })
  submit = (action) => transport.submit(action)
}

function App() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const game = snapshot.game
  const seatToPlay: Seat =
    mode === 'solo'
      ? (game?.toAct ?? game?.dealer ?? 'a')
      : (snapshot.viewerSeat ?? 'a')
  const legal = game ? legalActions(game, seatToPlay) : []
  const selected = snapshot.selectedCard

  const ginKeys = new Set(
    game && game.phase === 'discard' && game.toAct === seatToPlay
      ? ginDiscards(game.hands[seatToPlay]).map(cardKey)
      : [],
  )
  const discardBlocked =
    selected && game?.takenFromDiscard ? sameCard(selected, game.takenFromDiscard) : false

  const submitDiscard = (declareGin: boolean) => {
    if (selected) submit({ type: 'discard', seat: seatToPlay, card: selected, declareGin })
  }

  const handlers = {
    onCardClick: (clicked: Card) => {
      const held = game?.hands[seatToPlay].some((own) => sameCard(own, clicked)) ?? false
      if (!held) return
      store.selectCard(selected && sameCard(clicked, selected) ? null : clicked)
    },
    onStockClick: () => {
      if (legal.includes('drawStock')) submit({ type: 'drawStock', seat: seatToPlay })
    },
    onDiscardClick: () => {
      if (legal.includes('takeUpcard')) submit({ type: 'takeUpcard', seat: seatToPlay })
      else if (legal.includes('drawDiscard')) submit({ type: 'drawDiscard', seat: seatToPlay })
      else if (legal.includes('discard') && selected && !discardBlocked) submitDiscard(false)
    },
  }

  const seatLabel = mode === 'solo' ? 'hotseat' : `seat ${seatToPlay} (${mode})`
  const status = !game
    ? mode === 'joiner'
      ? 'waiting for the creating tab (open ?seat=a)'
      : 'no game'
    : game.result
      ? game.result.type === 'gin'
        ? `Gin! Seat ${game.result.winner} wins by ${game.result.margin}.`
        : 'Dead hand - the stock ran out.'
      : game.toAct === seatToPlay || mode === 'solo'
        ? `${game.phase} - seat ${seatToPlay} to act`
        : `waiting - seat ${game.toAct ?? '?'} is thinking`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TableCanvas snapshot={snapshot} perspective={seatToPlay} handlers={handlers} />
      <div style={overlayStyle}>
        <span>{`[${seatLabel}] ${status}`}</span>
        {legal.includes('startHand') && (
          <button type="button" onClick={() => submit({ type: 'startHand' })}>
            Deal
          </button>
        )}
        {game && game.phase !== 'handOver' && (
          <button type="button" onClick={() => store.toggleAutoGroup()}>
            {snapshot.autoGroup ? 'grouping: on' : 'grouping: off'}
          </button>
        )}
        {legal.includes('takeUpcard') && (
          <button type="button" onClick={() => submit({ type: 'takeUpcard', seat: seatToPlay })}>
            Take upcard
          </button>
        )}
        {legal.includes('passUpcard') && (
          <button type="button" onClick={() => submit({ type: 'passUpcard', seat: seatToPlay })}>
            Pass
          </button>
        )}
        {legal.includes('discard') && selected && !discardBlocked && (
          <button type="button" onClick={() => submitDiscard(false)}>
            Discard selected
          </button>
        )}
        {legal.includes('discard') && selected && discardBlocked && (
          <span style={{ opacity: 0.7 }}>the card you just took cannot go straight back</span>
        )}
        {ginKeys.size > 0 && !(selected && ginKeys.has(cardKey(selected))) && (
          <span>gin available - select a gold card</span>
        )}
        {selected && ginKeys.has(cardKey(selected)) && (
          <button type="button" onClick={() => submitDiscard(true)}>
            Declare gin!
          </button>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  padding: '0.4rem 0.8rem',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  borderRadius: '0 0 8px 8px',
  fontSize: '0.9rem',
}

export default App
