# Gin Rummy — Project Design

**Status:** REVISED 2026-08-01 after an adversarial design review (three Claude
lenses + a qwen breadth pass, per the practice from the platformer-rust
project). The review's confirmed findings and the decisions locked during it
are folded in below; this supersedes the first draft. Build can follow this
doc. Updated 2026-08-01: aces wrap (round-the-corner), adopted from the PR #1
review.

## What the review changed (summary)

- The relay owns action ordering; clients never stamp their own.
- The shuffle PRNG's state lives inside engine state, so redeals and replays
  are deterministic from (seed, action log) alone.
- `start` carries a full hand contract: seed, dealer, seat mapping.
- The rules section now states the exact stock-exhaustion boundary, the rule
  against discarding the card just taken, and explicit turn phases.
- The minimum-deadwood search is specified (sub-meld enumeration), not just
  asserted.
- Gin is declared manually (rules-faithful); the engine tells the UI which
  discards would be gin.
- The client section names the store→scene reconciler, the Pixi canvas
  lifecycle rules, and the seat transport/perspective split.
- Dev mode is two tabs joined by a loopback transport speaking the real
  message schema.
- Test tooling is step 0 of the build order; determinism and the meld search
  have named test plans.
- The engine's "reused by a server later" claim is dropped — purity is
  justified by testability alone. The relay-protocol section is provisional
  except two locked invariants.

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
- **Authority:** the server is a rules-ignorant relay — it never runs the
  engine, but it does own two things: the order of actions and the delivery
  of the hand contract. Both clients run the same deterministic engine and
  stay in sync by applying the same actions in the same order. The opponent's
  hand exists in client memory but is hidden by the UI — honor system between
  friends.
- **Rules:** straight gin — no knocking, no layoffs, no undercut. You win a
  hand only by going gin.
- **Format:** single standalone hands, no running match score.
- **Gin is declared manually** (declaring is optional, per the formal rules).
  The engine exposes a query for which discards would be gin so the UI can
  offer the declaration reliably.
- **Dev mode:** two browser tabs, each fixed to one seat, joined by a
  loopback transport (BroadcastChannel) speaking the real message schema.

## Components

1. **Rules engine** — pure TypeScript in `clients/web/src/engine/`. No React,
   Pixi, DOM, or network imports; purity is what makes it testable alone.
2. **Web client** — React shell (menus, hand results) plus a PixiJS table
   scene (cards, piles, drag and drop).
3. **Socket relay** — an API Gateway WebSocket API + Lambda, sketched here
   but built in a later phase. The current infrastructure only has an HTTP
   API; WebSockets are a separate Terraform resource.

## The rules we implement (straight gin)

- Standard 52-card deck, aces wrap (round-the-corner): runs are contiguous
  on the 13-rank cycle, so A-2-3, Q-K-A, and K-A-2 are all legal. Ace
  counts 1, face cards count 10.
- The dealer of hand 1 is the room's creator (in dev mode, the tab that
  creates the local room). A dead hand is redealt by the same dealer.
- Deal 10 cards each; the next card starts the discard pile (the upcard).
- First-turn ritual, as explicit phases: the non-dealer may take the upcard
  or pass; then the dealer may take it or pass; if both pass, the non-dealer
  must draw from the stock — the refused upcard may not be taken. Taking the
  upcard is that player's draw: they discard next, and may not also draw from
  the stock.
- A normal turn is two phases: draw one card (top of stock or top of discard
  pile), then discard one card.
- A player may not discard the card they took from the discard pile that same
  turn (this also applies to a taken upcard). Without this rule, players
  could pass one card back and forth forever without touching the stock.
- Going gin: a player whose discard leaves all 10 remaining cards in melds
  (sets of 3–4 of a rank, runs of 3+ in one suit) may declare gin on that
  discard. Declaring is optional; an undeclared gin hand keeps playing.
- Big gin needs no special handling: any fully-melded 11-card hand contains a
  meld of four or more, so a discard that preserves gin always exists. (Noted
  so nobody files "big gin missing" as a bug.)
- Stock exhaustion, exactly: drawing is illegal when the stock holds 2 cards.
  The player who draws the third-to-last card finishes their turn normally —
  their discard may still declare gin. If that discard is not a declared gin,
  the hand is dead: a draw, redealt by the same dealer.
- The hand ends immediately on a declared gin. The winner's margin is the
  loser's deadwood total (sum of unmelded card values under the loser's best
  arrangement).

## Rules engine design

- **A pure reducer.** `advance(state, action) -> state` (or a rejection with
  a reason from a small fixed taxonomy). Actions: take upcard, pass upcard,
  draw from stock, draw from discard, discard (with a declare-gin flag). The
  engine validates everything against the current phase; the UI never decides
  legality.
- **Engine queries.** `legalActions(state, seat)` — what the seat may do
  right now (drives all UI affordances); `ginDiscards(hand)` — which of an
  11-card hand's discards leave gin (drives the declare-gin offer).
- **Cards are identities, never indexes.** Every action names a card by rank
  and suit. Hand display order is presentation state the engine never reads —
  index references would silently desync two engines.
- **Explicit phases in state.** Upcard-offer (non-dealer) → upcard-offer
  (dealer) → forced stock draw → turn loop (draw phase → discard phase) →
  `HandResult` (gin or dead). A `startHand` action begins hand 1 and every
  redeal; redeal and "play again" are the same mechanism.
- **Deterministic shuffle, specified.** Fisher–Yates driven by a small
  integer-output seeded PRNG (e.g. mulberry32) implemented in the engine. The
  PRNG's state lives inside engine state, so a redeal deterministically
  continues the stream — (initial seed, action log) reproduces everything,
  including redeals. Engine-wide ban: no `Math.random`, no `Date`, no
  locale-dependent APIs, no comparator-shuffle.
- **Minimum-deadwood search, specified.** Generate every candidate meld —
  all 3- and 4-card subsets of each rank, every same-suit sub-run of
  length ≥ 3 that is contiguous on the 13-rank cycle (wrap-around windows
  included, up to all 13) — then backtrack over disjoint combinations for
  minimum deadwood. Maximal-meld enumeration is wrong: some gins exist only by
  splitting a four-of-a-kind or a long run, and those cases are mandated
  tests.
- **Testing.** Test-driven: write the test that proves a rule first, then the
  rule. Vitest (MIT). Named plans:
  - Golden fixtures: a known seed produces a known PRNG stream and a known
    deal, asserted byte-for-byte.
  - Determinism: two engine instances replay one (seed, action log) and are
    deep-equal after every action. The fixture format doubles as the future
    resync payload.
  - Meld search: a deliberately naive brute-force partition enumerator as an
    independent oracle, property-tested against the real search over
    randomized hands (fast-check, MIT); the oracle implements cyclic run
    legality independently, never by importing the engine's helper. Plus
    the split-a-set and split-a-run gin cases; A-2-3, Q-K-A, and K-A-2
    legal (wrap); Q-A-2 illegal (not contiguous on the cycle).
  - Every illegal transition in the phase diagram gets a rejection test.

## Client design

- **One store, one direction.** The engine state plus minimal UI state
  (selected card, pending action) lives in a single store; React subscribes
  via `useSyncExternalStore`. Nothing animation- or pointer-related ever
  enters the reducer or the action log — that would poison determinism and
  desync replays.
- **The scene reconciler is a real component.** The Pixi scene keeps its own
  sprite graph and maps store snapshots to sprite targets; it owns all
  tweens, gesture positions, and in-flight card motion locally. Mid-drag, a
  card's position belongs to the pointer, not the store.
- **Canvas lifecycle.** One component owns the Pixi `Application`. Init is
  guarded for React StrictMode's double-invoked effects (Pixi v8's `init()`
  is async — cleanup must await it before `destroy()`), the scene module
  handles HMR disposal so exactly one canvas ever exists, and Pixi's
  `resizeTo` is the single resize owner.
- **Transport and perspective are separate seat concepts.** A seat's
  *transport* (local pointer vs network) is swappable and the table logic
  doesn't care. The *viewer's seat* is explicit and drives what renders face
  up, what is draggable, and the table orientation.
- **Dev mode = the protocol, early.** Two tabs, each fixed to one seat,
  joined by a BroadcastChannel loopback speaking the real message schema.
  Hidden hands, perspective, and async remote actions are exercised from
  phase 2 on; the relay phase swaps the transport and changes nothing else.
- **Card textures.** The 52 Byron Knoll SVGs vendored with a provenance
  note. Loaded via a Vite glob import (hashed URLs, `.svg` extensions
  preserved for Pixi's loader) and rasterized at an explicit resolution sized
  to the largest on-screen card; if draw-call batching or sharpness
  disappoints, consolidate into a build-time texture atlas.

## Relay protocol (provisional sketch — built later)

Two invariants are locked now, because the engine and client are built
against them:

1. **Client state is a pure function of (seed, ordered action log).**
2. **The relay is the sequencer.** It assigns each action a per-room,
   monotonically increasing sequence number as it persists it, then fans out.
   Clients apply only relay-stamped actions, in sequence order — including
   the echoes of their own — deduplicate by sequence number, and request
   resync on a gap.

The rest is a sketch, expected to be refined by what the loopback dev mode
teaches us:

- **Rooms.** Creator gets a short room code; the second player joins with it.
  Joining issues a session token that outlives socket connections, so a
  reconnecting player can prove they are seat 2 and not a stranger.
- **Hand contract.** `start` carries the seed, who deals, and the
  seat↔player mapping. For dev mode the creating tab picks the seed; over
  the real relay, each client contributes a random value and the seed is a
  hash of both, so neither side can grind for a good deal.
- **Reconnection.** Keepalive pings (API Gateway idle-drops at ~10 minutes);
  `resync` is a full bootstrap — hand contract plus the action log — and the
  reconnecting client discards local state entirely and rebuilds.
- **Storage.** Connection IDs, rooms, tokens, and the action log live in
  DynamoDB; the exact shape is deliberately undecided.

## Build order

0. **Test tooling.** Install and configure Vitest (verify compatibility with
   the workspace's Vite 8), enable `strict` in the web tsconfig, add
   `test` scripts, and add a test step to CI so nothing deploys with failing
   tests.
1. **Rules engine, TDD.** Phases, actions, PRNG, meld search, queries — each
   rule preceded by its proving test.
2. **Card assets + table UI**, playable via the two-tab loopback dev mode.
3. *(later, out of current scope)* Relay server, Terraform for the WebSocket
   API, room lobby UI, reconnect flow.
