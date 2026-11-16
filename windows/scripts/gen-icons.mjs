// Writes the PNG/ICO set Tauri needs, drawn by the app's own engine: the
// mascot at rest, as dev/icon-export.html renders it. That page is opened in a
// locally installed Chrome or Edge, headless, over DevTools. No dependency, no
// network beyond the local dev server.
//
//   npx vite --host 127.0.0.1 --port 1420 --strictPort    (in another terminal)
//   node scripts/gen-icons.mjs
//
// Then run make-installer-art.mjs, which draws the installer from the new icon.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const PAGE = process.env.OLEO_ICON_PAGE ?? "http://127.0.0.1:1420/dev/icon-export.html";
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
if (typeof WebSocket !== "function") throw new Error("needs Node 22 or newer (WebSocket)");

const candidates = [
  process.env.CHROME_PATH,
  ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => {
    const root = process.env[v];
    return root ? [join(root, "Google/Chrome/Application/chrome.exe"), join(root, "Microsoft/Edge/Application/msedge.exe")] : [];
  }),
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
];
const browser = candidates.find((p) => p && existsSync(p));
if (!browser) throw new Error("no Chrome or Edge found; set CHROME_PATH");

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── The page, in a headless browser ───────────────────────────────────────

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = mkdtempSync(join(tmpdir(), "oleo-icons-"));
const child = spawn(browser, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
], { stdio: "ignore" });
try {
  let port = null;
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null; } catch { /* not yet */ }
  }
  if (!port) throw new Error("the browser did not start");
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("DevTools connection failed")); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && waiting.has(m.id)) {
      const [ok, no] = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? no(new Error(m.error.message)) : ok(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((ok, no) => { waiting.set(++id, [ok, no]); ws.send(JSON.stringify({ id, method, params })); });

  await send("Page.navigate", { url: PAGE });
  // The page is ready once its module has set window.renderIcons (the mascot's picture is prepared first).
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(100);
    const r = await send("Runtime.evaluate", { expression: "typeof window.renderIcons === 'function'", returnByValue: true });
    ready = r.result.value === true;
  }
  if (!ready) throw new Error(`${PAGE} did not load; is the dev server running?`);

  const sizes = [...new Set([32, 128, 256, 512, ...ICO_SIZES])];
  const r = await send("Runtime.evaluate", { expression: `window.renderIcons(${JSON.stringify(sizes)})`, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "the drawing failed");
  const png = (size) => Buffer.from(r.result.value[size], "base64");
  ws.close();

  mkdirSync(OUT, { recursive: true });
  const files = { "32x32.png": png(32), "128x128.png": png(128), "128x128@2x.png": png(256), "icon.png": png(512) };
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(OUT, name), data);
    console.log(`${name} — ${data.length} bytes`);
  }
  const ico = encodeICO(ICO_SIZES.map((size) => ({ size, png: png(size) })));
  writeFileSync(join(OUT, "icon.ico"), ico);
  console.log(`icon.ico — ${ico.length} bytes`);
} finally {
  child.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
