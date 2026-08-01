import { useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { TableCanvas } from './TableCanvas.tsx'
import { createGameStore } from './store.ts'
import { legalActions } from './engine/game.ts'
import { ginDiscards } from './engine/melds.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import type { Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'

// Single-tab dev harness: one local store, hotseat perspective (the
// acting seat's hand faces up at the bottom), submits applied straight
// to the store. The loopback transport replaces this submit path next.
const store = createGameStore()
store.start({ seed: Date.now() >>> 0, dealer: 'a', viewerSeat: 'a' })

function App() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const game = snapshot.game
  const acting: Seat = game?.toAct ?? game?.dealer ?? 'a'
  const legal = game ? legalActions(game, acting) : []
  const selected = snapshot.selectedCard

  const ginKeys = new Set(
    game && game.phase === 'discard' ? ginDiscards(game.hands[acting]).map(cardKey) : [],
  )
  const discardBlocked =
    selected && game?.takenFromDiscard ? sameCard(selected, game.takenFromDiscard) : false

  const submitDiscard = (declareGin: boolean) => {
    if (selected) store.apply({ type: 'discard', seat: acting, card: selected, declareGin })
  }

  const handlers = {
    onCardClick: (clicked: Card) => {
      const held = game?.hands[acting].some((own) => sameCard(own, clicked)) ?? false
      if (!held) return
      store.selectCard(selected && sameCard(clicked, selected) ? null : clicked)
    },
    onStockClick: () => {
      if (legal.includes('drawStock')) store.apply({ type: 'drawStock', seat: acting })
    },
    onDiscardClick: () => {
      if (legal.includes('takeUpcard')) store.apply({ type: 'takeUpcard', seat: acting })
      else if (legal.includes('drawDiscard')) store.apply({ type: 'drawDiscard', seat: acting })
      else if (legal.includes('discard') && selected && !discardBlocked) submitDiscard(false)
    },
  }

  const status = game?.result
    ? game.result.type === 'gin'
      ? `Gin! Seat ${game.result.winner} wins by ${game.result.margin}.`
      : 'Dead hand - the stock ran out.'
    : game
      ? `${game.phase} - seat ${acting} to act`
      : 'no game'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TableCanvas snapshot={snapshot} perspective={acting} handlers={handlers} />
      <div style={overlayStyle}>
        <span>{status}</span>
        {legal.includes('startHand') && (
          <button type="button" onClick={() => store.apply({ type: 'startHand' })}>
            Deal
          </button>
        )}
        {legal.includes('takeUpcard') && (
          <button type="button" onClick={() => store.apply({ type: 'takeUpcard', seat: acting })}>
            Take upcard
          </button>
        )}
        {legal.includes('passUpcard') && (
          <button type="button" onClick={() => store.apply({ type: 'passUpcard', seat: acting })}>
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
