import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application, Texture } from 'pixi.js'
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

// The scene owns sprites and layout; the store owns truth; the shell
// derives the gin offer and passes it in. update() derives everything
// game-shaped once per snapshot; layout() is geometry only, so resizes
// never re-run the meld search. v1 rebuilds the sprite graph on every
// update - cheap at ~52 sprites, and a diffing reconciler earns its
// keep only once tweens arrive.
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
  app.stage.addChild(root)

  interface Derived {
    snapshot: GameSnapshot
    perspective: Seat
    ginKeys: ReadonlySet<string>
    reveal: { top: Arrangement; bottom: Arrangement } | null
    handGroups: readonly (readonly Card[])[]
  }
  let last: Derived | null = null

  const face = (of: Card): Texture => {
    const texture = faces.get(cardKey(of))
    if (!texture) throw new Error(`no texture loaded for ${cardKey(of)}`)
    return texture
  }

  const card = (texture: Texture, x: number, y: number): Sprite => {
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.width = CARD_W
    sprite.height = CARD_H
    sprite.position.set(x, y)
    root.addChild(sprite)
    return sprite
  }

  const clickable = (target: Container, onTap: () => void) => {
    target.eventMode = 'static'
    target.cursor = 'pointer'
    target.on('pointertap', onTap)
  }

  const layout = () => {
    if (!last) return
    for (const child of root.removeChildren()) child.destroy({ children: true })
    const { snapshot, perspective, ginKeys, reveal, handGroups } = last
    const game = snapshot.game
    if (!game) return
    const { width, height } = app.screen

    // The lay-down: a finished hand is proof, so both hands show face
    // up, clustered by their best arrangement, deadwood greyed.
    if (reveal) {
      const show = (arrangement: Arrangement, y: number) => {
        const deadwoodKeys = new Set(arrangement.deadwood.map(cardKey))
        for (const placed of groupedXs([...arrangement.melds, arrangement.deadwood], width)) {
          const sprite = card(face(placed.held), placed.x, y)
          if (deadwoodKeys.has(cardKey(placed.held))) sprite.tint = DEADWOOD_TINT
        }
      }
      show(reveal.top, EDGE + CARD_H / 2)
      show(reveal.bottom, height - EDGE - CARD_H / 2)
      return
    }

    for (const placed of groupedXs([game.hands[otherSeat(perspective)]], width)) {
      card(back, placed.x, EDGE + CARD_H / 2)
    }

    if (game.stock.length > 0) {
      const stockX = width / 2 - CARD_W * 0.75
      clickable(card(back, stockX, height / 2), handlers.onStockClick)
      const count = new Text({
        text: `${game.stock.length}`,
        style: { fill: '#ffffff', fontSize: 16 },
      })
      count.anchor.set(0.5)
      count.position.set(stockX, height / 2 + CARD_H / 2 + 14)
      root.addChild(count)
    }

    const slotX = width / 2 + CARD_W * 0.75
    const top = game.discardPile[game.discardPile.length - 1]
    if (top) {
      clickable(card(face(top), slotX, height / 2), handlers.onDiscardPileClick)
    } else {
      const slot = new Graphics()
        .roundRect(slotX - CARD_W / 2, height / 2 - CARD_H / 2, CARD_W, CARD_H, 8)
        .fill({ color: 0xffffff, alpha: 0.08 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
      clickable(slot, handlers.onDiscardPileClick)
      root.addChild(slot)
    }

    for (const placed of groupedXs(handGroups, width)) {
      const held = placed.held
      const raised = snapshot.selectedCard && sameCard(held, snapshot.selectedCard) ? RAISE : 0
      const y = height - EDGE - CARD_H / 2 - raised
      if (
        snapshot.lastDrawn &&
        snapshot.lastDrawn.seat === perspective &&
        sameCard(held, snapshot.lastDrawn.card)
      ) {
        const halo = new Graphics()
          .roundRect(placed.x - (CARD_W + 10) / 2, y - (CARD_H + 10) / 2, CARD_W + 10, CARD_H + 10, 10)
          .stroke({ width: 3, color: 0x7fd1ff })
        root.addChild(halo)
      }
      const sprite = card(face(held), placed.x, y)
      if (ginKeys.has(cardKey(held))) sprite.tint = GIN_TINT
      clickable(sprite, () => handlers.onCardClick(held))
    }
  }

  const onResize = () => layout()
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
      layout()
    },
    destroy() {
      app.renderer.off('resize', onResize)
      root.destroy({ children: true })
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
