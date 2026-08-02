import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application, Texture, Ticker } from 'pixi.js'
import { cardAssetUrl } from './cardAssets.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import { newDeck } from './engine/deck.ts'
import { bestArrangement } from './engine/melds.ts'
import { otherSeat } from './engine/game.ts'
import type { Arrangement } from './engine/melds.ts'
import type { Seat } from './engine/game.ts'
import type { Card } from './engine/cards.ts'
import type { GameSnapshot } from './store.ts'

const CARD_W = 90
const CARD_H = 126
const EDGE = 16
const RAISE = 18
const GROUP_GAP = 22
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

// Draw order. Cards in flight lift above the whole table so a slide
// never disappears behind a pile or a neighbour; the halo sits just
// under the card it frames.
const Z_OPPONENT = 0
const Z_PILE = 10
const Z_COUNT = 12
const Z_HALO = 18
const Z_HAND = 20
const Z_FLIGHT = 1000

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
  tint: number
  baseZ: number
  // Where a freshly created sprite starts before its first slide. New
  // hand and pile cards fly in from the deck; reveal cards just appear.
  spawn: { x: number; y: number } | null
  onTap: (() => void) | null
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

  // Decorations live outside the tweened card pool: they never move
  // between zones, so they are created once and repositioned in place.
  const halo = new Graphics()
    .roundRect(-(CARD_W + 10) / 2, -(CARD_H + 10) / 2, CARD_W + 10, CARD_H + 10, 10)
    .stroke({ width: 3, color: 0x7fd1ff })
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

  const face = (of: Card): Texture => {
    const texture = faces.get(cardKey(of))
    if (!texture) throw new Error(`no texture loaded for ${cardKey(of)}`)
    return texture
  }

  // Geometry only - no meld search, no sprite churn - so it is cheap
  // enough to re-run on every resize frame.
  const buildTargets = (): BuildResult => {
    const { snapshot, perspective, ginKeys, reveal, handGroups } = last!
    const game = snapshot.game
    const { width, height } = app.screen
    const cards: CardTarget[] = []
    if (!game) return { cards, count: null, slot: null, haloKey: null }

    const stockCenter = { x: width / 2 - CARD_W * 0.75, y: height / 2 }
    const slotX = width / 2 + CARD_W * 0.75

    // The lay-down: a finished hand is proof, so both hands show face up,
    // clustered by their best arrangement, deadwood greyed. Reveal cards
    // appear in place; the viewer's own cards keep their keys and slide
    // from their in-hand spots into the grouped arrangement.
    if (reveal) {
      const show = (arrangement: Arrangement, y: number) => {
        const deadwoodKeys = new Set(arrangement.deadwood.map(cardKey))
        for (const placed of groupedXs([...arrangement.melds, arrangement.deadwood], width)) {
          cards.push({
            key: cardKey(placed.held),
            texture: face(placed.held),
            x: placed.x,
            y,
            tint: deadwoodKeys.has(cardKey(placed.held)) ? DEADWOOD_TINT : NO_TINT,
            baseZ: Z_HAND,
            spawn: null,
            onTap: null,
          })
        }
      }
      show(reveal.top, EDGE + CARD_H / 2)
      show(reveal.bottom, height - EDGE - CARD_H / 2)
      return { cards, count: null, slot: null, haloKey: null }
    }

    // The opponent's hand is a row of face-down backs, keyed by position:
    // the viewer never learns which cards they are.
    groupedXs([game.hands[otherSeat(perspective)]], width).forEach((placed, index) => {
      cards.push({
        key: `opp:${index}`,
        texture: back,
        x: placed.x,
        y: EDGE + CARD_H / 2,
        tint: NO_TINT,
        baseZ: Z_OPPONENT,
        spawn: stockCenter,
        onTap: null,
      })
    })

    let count: BuildResult['count'] = null
    if (game.stock.length > 0) {
      cards.push({
        key: 'stock',
        texture: back,
        x: stockCenter.x,
        y: stockCenter.y,
        tint: NO_TINT,
        baseZ: Z_PILE,
        spawn: null,
        onTap: handlers.onStockClick,
      })
      count = { text: `${game.stock.length}`, x: stockCenter.x, y: stockCenter.y + CARD_H / 2 + 14 }
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
        x: slotX,
        y: height / 2,
        tint: NO_TINT,
        baseZ: Z_PILE,
        spawn: stockCenter,
        onTap: handlers.onDiscardPileClick,
      })
    } else {
      slot = { x: slotX, y: height / 2 }
    }

    let nextHaloKey: string | null = null
    for (const placed of groupedXs(handGroups, width)) {
      const held = placed.held
      const raised = snapshot.selectedCard && sameCard(held, snapshot.selectedCard) ? RAISE : 0
      cards.push({
        key: cardKey(held),
        texture: face(held),
        x: placed.x,
        y: height - EDGE - CARD_H / 2 - raised,
        tint: ginKeys.has(cardKey(held)) ? GIN_TINT : NO_TINT,
        baseZ: Z_HAND,
        spawn: stockCenter,
        onTap: () => handlers.onCardClick(held),
      })
      if (
        snapshot.lastDrawn &&
        snapshot.lastDrawn.seat === perspective &&
        sameCard(held, snapshot.lastDrawn.card)
      ) {
        nextHaloKey = cardKey(held)
      }
    }

    return { cards, count, slot, haloKey: nextHaloKey }
  }

  const spawn = (target: CardTarget): Managed => {
    const sprite = new Sprite(target.texture)
    sprite.anchor.set(0.5)
    sprite.width = CARD_W
    sprite.height = CARD_H
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
      entry.tx = target.x
      entry.ty = target.y
      entry.baseZ = target.baseZ
      sprite.removeAllListeners('pointertap')
      if (target.onTap) {
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointertap', target.onTap)
      } else {
        sprite.eventMode = 'none'
        sprite.cursor = 'default'
      }
    }
    for (const [key, entry] of managed) {
      if (seen.has(key) || entry.leaving) continue
      entry.leaving = true
      entry.sprite.removeAllListeners('pointertap')
      entry.sprite.eventMode = 'none'
    }

    if (count) {
      stockCount.text = count.text
      stockCount.position.set(count.x, count.y)
      stockCount.visible = true
    } else {
      stockCount.visible = false
    }

    if (slot) {
      emptySlot
        .clear()
        .roundRect(slot.x - CARD_W / 2, slot.y - CARD_H / 2, CARD_W, CARD_H, 8)
        .fill({ color: 0xffffff, alpha: 0.08 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
      emptySlot.visible = true
    } else {
      emptySlot.visible = false
    }

    haloKey = nextHaloKey
  }

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
  }
  app.ticker.add(tick)

  const onResize = () => reconcile()
  app.renderer.on('resize', onResize)

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
      let handGroups: readonly (readonly Card[])[] = []
      if (game && game.phase !== 'handOver') {
        if (snapshot.autoGroup) {
          const arrangement = bestArrangement(game.hands[perspective])
          handGroups = [...arrangement.melds, arrangement.deadwood]
        } else {
          handGroups = [game.hands[perspective]]
        }
      }
      last = { snapshot, perspective, ginKeys, reveal, handGroups }
      reconcile()
    },
    destroy() {
      app.ticker.remove(tick)
      app.renderer.off('resize', onResize)
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
): { held: Card; x: number }[] {
  const flat: { held: Card; group: number }[] = []
  groups.forEach((group, index) => {
    for (const held of group) flat.push({ held, group: index })
  })
  if (flat.length === 0) return []
  const boundaries = groups.filter((group) => group.length > 0).length - 1
  const gaps = Math.max(boundaries, 0) * GROUP_GAP
  const spacing = Math.min(
    CARD_W + 10,
    (width - CARD_W - EDGE * 2 - gaps) / Math.max(flat.length - 1, 1),
  )
  let x = width / 2 - (spacing * (flat.length - 1) + gaps) / 2
  return flat.map((entry, index) => {
    if (index > 0) {
      x += spacing
      if (entry.group !== flat[index - 1].group) x += GROUP_GAP
    }
    return { held: entry.held, x }
  })
}

// The Knoll set has no back; a drawn one stands in.
function backTexture(app: Application): Texture {
  const g = new Graphics()
    .roundRect(0, 0, CARD_W * 3, CARD_H * 3, 18)
    .fill('#27508f')
    .stroke({ width: 8, color: '#ffffff' })
    .roundRect(16, 16, CARD_W * 3 - 32, CARD_H * 3 - 32, 10)
    .stroke({ width: 3, color: '#9db4e8' })
  return app.renderer.generateTexture(g)
}
