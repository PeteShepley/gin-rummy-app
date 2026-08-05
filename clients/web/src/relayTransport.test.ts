import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRelayTransport } from "./relayTransport.ts";
import { createGameStore } from "./store.ts";
import type { LobbyEvent } from "./relayTransport.ts";
import type { Contract } from "./protocol.ts";

// A minimal in-test WebSocket: the transport talks to this instead of a real
// socket, so we can drive server->client messages and inspect what the client
// sent. Node 22 ships a real global WebSocket, so we must stub it.
class MockWebSocket {
  static OPEN = 1;
  static last: MockWebSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  url: string;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.last = this;
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (fn) => fn !== cb
    );
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
  // --- test drivers ---
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }
  receive(message: unknown) {
    this.emit("message", { data: JSON.stringify(message) });
  }
  private emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  MockWebSocket.last = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const contract: Contract = {
  seed: 42,
  dealer: "a",
  seats: { creator: "a", joiner: "b" },
  names: { a: "Ada", b: "Bo" }
};

test("create queues until open, then sends the create message", () => {
  const store = createGameStore();
  const transport = createRelayTransport({
    store,
    url: "ws://test",
    onEvent: () => {}
  });
  const socket = MockWebSocket.last!;

  transport.create("Ada");
  expect(socket.sent).toEqual([]); // queued while connecting

  socket.open();
  expect(socket.sent).toEqual([
    { kind: "create", name: "Ada", rnd: expect.any(Number) }
  ]);

  transport.destroy();
});

test("a start contract boots the store at the creator seat and reports started", () => {
  const store = createGameStore();
  const events: LobbyEvent[] = [];
  const transport = createRelayTransport({
    store,
    url: "ws://test",
    onEvent: (e) => events.push(e)
  });
  const socket = MockWebSocket.last!;
  socket.open();
  transport.create("Ada");

  socket.receive({ kind: "created", code: "ABC123", token: "tok" });
  expect(events).toContainEqual({ type: "created", code: "ABC123" });

  socket.receive({ kind: "start", ...contract });
  expect(events).toContainEqual({ type: "started" });
  expect(store.getSnapshot().viewerSeat).toBe("a");
  expect(store.getSnapshot().names).toEqual({ a: "Ada", b: "Bo" });
  expect(store.getSnapshot().game?.phase).toBe("awaitingStart");

  transport.destroy();
});

test("stamped actions apply in order; submit never applies locally", () => {
  const store = createGameStore();
  const transport = createRelayTransport({
    store,
    url: "ws://test",
    onEvent: () => {}
  });
  const socket = MockWebSocket.last!;
  socket.open();
  transport.join("ABC123", "Bo");
  socket.receive({ kind: "start", ...contract });

  // A submit goes on the wire but changes nothing locally (the server echoes).
  transport.submit({ type: "startHand" });
  expect(store.getSnapshot().game?.phase).toBe("awaitingStart");
  expect(socket.sent).toContainEqual({
    kind: "submit",
    action: { type: "startHand" }
  });

  // The stamped echo is what advances the store.
  socket.receive({ kind: "action", seq: 1, action: { type: "startHand" } });
  expect(store.getSnapshot().game?.phase).toBe("upcardOfferNonDealer");

  transport.destroy();
});

test("a gap in the stamp stream triggers a resync request", () => {
  const store = createGameStore();
  const transport = createRelayTransport({
    store,
    url: "ws://test",
    onEvent: () => {}
  });
  const socket = MockWebSocket.last!;
  socket.open();
  transport.join("ABC123", "Bo");
  socket.receive({ kind: "start", ...contract });
  socket.sent.length = 0;

  // seq 2 arrives before seq 1: the client asks for a full bootstrap.
  socket.receive({ kind: "action", seq: 2, action: { type: "startHand" } });
  expect(socket.sent).toContainEqual({ kind: "resyncRequest" });
  expect(store.getSnapshot().game?.phase).toBe("awaitingStart");

  transport.destroy();
});

test("resync rebuilds the store from the contract plus the full log", () => {
  const store = createGameStore();
  const transport = createRelayTransport({
    store,
    url: "ws://test",
    onEvent: () => {}
  });
  const socket = MockWebSocket.last!;
  socket.open();
  transport.reconnect("ABC123", "tok", "b");

  socket.receive({
    kind: "resync",
    ...contract,
    log: [
      { seq: 1, action: { type: "startHand" } },
      { seq: 2, action: { type: "passUpcard", seat: "b" } }
    ]
  });

  const reference = createGameStore();
  reference.start({
    seed: 42,
    dealer: "a",
    viewerSeat: "b",
    names: contract.names
  });
  reference.apply({ type: "startHand" });
  reference.apply({ type: "passUpcard", seat: "b" });
  expect(store.getSnapshot().game).toEqual(reference.getSnapshot().game);
  expect(store.getSnapshot().viewerSeat).toBe("b");

  transport.destroy();
});
