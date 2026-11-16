// Oleo's mascots. Each one is a picture (its skin) and a sheet of where things
// are on it: the ground it stands on, its leaves, its face. The engine
// (../engine.ts) keeps the moods, the moves and the reactions; it draws the
// skin through this module and the face on top of it, so a mascot changes
// expression without a picture per expression.
//
// A skin is prepared once, when the module loads: the background is taken
// out, the face painted in the picture is covered with the plush round it (the
// engine draws its own), and what moves on its own (the leaves) is cut apart
// from the body. Smaller copies are kept so a small bot is not drawn from a
// large picture every frame.

import duraznoUrl from "./durazno.png";

export type MascotId = "durazno";

/** An eye on the picture: its centre and its half-width and half-height. */
export interface EyeSpot { x: number; y: number; rx: number; ry: number }

export interface MascotDef {
  id: MascotId;
  label: string;
  image: string;
  /** Every measure below is in pixels of the picture, which is `size` square. */
  size: number;
  /** The line the feet stand on, and the middle of the body across. */
  ground: number;
  centerX: number;
  /** The top of the head, leaves left out. */
  top: number;
  /** The figure's sides, arms included. */
  left: number;
  right: number;
  /** Above `cut` it is the leaves; they turn round `pivot`. */
  leaves: { cut: number; pivotX: number; pivotY: number };
  /** The face painted on the picture, and how far below it the plush that covers it is taken from. */
  faceErase: { x: number; y: number; rx: number; ry: number; from: number };
  eyes: readonly [EyeSpot, EyeSpot];
  mouth: { x: number; y: number };
  cheeks: readonly [{ x: number; y: number; r: number }, { x: number; y: number; r: number }];
  /** The colour of the lines of the face, of the mouth, of the blush. */
  ink: string;
  mouthInk: string;
  cheek: string;
  /** The glass of the eyes: middle, lower edge, rim. */
  eyeGlass: readonly [string, string, string];
}

/** Durazno: a peach plush with two leaves, drawn by Franco Ruiz. */
const DURAZNO: MascotDef = {
  id: "durazno",
  label: "Durazno",
  image: duraznoUrl,
  size: 512,
  ground: 468,
  centerX: 262,
  top: 92,
  left: 100,
  right: 418,
  leaves: { cut: 104, pivotX: 262, pivotY: 100 },
  faceErase: { x: 285, y: 233, rx: 72, ry: 30, from: 62 },
  eyes: [{ x: 250, y: 226, rx: 10.5, ry: 11.5 }, { x: 331, y: 224, rx: 7.6, ry: 10.6 }],
  mouth: { x: 294, y: 239 },
  cheeks: [{ x: 228, y: 246, r: 26 }, { x: 346, y: 246, r: 21 }],
  ink: "#2A1712",
  mouthInk: "#7A4232",
  cheek: "#F0876C",
  eyeGlass: ["#5E2C22", "#2A1411", "#140907"],
};

export const MASCOTS: Record<MascotId, MascotDef> = { durazno: DURAZNO };
export const DEFAULT_MASCOT: MascotId = "durazno";
export const isMascot = (id: string): id is MascotId => id in MASCOTS;

/** A picture and its smaller copies, halved down to `MIN_LEVEL`. */
type Levels = HTMLCanvasElement[];
const MIN_LEVEL = 32;

export interface Skin {
  def: MascotDef;
  body: Levels;
  leaves: Levels;
  /** The body dyed in a colour, by its `rgb()` key. */
  dyed: Map<string, Levels>;
}

function canvas(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const ctx = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: false })!;

/** Out with the light background and its grey shadow; the saturated plush and the dark eyes stay. */
function cutOut(img: HTMLImageElement, def: MascotDef): HTMLCanvasElement {
  const n = def.size;
  const c = canvas(n);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, n, n);
  const data = x.getImageData(0, 0, n, n);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const mx = Math.max(p[i], p[i + 1], p[i + 2]);
    const sat = mx - Math.min(p[i], p[i + 1], p[i + 2]);
    let a = Math.min(1, Math.max(0, (sat - 14) / 30));
    if (mx > 190 && sat < 40) a = 0;
    if (mx < 120) a = 1;
    // Under the feet, the shadow greys the edge of the plush: only clearly coloured pixels stay.
    if ((i >> 2) / n > def.ground - 30) a *= Math.min(1, Math.max(0, (sat - 60) / 30));
    if (a > 0 && a < 1) {
      // Take the white the edge was blended with back out of its colour.
      for (let k = 0; k < 3; k++) p[i + k] = Math.min(255, Math.max(0, (p[i + k] - (1 - a) * 245) / a));
    }
    p[i + 3] = Math.round(a * 255);
  }
  x.putImageData(data, 0, 0);
  return c;
}

/** The painted face, covered with the plush just under it, through a soft-edged mask. */
function eraseFace(src: HTMLCanvasElement, def: MascotDef): HTMLCanvasElement {
  const n = def.size;
  const f = def.faceErase;
  const c = canvas(n);
  const x = ctx(c);
  x.drawImage(src, 0, 0);
  const patch = canvas(n);
  const px = ctx(patch);
  px.drawImage(src, 0, -f.from);
  // The plush lower down is in a little less light.
  px.globalCompositeOperation = "source-atop";
  px.fillStyle = "rgba(255,225,205,0.06)";
  px.fillRect(0, 0, n, n);
  const mask = canvas(n);
  const mx = ctx(mask);
  const g = mx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, "#000");
  g.addColorStop(0.7, "#000");
  g.addColorStop(1, "rgba(0,0,0,0)");
  mx.translate(f.x, f.y);
  mx.scale(f.rx * 1.25, f.ry * 1.25);
  mx.fillStyle = g;
  mx.beginPath();
  mx.arc(0, 0, 1, 0, Math.PI * 2);
  mx.fill();
  mx.setTransform(1, 0, 0, 1, 0, 0);
  mx.globalCompositeOperation = "source-in";
  mx.drawImage(patch, 0, 0);
  x.drawImage(mask, 0, 0);
  return c;
}

/** The leaves above the cut, the body below it, each fading out over a few pixels where they meet. */
function split(src: HTMLCanvasElement, def: MascotDef): { body: HTMLCanvasElement; leaves: HTMLCanvasElement } {
  const n = def.size;
  const cut = def.leaves.cut;
  const leaves = canvas(n);
  const lx = ctx(leaves);
  lx.drawImage(src, 0, 0);
  lx.globalCompositeOperation = "destination-in";
  const gl = lx.createLinearGradient(0, cut - 6, 0, cut + 6);
  gl.addColorStop(0, "#000");
  gl.addColorStop(1, "rgba(0,0,0,0)");
  lx.fillStyle = gl;
  lx.fillRect(0, 0, n, n);
  const body = canvas(n);
  const bx = ctx(body);
  bx.drawImage(src, 0, 0);
  bx.globalCompositeOperation = "destination-out";
  const gb = bx.createLinearGradient(0, cut - 10, 0, cut + 2);
  gb.addColorStop(0, "#000");
  gb.addColorStop(1, "rgba(0,0,0,0)");
  bx.fillStyle = gb;
  bx.fillRect(0, 0, n, cut + 2);
  return { body, leaves };
}

function levels(c: HTMLCanvasElement): Levels {
  const out = [c];
  let last = c;
  while (last.width / 2 >= MIN_LEVEL) {
    const half = canvas(last.width / 2);
    const x = ctx(half);
    x.imageSmoothingQuality = "high";
    x.drawImage(last, 0, 0, half.width, half.height);
    out.push(half);
    last = half;
  }
  return out;
}

/** The copy to draw for a picture that ends up `px` device pixels wide: the smallest one at least as large. */
export function level(ls: Levels, px: number): HTMLCanvasElement {
  for (let i = ls.length - 1; i >= 0; i--) if (ls[i].width >= px) return ls[i];
  return ls[0];
}

/** The body dyed in `rgb` (0…1 each): its light and its fur kept, its colour changed. */
export function dyed(skin: Skin, rgb: readonly [number, number, number]): Levels {
  const key = rgb.map((v) => Math.round(v * 255)).join(",");
  let ls = skin.dyed.get(key);
  if (!ls) {
    const src = skin.body[0];
    const c = canvas(src.width);
    const x = ctx(c);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = "color";
    x.fillStyle = `rgba(${key},0.85)`;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(src, 0, 0);
    ls = levels(c);
    if (skin.dyed.size > 24) skin.dyed.clear();
    skin.dyed.set(key, ls);
  }
  return ls;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

async function prepare(def: MascotDef): Promise<Skin | null> {
  try {
    const img = await load(def.image);
    const { body, leaves } = split(eraseFace(cutOut(img, def), def), def);
    return { def, body: levels(body), leaves: levels(leaves), dyed: new Map() };
  } catch {
    return null;
  }
}

/**
 * Every mascot's skin, ready before anything is drawn. A skin that could not be
 * prepared is null: the engine then draws a plain silhouette in its place.
 */
export const SKINS: Record<MascotId, Skin | null> = Object.fromEntries(
  await Promise.all((Object.keys(MASCOTS) as MascotId[]).map(async (id) => [id, await prepare(MASCOTS[id])])),
) as Record<MascotId, Skin | null>;
