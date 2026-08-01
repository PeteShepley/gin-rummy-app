import { Assets, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application, Texture } from 'pixi.js'
import { cardAssetUrl } from './cardAssets.ts'
import { cardKey, sameCard } from './engine/cards.ts'
import { newDeck } from './engine/deck.ts'
import { bestArrangement, ginDiscards } from './engine/melds.ts'
import { otherSeat } from './engine/game.ts'
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
// leave that stale closure rendering old code. Force a full reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot?.invalidate()
  })
}

export interface SceneHandlers {
  onCardClick(card: Card): void
  onStockClick(): void
  onDiscardClick(): void
}

export interface TableScene {
  update(snapshot: GameSnapshot, perspective: Seat): void
  destroy(): void
}

// The scene owns sprites and layout; the store owns truth. v1 rebuilds
// the sprite graph on every update - cheap at ~52 sprites, and a
// diffing reconciler earns its keep only once tweens arrive.
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

  let last: { snapshot: GameSnapshot; perspective: Seat } | null = null

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
    const { snapshot, perspective } = last
    const game = snapshot.game
    if (!game) return
    const { width, height } = app.screen

    // The engine names the discards that go gin; the scene offers them
    // proactively (gold tint) for the acting viewer.
    const ginKeys =
      game.phase === 'discard' && game.toAct === perspective
        ? new Set(ginDiscards(game.hands[perspective]).map(cardKey))
        : new Set<string>()

    // The lay-down: a finished hand is proof, so both hands show face up,
    // clustered by their best arrangement, deadwood greyed.
    const reveal = (hand: readonly Card[], y: number) => {
      const arrangement = bestArrangement(hand)
      const deadwoodKeys = new Set(arrangement.deadwood.map(cardKey))
      for (const placed of groupedXs([...arrangement.melds, arrangement.deadwood], width)) {
        const sprite = card(face(placed.held), placed.x, y)
        if (deadwoodKeys.has(cardKey(placed.held))) sprite.tint = DEADWOOD_TINT
      }
    }

    if (game.phase === 'handOver') {
      reveal(game.hands[otherSeat(perspective)], EDGE + CARD_H / 2)
      reveal(game.hands[perspective], height - EDGE - CARD_H / 2)
      return
    }

    rowXs(game.hands[otherSeat(perspective)].length, width).forEach((x) => {
      card(back, x, EDGE + CARD_H / 2)
    })

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
      clickable(card(face(top), slotX, height / 2), handlers.onDiscardClick)
    } else {
      const slot = new Graphics()
        .roundRect(slotX - CARD_W / 2, height / 2 - CARD_H / 2, CARD_W, CARD_H, 8)
        .fill({ color: 0xffffff, alpha: 0.08 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 })
      clickable(slot, handlers.onDiscardClick)
      root.addChild(slot)
    }

    const hand = game.hands[perspective]
    const handGroups = snapshot.autoGroup
      ? (() => {
          const arrangement = bestArrangement(hand)
          return [...arrangement.melds, arrangement.deadwood]
        })()
      : [hand]
    for (const placed of groupedXs(handGroups, width)) {
      const held = placed.held
      const raised = snapshot.selectedCard && sameCard(held, snapshot.selectedCard) ? RAISE : 0
      const sprite = card(face(held), placed.x, height - EDGE - CARD_H / 2 - raised)
      if (ginKeys.has(cardKey(held))) sprite.tint = GIN_TINT
      clickable(sprite, () => handlers.onCardClick(held))
    }
  }

  const onResize = () => layout()
  app.renderer.on('resize', onResize)

  return {
    update(snapshot, perspective) {
      last = { snapshot, perspective }
      layout()
    },
    destroy() {
      app.renderer.off('resize', onResize)
      root.destroy({ children: true })
    },
  }
}

function rowXs(count: number, width: number): number[] {
  if (count === 0) return []
  const spacing = Math.min(CARD_W + 10, (width - CARD_W - EDGE * 2) / Math.max(count - 1, 1))
  const start = width / 2 - (spacing * (count - 1)) / 2
  return Array.from({ length: count }, (_, i) => start + i * spacing)
}

// Lays out a row of card groups with a visible gap at group boundaries.
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
