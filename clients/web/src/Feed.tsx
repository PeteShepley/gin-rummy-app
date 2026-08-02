import type { CSSProperties } from 'react'
import type { FeedEntry } from './store.ts'
import type { TableMetrics } from './layout.ts'

// What just happened, oldest at the top. Deliberately a persistent panel
// rather than fading toasts: knowing which cards your opponent picked up two
// turns ago is most of the skill in gin, and a toast destroys exactly that.
// Sits on the left, in the same clear band as the opponent's nameplate - a
// full eleven-card row reaches far enough left to sit under the top corner.

export function Feed({
  entries,
  metrics,
}: {
  entries: readonly FeedEntry[]
  metrics: TableMetrics | null
}) {
  if (entries.length === 0) return null
  return (
    <div
      style={{
        ...panel,
        top: metrics ? `${metrics.opponentY + metrics.cardH / 2 + 8}px` : '9.5rem',
      }}
    >
      {entries.map((entry, index) => (
        // The newest line is the one being read; older ones recede.
        <div key={entry.id} style={{ ...line, opacity: index === entries.length - 1 ? 1 : 0.55 }}>
          {entry.text}
        </div>
      ))}
    </div>
  )
}

const panel: CSSProperties = {
  position: 'absolute',
  left: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
  maxWidth: 'min(46vw, 15rem)',
  padding: '0.4rem 0.6rem',
  background: 'rgba(0, 0, 0, 0.42)',
  color: '#fff',
  borderRadius: '8px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 'clamp(0.68rem, 2vw, 0.78rem)',
  lineHeight: 1.35,
  pointerEvents: 'none',
}

const line: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
