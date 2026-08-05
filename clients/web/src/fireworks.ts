import { Container, Graphics, Sprite } from "pixi.js";
import type { Application, Texture } from "pixi.js";

// A particle burst for a won hand. This is pure decoration, so unlike the
// engine it may use Math.random freely (as relayTransport's seed already
// does) - nothing here is replayed, compared between clients, or persisted.
//
// The particles ride the scene's existing ticker rather than adding a second
// one, so the whole table still animates off a single frame callback.

const GRAVITY = 0.00042; // px per ms^2
const DRAG = 0.0016; // velocity lost per ms
const FADE_MS = 1100; // how long a particle takes to vanish once it starts fading
const SHELL_PARTICLES = 46;
const SHELLS = 5;
const SHELL_GAP_MS = 260;
const POOL = SHELLS * SHELL_PARTICLES;

// Warm, high-contrast against the green baize.
const COLORS = [0xffd54a, 0xff8a5c, 0xff5c8a, 0x7fd1ff, 0xa4f07a, 0xffffff];

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number; // ms remaining before it is fully gone
  alive: boolean;
}

export interface Fireworks {
  // Launch a volley. Calling it again while one is running just adds to it.
  burst(width: number, height: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createFireworks(
  app: Application,
  parent: Container,
  zIndex: number
): Fireworks {
  const layer = new Container();
  layer.zIndex = zIndex;
  layer.eventMode = "none"; // never steal a tap from the cards underneath
  parent.addChild(layer);

  const dot = dotTexture(app);
  const particles: Particle[] = [];
  for (let i = 0; i < POOL; i++) {
    const sprite = new Sprite(dot);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    layer.addChild(sprite);
    particles.push({ sprite, vx: 0, vy: 0, life: 0, alive: false });
  }

  // Shells queued but not yet launched, so a volley staggers over time
  // instead of arriving as one wall of dots.
  let pending: { delay: number; x: number; y: number }[] = [];

  const launch = (x: number, y: number) => {
    let spawned = 0;
    const hue = COLORS[(Math.random() * COLORS.length) | 0];
    const speed = 0.3 + Math.random() * 0.18;
    for (const particle of particles) {
      if (spawned >= SHELL_PARTICLES) break;
      if (particle.alive) continue;
      // Even angular spread with jitter, so the shell reads as a ring
      // rather than a random cloud.
      const angle =
        (spawned / SHELL_PARTICLES) * Math.PI * 2 + Math.random() * 0.2;
      const magnitude = speed * (0.55 + Math.random() * 0.45);
      particle.vx = Math.cos(angle) * magnitude;
      particle.vy = Math.sin(angle) * magnitude;
      particle.life = FADE_MS * (0.7 + Math.random() * 0.6);
      particle.alive = true;
      particle.sprite.position.set(x, y);
      particle.sprite.tint = hue;
      particle.sprite.alpha = 1;
      particle.sprite.scale.set(0.5 + Math.random() * 0.6);
      particle.sprite.visible = true;
      spawned++;
    }
  };

  return {
    burst(width, height) {
      for (let shell = 0; shell < SHELLS; shell++) {
        pending.push({
          delay: shell * SHELL_GAP_MS,
          // Spread across the width, in the upper half where nothing is held.
          x: width * (0.15 + Math.random() * 0.7),
          y: height * (0.12 + Math.random() * 0.3)
        });
      }
    },
    update(dtMs) {
      if (pending.length > 0) {
        for (const shell of pending) shell.delay -= dtMs;
        for (const shell of pending) {
          if (shell.delay <= 0) launch(shell.x, shell.y);
        }
        pending = pending.filter((shell) => shell.delay > 0);
      }
      for (const particle of particles) {
        if (!particle.alive) continue;
        particle.vy += GRAVITY * dtMs;
        const slowed = Math.max(0, 1 - DRAG * dtMs);
        particle.vx *= slowed;
        particle.vy *= slowed;
        particle.sprite.x += particle.vx * dtMs;
        particle.sprite.y += particle.vy * dtMs;
        particle.life -= dtMs;
        particle.sprite.alpha = Math.max(
          0,
          Math.min(1, particle.life / FADE_MS)
        );
        if (particle.life <= 0) {
          particle.alive = false;
          particle.sprite.visible = false;
        }
      }
    },
    destroy() {
      pending = [];
      layer.destroy({ children: true });
      dot.destroy(true);
    }
  };
}

// One soft dot, generated once and tinted per particle - cheaper than a
// Graphics redraw per frame, and the Knoll card set ships nothing usable.
function dotTexture(app: Application): Texture {
  const g = new Graphics().circle(12, 12, 6).fill({ color: 0xffffff });
  return app.renderer.generateTexture(g);
}
