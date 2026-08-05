import type { Action, Seat } from "./engine/game.ts";

// The wire protocol, canonical here. Two transports speak it: the
// BroadcastChannel loopback (dev, two tabs) and the WebSocket relay
// (production, two browsers). DESIGN.md locked the game-relay messages so
// "the relay phase replaces the shim and the channel; no message changes
// shape." The lobby messages below are the extra envelope the real relay
// needs to create/join/reconnect to a room; the loopback never sends them.
//
// The relay service (services/relay) re-declares the message types it needs
// rather than importing across the workspace boundary; this file is the
// source of truth if the two ever drift.

// The hand contract carried by `start` and `resync`: the shuffle seed, who
// deals hand 1, the seat each role holds, and the display name shown on each
// seat. Applying it creates a fresh engine at that seed; every deal is then a
// sequenced `startHand`, so (seed, action log) alone replays everything.
export interface Contract {
  readonly seed: number;
  readonly dealer: Seat;
  readonly seats: { readonly creator: Seat; readonly joiner: Seat };
  readonly names: { readonly a: string; readonly b: string };
}

export interface Stamped {
  readonly seq: number;
  readonly action: Action;
}

// Why a lobby request was refused. `badCode`: no such room. `roomFull`: the
// second seat is already claimed (rejoin needs the token, not the code).
// `badToken`: a reconnect presented a token that matches no seat.
export type ErrorReason = "badCode" | "roomFull" | "badToken";

export type WireMessage =
  // --- lobby (WebSocket relay only) ---
  | { kind: "create"; name: string; rnd: number } // client -> server
  | { kind: "created"; code: string; token: string } // server -> creator
  | { kind: "join"; code: string; name: string; rnd: number } // client -> server
  | { kind: "joined"; token: string } // server -> joiner
  | { kind: "reconnect"; code: string; token: string } // client -> server
  | { kind: "error"; reason: ErrorReason } // server -> client
  // --- game relay (locked schema; the loopback speaks these verbatim) ---
  | ({ kind: "start" } & Contract)
  | { kind: "submit"; action: Action }
  | ({ kind: "action" } & Stamped)
  | { kind: "resyncRequest" }
  | ({ kind: "resync" } & Contract & { readonly log: readonly Stamped[] });
