import type { CSSProperties, ReactNode } from 'react'
import { minDeadwood } from './engine/melds.ts'
import { resultBanner, statusLine } from './status.ts'
import type { EngineState, HandResult, Seat } from './engine/game.ts'
import type { TableMetrics } from './layout.ts'

// The band between the piles and your hand: what is going on, how bad your
// hand is, and every button that is legal right now. It sits below the centre
// so the controls are near the cards your eyes are already on, and clear of
// the opponent's row at the top - which the old top-edge bar overlapped.

// A player's name, and whether the table is waiting on them. The pulse is a
// CSS class because @keyframes cannot live in an inline style object.
export function Nameplate({
  name,
  active,
  inline,
  style,
}: {
  name: string
  active: boolean
  inline?: boolean
  style?: CSSProperties
}) {
  const classes = ['nameplate']
  if (inline) classes.push('nameplate--inline')
  if (active) classes.push('nameplate--active')
  return (
    <span className={classes.join(' ')} style={style}>
      <span className="nameplate__dot" />
      {name}
    </span>
  )
}

interface HudProps {
  game: EngineState | null
  names: Record<Seat, string>
  perspective: Seat
  metrics: TableMetrics | null
  noGameText: string
  children: ReactNode
}

export function Hud({ game, names, perspective, metrics, noGameText, children }: HudProps) {
  const status = game ? statusLine(game, names, perspective) : noGameText
  // At the lay-down the deadwood is on the table already, greyed out; a
  // number would just repeat it.
  const deadwood =
    game && game.phase !== 'handOver' && game.phase !== 'awaitingStart'
      ? minDeadwood(game.hands[perspective])
      : null

  return (
    <div style={{ ...panel, top: metrics ? `${metrics.hudTop}px` : '60%' }}>
      <div style={statusRow}>
        {game && (
          <Nameplate name={names[perspective]} active={game.toAct === perspective} inline />
        )}
        <span>{status}</span>
        {deadwood !== null && (
          <span style={deadwoodChip} title="the points you would be left holding">
            Deadwood {deadwood}
          </span>
        )}
      </div>
      <div style={buttonRow}>{children}</div>
    </div>
  )
}

// The end of a hand, named. The lay-down puts both hands on the top and
// bottom rows and draws no piles, so the middle of the table is free and the
// banner takes it - clear of the nameplates and of the proof itself. The
// fireworks are the scene's job; this is the part that says who did it.
export function WinBanner({
  result,
  names,
  perspective,
  metrics,
}: {
  result: HandResult
  names: Record<Seat, string>
  perspective: Seat
  metrics: TableMetrics | null
}) {
  const banner = resultBanner(result, names, perspective)
  return (
    <div
      style={{
        ...bannerBox,
        top: metrics ? `${metrics.stock.y}px` : '50%',
        borderColor: banner.won ? '#ffd54a' : 'rgba(255, 255, 255, 0.25)',
      }}
    >
      <div style={{ ...bannerTitle, color: banner.won ? '#ffd54a' : '#fff' }}>{banner.title}</div>
      <div style={bannerDetail}>{banner.detail}</div>
    </div>
  )
}

const panel: CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.5rem',
  maxWidth: 'min(92vw, 40rem)',
  padding: '0.6rem 1rem',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  borderRadius: '10px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 'clamp(0.8rem, 2.4vw, 0.95rem)',
  textAlign: 'center',
}

const statusRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '0.6rem',
}

const deadwoodChip: CSSProperties = {
  padding: '0.1rem 0.5rem',
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.14)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

// Wraps rather than overflowing, so a narrow screen stacks the controls.
const buttonRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '0.5rem',
}

const bannerBox: CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '0.7rem 1.6rem',
  background: 'rgba(0, 0, 0, 0.7)',
  border: '2px solid',
  borderRadius: '12px',
  fontFamily: 'system-ui, sans-serif',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
}

const bannerTitle: CSSProperties = {
  fontSize: 'clamp(1.2rem, 5vw, 2rem)',
  fontWeight: 700,
  letterSpacing: '0.02em',
}

const bannerDetail: CSSProperties = {
  marginTop: '0.15rem',
  color: 'rgba(255, 255, 255, 0.75)',
  fontSize: 'clamp(0.75rem, 2.4vw, 0.95rem)',
}
