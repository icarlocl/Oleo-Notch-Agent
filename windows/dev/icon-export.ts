// The app icons, drawn by the real BotEngine: the mascot at rest, undyed, its
// figure (leaves included) filling the square. scripts/gen-icons.mjs opens this
// page in a headless browser and calls window.renderIcons(sizes).

import { BOT_R, BotEngine, setBotClock } from "../src/bot/engine";

/** Room left round the figure, as a share of the icon. */
const MARGIN = 0.04;

// A still clock: no blink, no fidget caught halfway.
setBotClock(() => 1000);

function figure(R: number): HTMLCanvasElement {
  const W = Math.ceil(R / BOT_R);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = W;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const engine = new BotEngine();
  engine.setState("idle", true);
  engine.update(0);
  engine.lookX = 0;
  engine.lookY = 0;
  engine.draw(x, W, W);
  return c;
}

/** The box round the figure: what is mostly opaque, so not its shadow on the ground. */
function bounds(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 100) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function icon(size: number): HTMLCanvasElement {
  // How big the figure is for a given R, measured once large, then drawn at
  // the R that fits: the engine keeps its own small-size detail.
  const probe = bounds(figure(200));
  const fit = (size * (1 - 2 * MARGIN)) / Math.max(probe.w, probe.h);
  const art = figure(200 * fit);
  const b = bounds(art);
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  const s = Math.min(1, (size * (1 - 2 * MARGIN)) / Math.max(b.w, b.h));
  const w = b.w * s;
  const h = b.h * s;
  g.drawImage(art, b.x0, b.y0, b.w, b.h, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

declare global {
  interface Window {
    renderIcons(sizes: number[]): Record<number, string>;
  }
}

window.renderIcons = (sizes) => {
  const out: Record<number, string> = {};
  for (const size of sizes) out[size] = icon(size).toDataURL("image/png").split(",")[1];
  return out;
};

const shown = document.getElementById("out")!;
for (const size of [16, 24, 32, 48, 64, 128, 256]) shown.append(icon(size));
