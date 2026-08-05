import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { createTableScene } from "./scene.ts";
import type { SceneHandlers, TableScene } from "./scene.ts";
import type { GameSnapshot } from "./store.ts";
import type { Seat } from "./engine/game.ts";

interface TableCanvasProps {
  snapshot: GameSnapshot;
  // The seat rendered face-up at the bottom of the table. The hotseat
  // harness passes the acting seat; the loopback passes the tab's fixed
  // viewer seat.
  perspective: Seat;
  // Which cards go gin right now, computed once by the shell so the
  // gold tint and the declare button can never disagree.
  ginKeys: ReadonlySet<string>;
  handlers: SceneHandlers;
}

// Owns the one Pixi Application. StrictMode runs mount effects twice and
// Pixi v8's init() is async, so cleanup waits for its own init to settle
// before destroying, and the canvas only attaches if this mount is still
// live when init resolves. resizeTo makes Pixi the single resize owner.
export function TableCanvas({
  snapshot,
  perspective,
  ginKeys,
  handlers
}: TableCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TableScene | null>(null);
  const latestRef = useRef({ snapshot, perspective, ginKeys });
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    latestRef.current = { snapshot, perspective, ginKeys };
    sceneRef.current?.update(snapshot, perspective, ginKeys);
  }, [snapshot, perspective, ginKeys]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    let live = true;
    const forwarded: SceneHandlers = {
      onCardClick: (clicked) => handlersRef.current.onCardClick(clicked),
      onStockClick: () => handlersRef.current.onStockClick(),
      onDiscardPileClick: () => handlersRef.current.onDiscardPileClick(),
      onHandReorder: (keys) => handlersRef.current.onHandReorder(keys),
      onMetrics: (metrics) => handlersRef.current.onMetrics(metrics)
    };
    const ready = app
      .init({ resizeTo: host, background: "#1d5c2e", antialias: true })
      .then(async () => {
        if (!live) return;
        host.appendChild(app.canvas);
        const scene = await createTableScene(app, forwarded);
        if (!live) {
          scene.destroy();
          return;
        }
        sceneRef.current = scene;
        const latest = latestRef.current;
        scene.update(latest.snapshot, latest.perspective, latest.ginKeys);
      });
    return () => {
      live = false;
      const scene = sceneRef.current;
      sceneRef.current = null;
      void ready.then(() => {
        scene?.destroy();
        app.destroy(true, { children: true });
      });
    };
  }, []);

  // touchAction none, or a drag across the table scrolls the page under it.
  return (
    <div
      ref={hostRef}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    />
  );
}
