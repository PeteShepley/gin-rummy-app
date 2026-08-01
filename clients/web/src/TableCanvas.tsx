import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'

// Owns the one Pixi Application. StrictMode runs mount effects twice and
// Pixi v8's init() is async, so cleanup waits for its own init to settle
// before destroying, and the canvas only attaches if this mount is still
// live when init resolves. resizeTo makes Pixi the single resize owner.
export function TableCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const app = new Application()
    let live = true
    const ready = app.init({ resizeTo: host, background: '#1d5c2e', antialias: true }).then(() => {
      if (live) host.appendChild(app.canvas)
    })
    return () => {
      live = false
      void ready.then(() => app.destroy(true))
    }
  }, [])

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
