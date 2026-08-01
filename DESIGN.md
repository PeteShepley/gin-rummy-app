# Gin Rummy — Project Design

## What we're building

Two friends play straight gin against each other in their browsers. A small
central socket server relays messages between them; the browsers do all the
game thinking. This document designs the whole project; we're building the
card game first and the networking later.

## Decisions already made

- **License:** MIT. Every dependency and asset must be MIT-compatible or more
  permissive.
- **Card art:** Byron Knoll's Vector Playing Cards (public domain).
- **Stack:** React + Vite shell, PixiJS canvas for the table.
- **Authority:** the server is a dumb relay. Both clients run the same
  deterministic engine and stay in sync by applying the same actions in the
  same order. The opponent's hand exists in client memory but is hidden by the
  UI — honor system between friends.
- **Rules:** straight gin — no knocking, no layoffs, no undercut. You win a
  hand only by going gin.
- **Format:** single standalone hands, no running match score.

## Components

1. **Rules engine** — pure TypeScript in `clients/web/src/engine/`. No React,
   Pixi, or network imports, so it can be tested alone and reused by a server
   later.
2. **Web client** — React shell (menus, hand results) plus a PixiJS table
   scene (cards, piles, drag and drop).
3. **Socket relay** — an API Gateway WebSocket API + Lambda, designed here but
   built in a later phase. The current infrastructure only has an HTTP API;
   WebSockets are a separate Terraform resource.

## The rules we implement (straight gin)

- Standard 52-card deck, aces low. Ace counts 1, face cards count 10.
- Deal 10 cards each; the next card starts the discard pile (the upcard).
- First turn ritual: the non-dealer may take the upcard or pass; then the
  dealer may take it or pass; if both pass, the non-dealer draws from stock.
- A normal turn is: draw one card (top of stock or top of discard pile), then
  discard one card.
- No knocking. A player goes gin by discarding so that all 10 remaining cards
  form melds (sets of 3–4 of a rank, or runs of 3+ in one suit).
- The hand ends immediately on gin. The winner's margin is the loser's
  deadwood total (sum of unmelded card values under the loser's best
  arrangement).
- If the stock gets down to 2 cards and nobody has gone gin, the hand is a
  draw — redeal.

## Rules engine design

- **A pure reducer.** `advance(state, action) -> state` (or a rejection with a
  reason). Actions: take/pass the upcard, draw from stock, draw from discard,
  and discard (with a "declaring gin" flag). The engine validates everything;
  the UI never decides legality.
- **Deterministic shuffle.** A small seeded PRNG implemented in the engine (no
  dependency). The seed is created when a hand starts and shared with both
  clients; identical seed + identical actions = identical states everywhere.
- **Action log.** The full state is reproducible from (seed, action list).
  That gives us replay for reconnects and resync over the relay for free.
- **Meld detection.** An exact search over a 10-card hand for the arrangement
  with minimum deadwood (the space is tiny). Used to validate gin declarations
  and to score the loser's deadwood.
- **Testing.** Test-driven: write the test that proves a rule first, then the
  rule. Unit tests with Vitest (MIT) — meld edge cases, full-hand replays,
  illegal-action rejections.

## Client design

- **One store.** The engine state lives in a single store; React components
  and the Pixi scene both subscribe to it. Plain reducer +
  `useSyncExternalStore`, no state library.
- **Seats as an abstraction.** A seat's actions come from a local pointer
  (this player), or later from the network (remote player). The table UI
  doesn't know the difference. Until networking exists, a local dev mode runs
  both seats in one browser.
- **Pixi table scene.** Stock pile, discard pile, opponent's hand (face
  down), player's hand as a draggable fan. Click a pile to draw, drag a card
  to the discard pile to discard.
- **Card textures.** The 52 Byron Knoll SVGs vendored into the repo with a
  provenance note, loaded as Pixi textures.

## Relay protocol (designed now, built later)

- **Rooms.** Creator gets a short room code; the second player joins with it.
- **Messages.** `join`, `start` (carries the shuffle seed), `action` (an
  engine action with a sequence number), `resync` (replays the action log),
  and presence/disconnect notices.
- **Server state.** Even a dumb relay needs DynamoDB for connection IDs,
  rooms, and the action log (so reconnects can resync).

## Build order

1. Rules engine + tests.
2. Card assets + Pixi table UI, playable locally via the two-seat dev mode.
3. *(later, out of current scope)* Relay server, Terraform for the WebSocket
   API, room lobby UI, reconnect flow.
