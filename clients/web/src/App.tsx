import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { TableCanvas } from './TableCanvas.tsx'
import { createGameStore } from './store.ts'
import { createLoopbackTransport } from './loopback.ts'
import type { LoopbackTransport } from './loopback.ts'
import { createRelayTransport, loadSession } from './relayTransport.ts'
import type { LobbyEvent, RelayTransport } from './relayTransport.ts'
import { Lobby } from './Lobby.tsx'
import type { LobbyUiState } from './Lobby.tsx'
import { legalActions, otherSeat } from './engine/game.ts'
import { ginDiscards } from './engine/melds.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import type { Action, EngineState, Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'

// The default (no query param) is networked play: a lobby that creates or
// joins a room over the WebSocket relay. The dev shortcuts survive: ?seat=a
// is the loopback creating tab (sequencer shim), ?seat=b joins it over the
// BroadcastChannel, ?solo is the single-tab hotseat harness. In every
// networked mode the store only ever applies stamped actions.
const params = new URLSearchParams(window.location.search)
const mode: 'solo' | 'creator' | 'joiner' | 'relay' =
  params.get('seat') === 'a'
    ? 'creator'
    : params.get('seat') === 'b'
      ? 'joiner'
      : params.has('solo')
        ? 'solo'
        : 'relay'

const store = createGameStore()
let loopback: LoopbackTransport | null = null
let staticSubmit: ((action: Action) => void) | null = null
if (mode === 'solo') {
  store.start({ seed: Date.now() >>> 0, dealer: 'a', viewerSeat: 'a', names: { a: 'You', b: 'Opponent' } })
  staticSubmit = (action) => store.apply(action)
} else if (mode === 'creator' || mode === 'joiner') {
  loopback = createLoopbackTransport({ role: mode, store, seed: Date.now() >>> 0 })
  staticSubmit = (action) => loopback!.submit(action)
}

// This top-level bootstrap re-runs on any hot update that reaches this
// module; a second live transport would corrupt the room. Dispose the old
// one and reload outright (a socket drop auto-reconnects from sessionStorage).
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
  import.meta.hot.dispose(() => {
    loopback?.destroy()
  })
}

function statusFor(
  game: EngineState | null,
  seatToPlay: Seat,
  follow: 'acting' | 'viewer',
  noGameText: string,
): string {
  if (!game) return noGameText
  if (game.result) {
    return game.result.type === 'gin'
      ? `Gin! Seat ${game.result.winner} wins by ${game.result.margin}.`
      : 'Dead hand - the stock ran out.'
  }
  if (follow === 'acting' || game.toAct === seatToPlay) {
    return `${game.phase} - seat ${seatToPlay} to act`
  }
  return `waiting - seat ${game.toAct ?? '?'} is thinking`
}

// The table + overlay, shared by every mode. `follow` decides whose seat is
// rendered face-up: the hotseat follows the acting seat; networked modes fix
// the view to the viewer's own seat. Seat names come from the hand contract.
interface GameViewProps {
  submit: (action: Action) => void
  follow: 'acting' | 'viewer'
  seatLabel: string
  showSeatNames: boolean
  noGameText: string
}

function GameView({ submit, follow, seatLabel, showSeatNames, noGameText }: GameViewProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const game = snapshot.game
  const soloFallback: Seat =
    game?.result?.type === 'gin' ? game.result.winner : (game?.dealer ?? 'a')
  const seatToPlay: Seat =
    follow === 'acting' ? (game?.toAct ?? soloFallback) : (snapshot.viewerSeat ?? 'a')
  const legal = game ? legalActions(game, seatToPlay) : []
  const selected = snapshot.selectedCard

  const ginKeys: ReadonlySet<string> = new Set(
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
    // An undeclared discard of a gin card is a legitimate plain discard: no
    // explicit declaration, no gin (user ruling, per the rules).
    onDiscardPileClick: () => {
      if (legal.includes('takeUpcard')) submit({ type: 'takeUpcard', seat: seatToPlay })
      else if (legal.includes('drawDiscard')) submit({ type: 'drawDiscard', seat: seatToPlay })
      else if (legal.includes('discard') && selected && !discardBlocked) submitDiscard(false)
    },
  }

  const status = statusFor(game, seatToPlay, follow, noGameText)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <TableCanvas
        snapshot={snapshot}
        perspective={seatToPlay}
        ginKeys={ginKeys}
        handlers={handlers}
      />
      {showSeatNames && game && (
        <>
          <div style={opponentNameStyle}>{snapshot.names[otherSeat(seatToPlay)]}</div>
          <div style={viewerNameStyle}>{snapshot.names[seatToPlay]}</div>
        </>
      )}
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

// Networked play: owns the relay transport and the lobby state machine. The
// transport is created on a Create/Join click (or an auto-reconnect on load),
// never in a render, so React StrictMode's double effects can't open two
// sockets. Once the hand contract arrives the store has a game and the table
// takes over from the lobby.
function RelayApp() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [lobbyState, setLobbyState] = useState<LobbyUiState>({ phase: 'menu' })
  const transportRef = useRef<RelayTransport | null>(null)

  const handleEvent = (event: LobbyEvent) => {
    switch (event.type) {
      case 'created':
        setLobbyState({ phase: 'waiting', code: event.code })
        break
      case 'error':
        transportRef.current?.destroy()
        transportRef.current = null
        setLobbyState({ phase: 'menu', error: event.reason })
        break
      case 'started':
      case 'connection':
        // `started` shows up as a non-null store game (the table renders);
        // connection ticks need no lobby change.
        break
    }
  }

  const ensureTransport = (): RelayTransport => {
    if (!transportRef.current) {
      transportRef.current = createRelayTransport({ store, onEvent: handleEvent })
    }
    return transportRef.current
  }

  useEffect(() => {
    const session = loadSession()
    if (session) {
      ensureTransport().reconnect(session.code, session.token, session.seat)
      setLobbyState({ phase: 'connecting' })
    }
    return () => {
      transportRef.current?.destroy()
      transportRef.current = null
    }
  }, [])

  if (snapshot.game) {
    return (
      <GameView
        submit={(action) => transportRef.current?.submit(action)}
        follow="viewer"
        seatLabel="online"
        showSeatNames
        noGameText="connecting…"
      />
    )
  }

  return (
    <Lobby
      state={lobbyState}
      onCreate={(name) => {
        ensureTransport().create(name)
        setLobbyState({ phase: 'connecting' })
      }}
      onJoin={(code, name) => {
        ensureTransport().join(code, name)
        setLobbyState({ phase: 'connecting' })
      }}
    />
  )
}

function App() {
  if (mode === 'relay') return <RelayApp />
  if (mode === 'solo') {
    return (
      <GameView
        submit={staticSubmit!}
        follow="acting"
        seatLabel="hotseat"
        showSeatNames={false}
        noGameText="no game"
      />
    )
  }
  // Loopback creator/joiner: fixed to one seat over the BroadcastChannel.
  return (
    <GameView
      submit={staticSubmit!}
      follow="viewer"
      seatLabel={`${mode}`}
      showSeatNames
      noGameText={mode === 'joiner' ? 'waiting for the creating tab (open ?seat=a)' : 'no game'}
    />
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

const nameplateStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '0.25rem 0.7rem',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  borderRadius: '999px',
  fontSize: '0.85rem',
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'none',
}

const opponentNameStyle: CSSProperties = { ...nameplateStyle, top: '2.6rem' }
const viewerNameStyle: CSSProperties = { ...nameplateStyle, bottom: '0.6rem' }

export default App
