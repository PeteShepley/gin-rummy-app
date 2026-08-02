import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application, FederatedPointerEvent, Texture, Ticker } from 'pixi.js'
import { cardAssetUrl } from './cardAssets.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import { newDeck } from './engine/deck.ts'
import { bestArrangement } from './engine/melds.ts'
import { otherSeat } from './engine/game.ts'
import { moveKey, orderHand } from './handOrder.ts'
import { createFireworks } from './fireworks.ts'
import { tableMetrics } from './layout.ts'
import type { Fireworks } from './fireworks.ts'
import type { TableMetrics } from './layout.ts'
import type { Arrangement } from './engine/melds.ts'
import type { Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'
import type { GameSnapshot } from './store.ts'

const DEADWOOD_TINT = 0xbdbdbd
const GIN_TINT = 0xffd54a
const NO_TINT = 0xffffff

// Motion tuning. A sprite eases toward its target by exponential
// smoothing rather than a fixed-duration tween, so a target that moves
// mid-flight - select a card while it is still settling, resize under a
// sliding deal, discard a card that is not yet at rest - is chased, not
// fought. MOVE_TAU is the time constant in ms; smaller is snappier.
const MOVE_TAU = 80
const FADE_MS = 160 // a departing sprite fades over this long, then dies
const SNAP_PX = 0.5 // once within this of its target a sprite sits exactly on it
const LIFT_PX = 3 // a sprite farther than this from its target counts as in flight

// Drag tuning. Below DRAG_SLOP the gesture is still a tap, so a slightly
// shaky click selects a card rather than silently reordering the hand.
const DRAG_SLOP = 5
const DRAG_LIFT = 1.08 // the held card grows this much, to read as picked up

// Draw order. Cards in flight lift above the whole table so a slide
// never disappears behind a pile or a neighbour; the halo sits just
// under the card it frames.
const Z_OPPONENT = 0
const Z_PILE = 10
const Z_COUNT = 12
const Z_HALO = 18
const Z_HAND = 20
const Z_FLIGHT = 1000
const Z_DRAG = 2000
const Z_FIREWORKS = 3000

// The canvas mount captures this module in a closure; a hot update would
// leave that stale closure rendering old code. invalidate() only bubbles
// to the React boundary (verified against the dev-server log), so reload
// outright.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}

export interface SceneHandlers {
  onCardClick(card: Card): void
  onStockClick(): void
  onDiscardPileClick(): void
  // A finished drag: the viewer's hand, in the order they arranged it.
  onHandReorder(keys: readonly string[]): void
  // Where the table put things, so the DOM overlay can line up with it
  // without duplicating the geometry. Fires only when the size changes.
  onMetrics(metrics: TableMetrics): void
}

export interface TableScene {
  update(snapshot: GameSnapshot, perspective: Seat, ginKeys: ReadonlySet<string>): void
  destroy(): void
}

// One card the scene wants on screen: a stable identity, where it belongs
// now, and how it behaves there. Face-known cards are keyed by the card
// itself, so a card that moves zones - hand to discard on a throw, discard
// to hand on a pickup - keeps the same sprite and slides between the two.
// Face-down piles are keyed by role, since the viewer must not learn them.
interface CardTarget {
  key: string
  texture: Texture
  x: number
  y: number
  w: number
  h: number
  tint: number
  baseZ: number
  // Where a freshly created sprite starts before its first slide. New
  // hand and pile cards fly in from the deck; reveal cards just appear.
  spawn: { x: number; y: number } | null
  onTap: (() => void) | null
  // Set on the viewer's own hand cards: these accept a drag as well as a tap.
  held: Card | null
}

interface Managed {
  sprite: Sprite
  tx: number
  ty: number
  baseZ: number
  leaving: boolean
}

interface BuildResult {
  cards: CardTarget[]
  count: { text: string; x: number; y: number } | null
  slot: { x: number; y: number } | null
  haloKey: string | null
}

// A drag in progress. The order lives here rather than in the store because
// mid-drag a card's position belongs to the pointer, not to shared state; only
// the finished arrangement is committed.
interface Drag {
  key: string
  card: Card
  grabX: number
  grabY: number
  startX: number
  startY: number
  moved: boolean
  order: readonly string[]
}

// The scene owns sprites and their motion; the store owns truth; the
// shell derives the gin offer and passes it in. update() derives
// everything game-shaped once per snapshot; a ticker eases each sprite
// toward its target every frame, so the store stays free of animation
// state (per the design's determinism ban) and resizes never re-run the
// meld search.
export async function createTableScene(
  app: Application,
  handlers: SceneHandlers,
): Promise<TableScene> {
  const faces = new Map<string, Texture>()
  await Promise.all(
    newDeck().map(async (deckCard) => {
      faces.set(cardKey(deckCard), await Assets.load<Texture>(cardAssetUrl(deckCard)))
    }),
  )
  const back = backTexture(app)
  const root = new Container()
  root.sortableChildren = true
  app.stage.addChild(root)

  // Card sizes and anchor points scale with the viewport, so they are
  // recomputed on resize and shared with the DOM overlay.
  let metrics = tableMetrics(app.screen.width, app.screen.height)
  let metricsKey = ''

  // Decorations live outside the tweened card pool: they never move
  // between zones, so they are created once and repositioned in place.
  const halo = new Graphics()
  halo.zIndex = Z_HALO
  halo.visible = false
  root.addChild(halo)

  const stockCount = new Text({ text: '', style: { fill: '#ffffff', fontSize: 16 } })
  stockCount.anchor.set(0.5)
  stockCount.zIndex = Z_COUNT
  stockCount.visible = false
  root.addChild(stockCount)

  const emptySlot = new Graphics()
  emptySlot.zIndex = Z_PILE
  emptySlot.visible = false
  emptySlot.eventMode = 'static'
  emptySlot.cursor = 'pointer'
  emptySlot.on('pointertap', () => handlers.onDiscardPileClick())
  root.addChild(emptySlot)

  const fireworks: Fireworks = createFireworks(app, root, Z_FIREWORKS)
  // Someone who has asked the OS for less motion gets the banner without the
  // particle storm.
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let celebrated = false

  interface Derived {
    snapshot: GameSnapshot
    perspective: Seat
    ginKeys: ReadonlySet<string>
    reveal: { top: Arrangement; bottom: Arrangement } | null
    handGroups: readonly (readonly Card[])[]
  }
  let last: Derived | null = null

  // Persistent sprites, keyed by CardTarget.key. Reconcile grows and
  // prunes this; the ticker walks it and moves everything.
  const managed = new Map<string, Managed>()
  let haloKey: string | null = null
  let drag: Drag | null = null

  const face = (of: Card): Texture => {
    const texture = faces.get(cardKey(of))
    if (!texture) throw new Error(`no texture loaded for ${cardKey(of)}`)
    return texture
  }

  // While a drag is live the hand is whatever the pointer has made of it: a
  // single ungrouped row in the preview order. Auto-grouping has already lost
  // ownership of the layout at this point (the store turns it off on commit).
  const currentHandGroups = (): readonly (readonly Card[])[] => {
    const { snapshot, perspective, handGroups } = last!
    if (!drag?.moved || !snapshot.game) return handGroups
    return [orderHand(snapshot.game.hands[perspective], drag.order)]
  }

  // Geometry only - no meld search, no sprite churn - so it is cheap
  // enough to re-run on every resize frame.
  const buildTargets = (): BuildResult => {
    const { snapshot, perspective, ginKeys, reveal } = last!
    const game = snapshot.game
    const { width } = app.screen
    const { cardW, cardH } = metrics
    const cards: CardTarget[] = []
    if (!game) return { cards, count: null, slot: null, haloKey: null }

    const stockCenter = metrics.stock

    // The lay-down: a finished hand is proof, so both hands show face up,
    // clustered by their best arrangement, deadwood greyed. Reveal cards
    // appear in place; the viewer's own cards keep their keys and slide
    // from their in-hand spots into the grouped arrangement.
    if (reveal) {
      const show = (arrangement: Arrangement, y: number) => {
        const deadwoodKeys = new Set(arrangement.deadwood.map(cardKey))
        for (const placed of groupedXs(
          [...arrangement.melds, arrangement.deadwood],
          width,
          metrics,
        )) {
          cards.push({
            key: cardKey(placed.held),
            texture: face(placed.held),
            x: placed.x,
            y,
            w: cardW,
            h: cardH,
            tint: deadwoodKeys.has(cardKey(placed.held)) ? DEADWOOD_TINT : NO_TINT,
            baseZ: Z_HAND,
            spawn: null,
            onTap: null,
            held: null,
          })
        }
      }
      show(reveal.top, metrics.opponentY)
      show(reveal.bottom, metrics.handY)
      return { cards, count: null, slot: null, haloKey: null }
    }

    // The opponent's hand is a row of face-down backs, keyed by position:
    // the viewer never learns which cards they are.
    groupedXs([game.hands[otherSeat(perspective)]], width, metrics).forEach((placed, index) => {
      cards.push({
        key: `opp:${index}`,
        texture: back,
        x: placed.x,
        y: metrics.opponentY,
        w: cardW,
        h: cardH,
        tint: NO_TINT,
        baseZ: Z_OPPONENT,
        spawn: stockCenter,
        onTap: null,
        held: null,
      })
    })

    let count: BuildResult['count'] = null
    if (game.stock.length > 0) {
      cards.push({
        key: 'stock',
        texture: back,
        x: stockCenter.x,
        y: stockCenter.y,
        w: cardW,
        h: cardH,
        tint: NO_TINT,
        baseZ: Z_PILE,
        spawn: null,
        onTap: handlers.onStockClick,
        held: null,
      })
      count = {
        text: `${game.stock.length}`,
        x: stockCenter.x,
        y: stockCenter.y + cardH / 2 + 14 * metrics.scale,
      }
    }

    let slot: BuildResult['slot'] = null
    const top = game.discardPile[game.discardPile.length - 1]
    if (top) {
      // Keyed by the card, so the sprite thrown from a hand becomes this
      // one and the slide is free; a card drawn back off the pile is this
      // same sprite leaving for the hand.
      cards.push({
        key: cardKey(top),
        texture: face(top),
        x: metrics.discard.x,
        y: metrics.discard.y,
        w: cardW,
        h: cardH,
        tint: NO_TINT,
        baseZ: Z_PILE,
        spawn: stockCenter,
        onTap: handlers.onDiscardPileClick,
        held: null,
      })
    } else {
      slot = { x: metrics.discard.x, y: metrics.discard.y }
    }

    let nextHaloKey: string | null = null
    for (const placed of groupedXs(currentHandGroups(), width, metrics)) {
      const held = placed.held
      const key = cardKey(held)
      const lifted = drag?.moved && drag.key === key
      const raised = snapshot.selectedCard && sameCard(held, snapshot.selectedCard) ? metrics.raise : 0
      cards.push({
        key,
        texture: face(held),
        x: placed.x,
        y: metrics.handY - raised,
        w: lifted ? cardW * DRAG_LIFT : cardW,
        h: lifted ? cardH * DRAG_LIFT : cardH,
        tint: ginKeys.has(key) ? GIN_TINT : NO_TINT,
        baseZ: lifted ? Z_DRAG : Z_HAND,
        spawn: stockCenter,
        onTap: null, // hand cards resolve tap-vs-drag on pointer release
        held,
      })
      if (
        snapshot.lastDrawn &&
        snapshot.lastDrawn.seat === perspective &&
        sameCard(held, snapshot.lastDrawn.card)
      ) {
        nextHaloKey = key
      }
    }

    return { cards, count, slot, haloKey: nextHaloKey }
  }

  const spawn = (target: CardTarget): Managed => {
    const sprite = new Sprite(target.texture)
    sprite.anchor.set(0.5)
    const from = target.spawn ?? { x: target.x, y: target.y }
    sprite.position.set(from.x, from.y)
    sprite.zIndex = target.baseZ
    root.addChild(sprite)
    return { sprite, tx: target.x, ty: target.y, baseZ: target.baseZ, leaving: false }
  }

  // Diff the target list against the live sprite pool: adopt or spawn a
  // sprite per target, retarget it, rebind its tap, and mark anything no
  // longer wanted as leaving. The ticker does the actual moving.
  const reconcile = () => {
    if (!last) return
    const { cards, count, slot, haloKey: nextHaloKey } = buildTargets()
    const seen = new Set<string>()
    for (const target of cards) {
      seen.add(target.key)
      let entry = managed.get(target.key)
      if (!entry) {
        entry = spawn(target)
        managed.set(target.key, entry)
      } else if (entry.leaving) {
        // A key can return before its fade finishes (an opponent's count
        // oscillating across a turn); revive the sprite in place.
        entry.leaving = false
        entry.sprite.alpha = 1
      }
      const sprite = entry.sprite
      if (sprite.texture !== target.texture) sprite.texture = target.texture
      sprite.tint = target.tint
      sprite.width = target.w
      sprite.height = target.h
      entry.tx = target.x
      entry.ty = target.y
      entry.baseZ = target.baseZ
      sprite.removeAllListeners('pointertap')
      sprite.removeAllListeners('pointerdown')
      if (target.onTap) {
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointertap', target.onTap)
      } else if (target.held) {
        // A hand card is both a tap target and a drag handle; which one it
        // was is only known on release.
        const held = target.held
        sprite.eventMode = 'static'
        sprite.cursor = 'grab'
        sprite.on('pointerdown', (event: FederatedPointerEvent) => beginDrag(held, sprite, event))
      } else {
        sprite.eventMode = 'none'
        sprite.cursor = 'default'
      }
    }
    for (const [key, entry] of managed) {
      if (seen.has(key) || entry.leaving) continue
      entry.leaving = true
      entry.sprite.removeAllListeners('pointertap')
      entry.sprite.removeAllListeners('pointerdown')
      entry.sprite.eventMode = 'none'
    }

    if (count) {
      stockCount.text = count.text
      stockCount.style.fontSize = 16 * metrics.scale
      stockCount.position.set(count.x, count.y)
      stockCount.visible = true
    } else {
      stockCount.visible = false
    }

    if (slot) {
      emptySlot
        .clear()
        .roundRect(
          slot.x - metrics.cardW / 2,
          slot.y - metrics.cardH / 2,
          metrics.cardW,
          metrics.cardH,
          8 * metrics.scale,
        )
        .fill({ color: 0xffffff, alpha: 0.08 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
      emptySlot.visible = true
    } else {
      emptySlot.visible = false
    }

    // Redrawn rather than repositioned, because its size follows the cards.
    const haloW = metrics.cardW + 10 * metrics.scale
    const haloH = metrics.cardH + 10 * metrics.scale
    halo
      .clear()
      .roundRect(-haloW / 2, -haloH / 2, haloW, haloH, 10 * metrics.scale)
      .stroke({ width: 3, color: 0x7fd1ff })

    haloKey = nextHaloKey
  }

  // --- dragging a card into place ------------------------------------------

  // The pointer may leave the canvas - or the window - before it is released,
  // and Pixi only sees events over its own canvas, so the end of a drag is
  // listened for on the window.
  const endDrag = () => {
    if (!drag) return
    const finished = drag
    drag = null
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    if (finished.moved) handlers.onHandReorder(finished.order)
    else handlers.onCardClick(finished.card)
    reconcile()
  }

  const cancelDrag = () => {
    if (!drag) return
    drag = null
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }

  const beginDrag = (held: Card, sprite: Sprite, event: FederatedPointerEvent) => {
    if (!last?.snapshot.game) return
    // Seed from what is on screen, not from the engine order, so turning
    // auto-grouping off on commit closes the meld gaps without the cards
    // jumping to new places first.
    const shown = currentHandGroups().flat().map(cardKey)
    drag = {
      key: cardKey(held),
      card: held,
      grabX: event.global.x - sprite.x,
      grabY: event.global.y - sprite.y,
      startX: event.global.x,
      startY: event.global.y,
      moved: false,
      order: shown,
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  const onDragMove = (event: FederatedPointerEvent) => {
    if (!drag || !last?.snapshot.game) return
    const px = event.global.x
    const py = event.global.y
    if (!drag.moved) {
      const dx = px - drag.startX
      const dy = py - drag.startY
      if (dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP) return
      drag.moved = true
    }
    const entry = managed.get(drag.key)
    if (!entry) return
    // Mid-drag the card belongs to the pointer; the ticker leaves it alone.
    entry.sprite.position.set(px - drag.grabX, py - drag.grabY)
    entry.sprite.zIndex = Z_DRAG

    // Drop the card into whichever slot the pointer is nearest, so the
    // neighbours close up and slide aside through the usual tween.
    const hand = orderHand(last.snapshot.game.hands[last.perspective], drag.order)
    const keys = hand.map(cardKey)
    const from = keys.indexOf(drag.key)
    if (from < 0) return
    const xs = groupedXs([hand], app.screen.width, metrics)
    let nearest = 0
    let best = Infinity
    xs.forEach((placed, index) => {
      const distance = Math.abs(placed.x - px)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    drag.order = nearest === from ? keys : moveKey(keys, from, nearest)
    reconcile()
  }

  app.stage.eventMode = 'static'
  // globalpointermove fires wherever the pointer is, not just over a sprite,
  // which is what a drag needs once the card has slipped out from under it.
  app.stage.on('globalpointermove', onDragMove)

  const tick = (ticker: Ticker) => {
    const dt = ticker.deltaMS
    const k = 1 - Math.exp(-dt / MOVE_TAU)
    for (const [key, entry] of managed) {
      const sprite = entry.sprite
      if (entry.leaving) {
        sprite.alpha -= dt / FADE_MS
        if (sprite.alpha <= 0) {
          sprite.destroy()
          managed.delete(key)
        }
        continue
      }
      // The held card is the pointer's, not the tween's.
      if (drag?.moved && key === drag.key) continue
      const dx = entry.tx - sprite.x
      const dy = entry.ty - sprite.y
      if (dx * dx + dy * dy < SNAP_PX * SNAP_PX) {
        sprite.position.set(entry.tx, entry.ty)
        sprite.zIndex = entry.baseZ
      } else {
        sprite.x += dx * k
        sprite.y += dy * k
        sprite.zIndex = entry.baseZ + (dx * dx + dy * dy > LIFT_PX * LIFT_PX ? Z_FLIGHT : 0)
      }
    }
    // The halo frames the just-drawn card, but only once it has landed:
    // it tracks the sprite's live position and stays hidden mid-flight.
    const drawn = haloKey ? managed.get(haloKey) : undefined
    if (drawn && !drawn.leaving) {
      const dx = drawn.tx - drawn.sprite.x
      const dy = drawn.ty - drawn.sprite.y
      halo.position.set(drawn.sprite.x, drawn.sprite.y)
      halo.visible = dx * dx + dy * dy < LIFT_PX * LIFT_PX
    } else {
      halo.visible = false
    }
    fireworks.update(dt)
  }
  app.ticker.add(tick)

  // Pixi's resizeTo owns the canvas size; this only recomputes what depends
  // on it and tells the DOM overlay, and only when the size actually changed.
  const publishMetrics = () => {
    const key = `${app.screen.width}x${app.screen.height}`
    if (key === metricsKey) return
    metricsKey = key
    metrics = tableMetrics(app.screen.width, app.screen.height)
    handlers.onMetrics(metrics)
  }
  const onResize = () => {
    publishMetrics()
    reconcile()
  }
  app.renderer.on('resize', onResize)
  publishMetrics()

  return {
    update(snapshot, perspective, ginKeys) {
      const game = snapshot.game
      const reveal =
        game && game.phase === 'handOver'
          ? {
              top: bestArrangement(game.hands[otherSeat(perspective)]),
              bottom: bestArrangement(game.hands[perspective]),
            }
          : null
      // A hand that ends under the pointer (the opponent declaring gin)
      // takes the cards away from the drag.
      if (reveal) cancelDrag()
      let handGroups: readonly (readonly Card[])[] = []
      if (game && game.phase !== 'handOver') {
        if (snapshot.autoGroup) {
          const arrangement = bestArrangement(game.hands[perspective])
          handGroups = [...arrangement.melds, arrangement.deadwood]
        } else {
          handGroups = [orderHand(game.hands[perspective], snapshot.handOrder[perspective])]
        }
      }
      last = { snapshot, perspective, ginKeys, reveal, handGroups }

      // Celebrate once per hand, and only the viewer's own gin.
      const won =
        game?.phase === 'handOver' &&
        game.result?.type === 'gin' &&
        game.result.winner === perspective
      if (won && !celebrated) {
        celebrated = true
        if (!reducedMotion) fireworks.burst(app.screen.width, app.screen.height)
      } else if (game && game.phase !== 'handOver') {
        celebrated = false
      }

      reconcile()
    },
    destroy() {
      cancelDrag()
      app.ticker.remove(tick)
      app.renderer.off('resize', onResize)
      app.stage.off('globalpointermove', onDragMove)
      fireworks.destroy()
      root.destroy({ children: true })
      managed.clear()
    },
  }
}

// Lays out a row of card groups with a visible gap at group boundaries;
// a single group is a plain evenly-spaced row.
function groupedXs(
  groups: readonly (readonly Card[])[],
  width: number,
  metrics: TableMetrics,
): { held: Card; x: number }[] {
  const flat: { held: Card; group: number }[] = []
  groups.forEach((group, index) => {
    for (const held of group) flat.push({ held, group: index })
  })
  if (flat.length === 0) return []
  const boundaries = groups.filter((group) => group.length > 0).length - 1
  const gaps = Math.max(boundaries, 0) * metrics.groupGap
  const spacing = Math.min(
    metrics.cardW + 10 * metrics.scale,
    (width - metrics.cardW - metrics.edge * 2 - gaps) / Math.max(flat.length - 1, 1),
  )
  let x = width / 2 - (spacing * (flat.length - 1) + gaps) / 2
  return flat.map((entry, index) => {
    if (index > 0) {
      x += spacing
      if (entry.group !== flat[index - 1].group) x += metrics.groupGap
    }
    return { held: entry.held, x }
  })
}

// The Knoll set has no back; a drawn one stands in. Generated at the base
// size and scaled per sprite, so a resize never regenerates it.
function backTexture(app: Application): Texture {
  const g = new Graphics()
    .roundRect(0, 0, 270, 378, 18)
    .fill('#27508f')
    .stroke({ width: 8, color: '#ffffff' })
    .roundRect(16, 16, 238, 346, 10)
    .stroke({ width: 3, color: '#9db4e8' })
  return app.renderer.generateTexture(g)
}
