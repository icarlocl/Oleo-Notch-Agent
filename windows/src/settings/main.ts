// The settings window: a sidebar of categories in small groups — Connect; the
// Island, Look and colours, Sounds; the Agents list, Shortcuts, Shelf widgets;
// About — a search above them, and one category on show at a time.
//
// Every category is built once, when the window opens, and kept: another
// category shows one and hides the rest, and a search moves the rows that
// match — the very elements, their controls working — into a list of results,
// then back where they were when it is cleared. Nothing is built twice, so no
// control and no id exists twice either.
//
// Every setting applies at once. Only what writes to Claude Code's
// settings.json (or its CLAUDE.md, or Cursor's hooks.json) asks first: Oleo
// shows the diff, and nothing is written until the button under it is pressed
// — with the fingerprint of the diff on show, so a file that changed in
// between is refused by Rust rather than written over.

import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, locale, setLanguage, systemLang, t, type LanguageSetting } from "../core/i18n";
import "./settings.css";
import type { AboutLink, CodexStatus, CursorStatus, DataPaths, HookPreview, HookStatus, ReplyFormatAction, ReplyFormatStatus, ShortcutName, ShortcutStatus, UpdateInfo, UsageStatus } from "../core/bridge";
import { COMPACT_METRICS, DEFAULT_SETTINGS, FADE_MAX, FADE_MIN, FOLDED_AUTO_HIDE, MAX_COMPACT_METRICS, compactMetrics, finishedNotice, foldedAutoHide, type CompactMetric, type FinishedNotice, type SessionAgent, type Settings } from "../core/state";
import { DEFAULT_MASCOT, MASCOTS, isMascot, type MascotId } from "../bot/mascots";
import { clear, h, replay } from "../views/dom";
import { BRANDS, CLAUDE_MARK, CODEX_MARK, LUCIDE, brand } from "../views/iconset";
import { TOOL_NAME } from "../views/tool";
import { connect, type Backend } from "./backend";
import { mountBot, refreshBots, startBots, wearMascot } from "./bots";
import { COMPACT_BOT, COMPACT_CELLS, cellIcon, islandPreview } from "./island-preview";
import { SPRING, flip, icon, reorderable, segmented, slider, toggle, type Toggle } from "./ui";
import { weatherPicker } from "./weather";

// ── What the window knows ─────────────────────────────────────────────────────

const SECTIONS = ["connect", "island", "look", "sounds", "agents", "shortcuts", "shelf", "about"] as const;
type Section = (typeof SECTIONS)[number];
/** What the categories were called before they were regrouped: an old link still lands. */
const OLD_SECTIONS: Record<string, Section> = { claude: "connect", general: "island", appearance: "look" };
const sectionNamed = (name: string | null | undefined): Section | null =>
  !name ? null : (SECTIONS as readonly string[]).includes(name) ? (name as Section) : OLD_SECTIONS[name] ?? null;

type Theme = Settings["theme"];
type Motion = Settings["reduceMotion"];

let oleo: Backend;
let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";
let hooks: HookStatus | null = null;
let usage: UsageStatus | null = null;
let reply: ReplyFormatStatus | null = null;
let cursor: CursorStatus | null = null;
let codex: CodexStatus | null = null;
/** The last write of the reply format created CLAUDE.md: there was no previous file to save. */
let wasCreated = false;
let paths: DataPaths | null = null;
let shortcutsNow: Record<ShortcutName, ShortcutStatus> | null = null;
let section: Section = "connect";

const page = document.documentElement;
const root = document.getElementById("settings-root")!;

/** What Rust, or the bridge, refused with — as a sentence, without the "Error:" a thrown one carries. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, "");

/** Each category: its name, its mark, the group of the sidebar it stands in, and what it is for, in a sentence. */
const INFO: Record<Section, { name: string; icon: string; group: string; lede: string }> = {
  connect: {
    name: t("s.info.connect"), icon: LUCIDE.plug, group: t("s.info.config"),
    lede: t("s.info.connectLede"),
  },
  island: {
    name: t("s.info.island"), icon: LUCIDE.panelTop, group: t("s.info.theIsland"),
    lede: t("s.info.islandLede"),
  },
  look: {
    name: t("s.info.look"), icon: LUCIDE.palette, group: t("s.info.theIsland"),
    lede: t("s.info.lookLede"),
  },
  sounds: {
    name: t("s.info.sounds"), icon: LUCIDE.volume2, group: t("s.info.theIsland"),
    lede: t("s.info.soundsLede"),
  },
  agents: {
    name: t("s.info.agents"), icon: LUCIDE.list, group: "Extras",
    lede: t("s.info.agentsLede"),
  },
  shortcuts: {
    name: t("s.info.shortcuts"), icon: LUCIDE.keyboard, group: "Extras",
    lede: t("s.info.shortcutsLede"),
  },
  shelf: {
    name: "Widgets", icon: LUCIDE.layoutGrid, group: "Extras",
    lede: t("s.info.shelfLede"),
  },
  about: {
    name: t("s.info.about"), icon: LUCIDE.info, group: "",
    lede: t("s.info.aboutLede"),
  },
};

// ── Saving: at once, and in step with the island ──────────────────────────────

/** When each setting was last changed here: an echo of an older save does not undo it. */
const touched = new Map<string, number>();
const OWN_FOR_MS = 500;
let saveTimer = 0;

function save() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  void oleo.saveSettings(settings);
}

/**
 * A setting changed in this window: kept, and written — at once, or a moment
 * after the last of a run of changes (`soon`: a slider being dragged).
 */
function change(patch: Partial<Settings>, soon = false) {
  settings = { ...settings, ...patch };
  const now = performance.now();
  for (const key of Object.keys(patch)) touched.set(key, now);
  applyAppearance();
  paintResets();
  if (!soon) return save();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 140);
}

/**
 * What every category does when the settings change under it. Every category
 * is built once and kept, so these are kept too: one shown later is already
 * up to date, and a row moved into the search results goes on following.
 */
const followers: (() => void)[] = [];
const follow = () => {
  for (const f of followers) f();
};

/**
 * `settings-changed`: Rust has saved — this window's own change coming back,
 * or one made in the island's quick settings. What was changed here a moment
 * ago is not taken back from an older echo.
 */
function settingsChanged(next: Settings) {
  const now = performance.now();
  const mine: Record<string, unknown> = {};
  for (const [key, at] of touched) {
    if (now - at < OWN_FOR_MS) mine[key] = (settings as unknown as Record<string, unknown>)[key];
    else touched.delete(key);
  }
  settings = { ...settings, ...next, ...(mine as Partial<Settings>) };
  // Another language: every word of this window was written when it opened, so it opens again, on the same page.
  if (setLanguage(settings.language)) return reopen();
  applyAppearance();
  follow();
  paintResets();
}

// ── Theme and motion ──────────────────────────────────────────────────────────

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const systemStill = window.matchMedia("(prefers-reduced-motion: reduce)");
const resolvedTheme = (): "light" | "dark" => (settings.theme === "system" ? (systemDark.matches ? "dark" : "light") : settings.theme);
/** Nothing travels or fades. */
const still = (): boolean => (settings.reduceMotion === "system" ? systemStill.matches : settings.reduceMotion === "on");

/** The window in the theme, the motion and the bot colours the settings say. */
function applyAppearance() {
  page.dataset.theme = resolvedTheme();
  page.dataset.motion = still() ? "reduce" : "full";
  wearMascot(settings.botMascot);
}

page.style.setProperty("--spring", SPRING.easing);
page.style.setProperty("--spring-ms", `${SPRING.ms}ms`);
applyAppearance();

// ── The bot: three of him, made once ──────────────────────────────────────────

const sideBot = mountBot(20);
const islandBot = mountBot(COMPACT_BOT);
const aboutBot = mountBot(46);
sideBot.setState("idle");
islandBot.setState("approval");
aboutBot.setState("idle");

// ── The window ────────────────────────────────────────────────────────────────

type Kid = Node | string | null | undefined | false;

/** A category's mark: its icon on a tile of its own colour (settings.css `[data-hue]`). */
const tile = (id: Section, size: number, extra = "") =>
  h("span", { class: `sp-tile ${extra}`, "data-hue": id, "aria-hidden": "true" }, icon(INFO[id].icon, size, 2));

const app = h("div", { class: "sp-app" });
const nav = h("div", { class: "sp-nav", role: "tablist", "aria-orientation": "vertical", "aria-label": t("s.nav.aria") });
const tabs = new Map<Section, HTMLButtonElement>();
{
  let lastGroup: string | null = null;
  for (const id of SECTIONS) {
    const { name, group: label } = INFO[id];
    if (label !== lastGroup) {
      // Out of the accessibility tree: a tablist holds tabs, and each tab's name says enough.
      nav.append(h("div", { class: label ? "sp-nav-group" : "sp-nav-gap", "aria-hidden": "true", text: label || undefined }));
      lastGroup = label;
    }
    const tab = h("button", {
      class: "sp-tab", type: "button", role: "tab", id: `tab-${id}`, "aria-controls": `pane-${id}`, "data-hue": id,
      // The name stays on the tab when the sidebar folds to its icons.
      "aria-label": name, title: name,
    }, tile(id, 15), h("span", { class: "sp-tab-name", text: name }));
    tab.addEventListener("click", () => setSection(id));
    tabs.set(id, tab);
    nav.append(tab);
  }
}

// One stop in the tab order: Up, Down, Home and End move between the categories.
nav.addEventListener("keydown", (e) => {
  const at = SECTIONS.indexOf(section);
  const to =
    e.key === "ArrowDown" ? (at + 1) % SECTIONS.length
    : e.key === "ArrowUp" ? (at - 1 + SECTIONS.length) % SECTIONS.length
    : e.key === "Home" ? 0
    : e.key === "End" ? SECTIONS.length - 1
    : -1;
  if (to < 0) return;
  e.preventDefault();
  setSection(SECTIONS[to]);
  tabs.get(SECTIONS[to])!.focus();
});

const main = h("main", { class: "sp-main" });
/** Says what a move or a refusal did, to a screen reader. */
const live = h("div", { class: "sp-sr", role: "status", "aria-live": "polite" });
const say = (text: string) => (live.textContent = text);
const versionLine = h("span");

// ── Small pieces every category uses ──────────────────────────────────────────

/** A category's title: its mark, its name, and what it is for. */
const heads = new Map<Section, HTMLElement>();
function head(id: Section): HTMLElement {
  const el = h("header", { class: "sp-head" },
    tile(id, 20, "big"),
    h("div", { class: "sp-head-text" },
      h("h1", { class: "sp-title", text: INFO[id].name }),
      h("p", { class: "sp-lede", text: INFO[id].lede })));
  heads.set(id, el);
  return el;
}

/** Settings that belong together: a small heading, and a card the rows sit on. */
const group = (label: string | null, ...kids: Kid[]) =>
  h("section", { class: "sp-group" }, label ? h("h2", { class: "sp-group-label", text: label }) : null, h("div", { class: "sp-box" }, ...kids));

/** The same, for what brings its own card or tray. */
const bare = (label: string | Node | null, ...kids: Kid[]) =>
  h("section", { class: "sp-group" }, label ? h("h2", { class: "sp-group-label" }, label) : null, ...kids);

const rowText = (label: string, help: string | null, ...more: Kid[]) =>
  h("div", { class: "sp-row-text" },
    h("div", { class: "sp-row-label", text: label }),
    help ? h("p", { class: "sp-help", text: help }) : null,
    ...more);

/** A setting: its name and help on the left, its control on the right. A search finds it by any of those words, or `keys`. */
const row = (label: string, help: string | null, control: Kid, keys = "", ...more: Kid[]) =>
  findable(h("div", { class: "sp-row" }, rowText(label, help, ...more), control), label, help, keys);

/** The same, with a control too wide to sit beside its name: it goes under it. */
const stackRow = (label: string, help: string | null, keys: string, ...controls: Kid[]) =>
  findable(h("div", { class: "sp-row stack" }, rowText(label, help), ...controls), label, help, keys);

/** Why a control is greyed out — another setting is off — said under its name, and only then. */
const needs = () => h("p", { class: "sp-needs", hidden: true });
const sayNeeds = (el: HTMLElement, why: string | null) => {
  el.hidden = why == null;
  el.textContent = why ?? "";
};

/** A path, free to wrap after any of its separators and nowhere else. */
const breakable = (path: string): Kid[] =>
  path.split(/(?<=[\\/])/).flatMap((part, i) => (i ? [h("wbr"), part] : [part]));

const button = (text: string, kind: string, onClick: () => void) =>
  h("button", { class: `sp-btn ${kind}`, type: "button", text, onclick: onClick });

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Every row a search can find: the element itself, and its words — name, help,
 * the words somebody might type for it instead (`keys`), and its category's
 * name. A "block" (a card of its own: a Connect panel, the Shelf's tray) is
 * shown on its own in the results; rows of one category share a card there.
 */
interface Entry {
  section: Section;
  el: HTMLElement;
  words: string;
  block: boolean;
  /** Where it stands in its category while it is in the results. */
  home?: Comment;
}
const index: Entry[] = [];
/** The category being built: what `findable` files a row under. */
let building: Section = "connect";

/** Lower case, without accents or quotes: "Colour" and "colour", "café" and "cafe" are one. */
const plain = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[“”"'‘’]/g, "");

function findable<T extends HTMLElement>(el: T, label: string, help: string | null, keys = "", block = false): T {
  index.push({ section: building, el, block, words: plain(`${label} ${help ?? ""} ${keys} ${INFO[building].name}`) });
  return el;
}

const searchInput = h("input", {
  class: "sp-search-input", type: "search", id: "sp-search", placeholder: t("s.search.ph"),
  autocomplete: "off", spellcheck: "false", "aria-controls": "sp-results",
});
const searchClear = h("button", { class: "sp-search-clear", type: "button", "aria-label": t("s.search.clear"), title: t("s.search.clearTip"), hidden: true },
  icon(LUCIDE.x, 14, 2.2));
const searchBox = h("div", { class: "sp-search", role: "search" },
  h("label", { class: "sp-sr", for: "sp-search", text: t("s.search.ph") }),
  icon(LUCIDE.search, 15, 2.1),
  searchInput, searchClear,
  h("kbd", { class: "sp-search-key", "aria-hidden": "true", text: "/" }));
/** In a narrow window the field folds to this; pressed, the field comes out over the window's top. */
const searchOpen = h("button", { class: "sp-search-open", type: "button", "aria-label": t("s.search.ph"), title: t("s.search.openTip") },
  icon(LUCIDE.search, 17, 2));

const resultsTitle = h("h1", { class: "sp-title", id: "sp-results-title", text: t("s.search.title") });
const resultsCount = h("p", { class: "sp-lede", role: "status", "aria-live": "polite" });
const resultsList = h("div", { class: "sp-results-list" });
const results = h("div", { class: "sp-pane sp-results", id: "sp-results", role: "region", "aria-labelledby": "sp-results-title", hidden: true },
  h("header", { class: "sp-head" },
    h("span", { class: "sp-tile big", "data-hue": "search", "aria-hidden": "true" }, icon(LUCIDE.search, 20, 2)),
    h("div", { class: "sp-head-text" }, resultsTitle, resultsCount)),
  resultsList);

let query = "";

/** Every row that is in the results goes back where it stands in its category. */
function putBack() {
  let leftConnect = false;
  for (const e of index) {
    if (!e.home) continue;
    if (e.section === "connect") leftConnect = true;
    e.home.replaceWith(e.el);
    e.home = undefined;
  }
  clear(resultsList);
  // A diff opened among the results does not wait in the hidden Connect page: it is
  // dropped (never applied), so the next visit reads the files again. One being
  // written (`busy`) is left to finish and say how it went.
  if (leftConnect) {
    let dropped = false;
    for (const kind of CHANGES) {
      const flow = flows[kind];
      if (flow.at === "confirm" && !flow.busy) {
        flows[kind] = { at: "status" };
        dropped = true;
      }
    }
    if (dropped) paintClaude();
  }
}

/** The tabs while a search is on show: no category is selected, so none is announced or lit. */
function paintTabs() {
  for (const [id, tab] of tabs) {
    const on = id === section && query === "";
    tab.setAttribute("aria-selected", String(on));
    // Still one stop in the tab order while searching: the category that was on show.
    tab.tabIndex = id === section ? 0 : -1;
    if (on) tab.setAttribute("aria-controls", `pane-${id}`);
    else tab.removeAttribute("aria-controls");
  }
}

/** Shows what matches `text` — every word of it, anywhere in a row's words — or, with nothing typed, the category again. */
function runSearch(text: string) {
  putBack();
  query = text.trim();
  searchClear.hidden = !text;
  app.classList.toggle("searching", query !== "");
  paintTabs();
  const pane = panes.get(section);
  if (!query) {
    results.hidden = true;
    if (pane) pane.hidden = false;
    // Cleared from elsewhere (a result's category opened): a narrow window's field folds away again.
    if (document.activeElement !== searchInput) app.classList.remove("search-open");
    return;
  }
  if (pane) pane.hidden = true;
  results.hidden = false;
  results.scrollTop = 0;

  const words = plain(query).split(/\s+/).filter(Boolean);
  const hits = index.filter((e) => words.every((w) => e.words.includes(w)));
  resultsTitle.textContent = `“${query}”`;
  resultsCount.textContent = hits.length === 0 ? t("s.search.none") : t("s.search.found", { count: hits.length });
  if (!hits.length) {
    resultsList.append(h("div", { class: "sp-empty" },
      icon(LUCIDE.search, 26, 1.8),
      h("p", { class: "sp-empty-title", text: t("s.search.noMatch", { query }) }),
      h("p", { class: "sp-help", text: t("s.search.example") })));
    return;
  }
  for (const id of SECTIONS) {
    const mine = hits.filter((e) => e.section === id);
    if (!mine.length) continue;
    const crumb = h("button", { class: "sp-crumb", type: "button", title: t("s.search.open", { name: INFO[id].name }), "aria-label": t("s.search.in", { name: INFO[id].name }) },
      tile(id, 12), h("span", { text: INFO[id].name }), icon(LUCIDE.arrowRight, 13, 2.2));
    crumb.addEventListener("click", () => goTo(id, mine[0].el));
    const hit = h("section", { class: "sp-hit", "aria-label": INFO[id].name }, crumb);
    let box: HTMLElement | null = null;
    for (const e of mine) {
      e.home = document.createComment("");
      e.el.replaceWith(e.home);
      if (e.block) {
        hit.append(e.el);
        box = null;
      } else {
        if (!box) hit.append((box = h("div", { class: "sp-box" })));
        box.append(e.el);
      }
    }
    resultsList.append(hit);
  }
}

function clearSearch() {
  if (!searchInput.value && !query) return;
  searchInput.value = "";
  runSearch("");
}

/** A category, opened at one of its rows: it is brought into view and lit for a moment. */
function goTo(id: Section, el?: HTMLElement) {
  clearSearch();
  setSection(id);
  // The chip that was clicked is gone: focus goes to the row's first control, or to the page's heading.
  const target = el?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")
    ?? heads.get(id)?.querySelector<HTMLElement>("h1");
  window.requestAnimationFrame(() => {
    if (el) {
      el.scrollIntoView({ block: "center", behavior: still() ? "auto" : "smooth" });
      replay(el, "sp-lit");
    }
    if (target) {
      if (!target.matches("button, input, select, textarea, [tabindex]")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  });
}

searchInput.addEventListener("input", () => runSearch(searchInput.value));
searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  if (searchInput.value) clearSearch();
  else searchInput.blur();
});
searchInput.addEventListener("blur", () => {
  if (!searchInput.value) app.classList.remove("search-open");
});
searchClear.addEventListener("click", () => {
  clearSearch();
  searchInput.focus();
});
function focusSearch() {
  app.classList.add("search-open");
  searchInput.focus();
  searchInput.select();
}
searchOpen.addEventListener("click", focusSearch);

// "/" or Ctrl+F, from anywhere but a field being typed in — or a shortcut being
// recorded, which keeps its keys to itself.
document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]");
  const slash = e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey && !typing;
  const find = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f";
  if (e.defaultPrevented || !(slash || find)) return;
  e.preventDefault();
  focusSearch();
});

// ── Reset, a category at a time ───────────────────────────────────────────────

/** The settings each category puts back. Never the connections: those are only ever changed through their diff. */
const RESET_FIELDS: Partial<Record<Section, readonly (keyof Settings)[]>> = {
  island: ["screen", "dock", "foldedStyle", "threadColor", "autostart", "autoCloseInterval", "foldedAutoHide", "hideOnlyWhenIdle", "hideInFullscreen", "finishedNotice", "compactMetrics", "weatherLocation"],
  look: ["botMascot", "playfulReactions", "theme", "reduceMotion"],
  sounds: ["soundEnabled", "soundVolume"],
  agents: ["showAgentsList", "agentsListFade", "agentsListFadeOpacity"],
  shelf: ["shelfOrder", "shelfHidden"],
};
/** What the reset of each says it does. */
const RESET_WORDS: Partial<Record<Section, string>> = {
  island: t("s.reset.island"),
  look: t("s.reset.look"),
  sounds: t("s.reset.sounds"),
  agents: t("s.reset.agents"),
  shortcuts: t("s.reset.shortcuts"),
  shelf: t("s.reset.shelf"),
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function atDefaults(id: Section): boolean {
  if (id === "shortcuts") {
    return SHORTCUTS.every(({ which }) => {
      const [key, on] = SHORTCUT_FIELDS[which];
      return settings[key] === DEFAULT_SETTINGS[key] && settings[on] === DEFAULT_SETTINGS[on];
    });
  }
  return (RESET_FIELDS[id] ?? []).every((key) => same(settings[key], DEFAULT_SETTINGS[key]));
}

async function resetSection(id: Section) {
  if (id === "shortcuts") {
    // Rust registers a shortcut before it saves it, one at a time. One refused
    // because another still holds its keys gets them on the next round.
    for (let round = 0; round < 3 && !atDefaults("shortcuts"); round++) {
      for (const { which } of SHORTCUTS) await shortcutResets.get(which)?.();
    }
  } else {
    const patch: Record<string, unknown> = {};
    for (const key of RESET_FIELDS[id] ?? []) patch[key] = structuredClone(DEFAULT_SETTINGS[key]);
    // The normal way: kept, applied at once, saved — and the island told.
    change(patch as Partial<Settings>);
    autoCloseCustom = autoClosePreset() === "custom";
    follow();
  }
  paintResets();
}

const resetPainters: (() => void)[] = [];
const paintResets = () => {
  for (const paint of resetPainters) paint();
};
/** Arms a category's reset as a first click does (the made-up window's `reset=armed`). */
const resetArmers = new Map<Section, () => void>();

/**
 * t("s.reset.idle"), at the foot of a category: a quiet button that asks
 * twice. The first click arms it — its words change, and a screen reader is
 * told — and it disarms by itself after a few seconds; the second resets.
 */
function resetFoot(id: Section): HTMLElement {
  const IDLE = t("s.reset.idle");
  const words = h("span", { text: IDLE });
  const b = h("button", { class: "sp-reset", type: "button" }, icon(LUCIDE.rotateCcw, 14, 2.1), words);
  const note = h("p", { class: "sp-help", id: `reset-note-${id}` });
  b.setAttribute("aria-describedby", note.id);
  let armed = 0;
  let busy = false;
  const paint = () => {
    const done = atDefaults(id);
    // Never `disabled` (while resetting, or once it is as it came): that would strand the keyboard focus on a button that just reset.
    const spent = busy || (done && !armed);
    b.setAttribute("aria-disabled", String(spent));
    b.classList.toggle("spent", spent);
    b.classList.toggle("armed", armed !== 0);
    words.textContent = busy ? t("s.reset.busy") : armed ? t("s.reset.armed") : IDLE;
    note.textContent = done && !armed ? t("s.reset.atDefaults") : RESET_WORDS[id] ?? "";
  };
  const disarm = () => {
    window.clearTimeout(armed);
    armed = 0;
    paint();
  };
  const arm = () => {
    armed = window.setTimeout(disarm, 4000);
    paint();
    say(t("s.reset.again", { name: INFO[id].name }));
  };
  b.addEventListener("click", async () => {
    if (busy || (!armed && atDefaults(id))) return;
    if (!armed) return arm();
    window.clearTimeout(armed);
    armed = 0;
    busy = true;
    paint();
    await resetSection(id);
    busy = false;
    paint();
    say(t("s.reset.done", { name: INFO[id].name }));
  });
  b.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && armed) {
      e.preventDefault();
      disarm();
    }
  });
  resetPainters.push(paint);
  resetArmers.set(id, arm);
  paint();
  return h("div", { class: "sp-reset-foot" }, b, note);
}

// ── Connect: Claude Code and Cursor ───────────────────────────────────────────

/**
 * What Oleo writes for Claude Code: the hooks and the status line the usage
 * limits come through, in ~/.claude/settings.json; the reply format, in
 * ~/.claude/CLAUDE.md. One flow for the three: the diff, then an explicit click.
 */
type Change = "hooks" | "usage" | "reply" | "cursor" | "codex";
const CHANGES: readonly Change[] = ["hooks", "usage", "reply", "cursor", "codex"];
/** The file each one changes, as the panel names it. (Cursor's is ~/.cursor/hooks.json, Codex's ~/.codex/hooks.json: the same flow.) */
const CHANGED_FILE: Record<Change, string> = { hooks: "settings.json", usage: "settings.json", reply: "CLAUDE.md", cursor: "hooks.json", codex: "hooks.json" };

/** Where a part's install flow is at: its status, or the diff to confirm. */
type Flow =
  | { at: "status"; error?: string; done?: { install: boolean; backup: string }; note?: string }
  | { at: "confirm"; install: boolean; preview: HookPreview; error?: string; busy?: boolean; action?: ReplyFormatAction };

const flows: Record<Change, Flow> = { hooks: { at: "status" }, usage: { at: "status" }, reply: { at: "status" }, cursor: { at: "status" }, codex: { at: "status" } };
/** Whether each part's Details are open: kept across its repaints. */
const detailsOpen: Record<Change, boolean> = { hooks: false, usage: false, reply: false, cursor: false, codex: false };

/** Codex runs a new hook only once it is trusted: said after connecting, and in the details. */
const CODEX_TRUST = t("s.codex.trust");

/** What the preview panel says of each change, before and after it is written. */
const CHANGE_WORDS: Record<Change, { install: string; remove: string; done: string }> = {
  hooks: {
    install: t("s.cw.hooksInstall"),
    remove: t("s.cw.hooksRemove"),
    done: t("s.cw.hooksDone"),
  },
  usage: {
    install: t("s.cw.usageInstall"),
    remove: t("s.cw.usageRemove"),
    done: t("s.cw.usageDone"),
  },
  reply: {
    install: t("s.cw.replyInstall"),
    remove: t("s.cw.replyRemove"),
    done: t("s.cw.replyDone"),
  },
  cursor: {
    install: t("s.cw.cursorInstall"),
    remove: t("s.cw.ownRemove"),
    done: t("s.cw.cursorDone"),
  },
  codex: {
    install: t("s.cw.codexInstall"),
    remove: t("s.cw.ownRemove"),
    done: CODEX_TRUST,
  },
};

type Tone = "ok" | "off" | "warn" | "error";
const TONE_ICON: Record<Tone, string> = {
  ok: LUCIDE.circleCheck, off: LUCIDE.circleMinus, warn: LUCIDE.triangleAlert, error: LUCIDE.circleX,
};

interface Spec {
  name: string;
  tone: Tone;
  title: string;
  /** One plain sentence: always on show. */
  text: string;
  /** How it works, the files, what to know before saying yes: under Details, folded until asked for. */
  details?: string[];
  facts: [string, string][];
  /** The one filled button, if the state calls for one. `blocked`: why it cannot be pressed. */
  primary?: { label: string; act: "install" | "restart"; blocked?: string };
  /** Lines of the user's own file, shown as they are and never changed. */
  found?: string[];
  /** A quiet way to write the entries again. */
  again?: string;
  remove?: string;
}

const RELAY_MISSING = t("s.relayMissing");
const UNREACHABLE: Omit<Spec, "name"> = {
  tone: "off", title: t("s.unreachable"),
  text: t("s.unreachableText"),
  facts: [],
};

function hooksSpec(): Spec {
  const s = hooks;
  const name = t("s.hooks.name");
  if (!s) return { name, ...UNREACHABLE };
  const file: [string, string] = ["settings.json", s.settingsPath];
  const relay: [string, string] = [t("s.fact.relay"), s.hookPath];
  const relayName = s.hookPath.split(/[\\/]/).pop() || t("s.hooks.theRelay");
  const how = t("s.hooks.how");
  if (!s.hookReady) {
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook: installing is not on offer.
    return {
      name, tone: "error", title: t("s.st.restart"),
      text: s.installed
        ? t("s.hooks.missingOn")
        : t("s.hooks.missingOff"),
      details: [
        s.installed ? t("s.hooks.relayGone", { name: relayName }) : t("s.hooks.relayGoneWould", { name: relayName }),
        t("s.hooks.stillMissing"),
      ],
      facts: [file, relay],
      primary: { label: t("s.act.restart"), act: "restart" },
      remove: s.installed ? t("s.act.disconnect") : s.legacy ? t("s.act.removeOld") : undefined,
    };
  }
  if (s.legacy) {
    return {
      name, tone: "warn", title: t("s.st.update"),
      text: s.installed
        ? t("s.hooks.legacyOn")
        : t("s.hooks.legacyOff"),
      details: [how, t("s.hooks.legacyFound")],
      facts: [file, relay],
      primary: { label: t("s.act.update"), act: "install" },
      remove: s.installed ? t("s.act.disconnect") : t("s.act.removeThem"),
    };
  }
  if (s.installed) {
    return {
      name, tone: "ok", title: t("s.st.connected"),
      text: t("s.hooks.onText"),
      details: [how],
      facts: [file, relay], again: t("s.act.again"), remove: t("s.act.disconnect"),
    };
  }
  return {
    name, tone: "off", title: t("s.st.disconnected"),
    text: t("s.hooks.offText"),
    details: [how],
    facts: [file], primary: { label: t("s.act.connect"), act: "install" },
  };
}

function usageSpec(): Spec {
  const u = usage;
  const name = t("s.usage.name");
  if (!u) return { name, ...UNREACHABLE };
  const how = t("s.usage.how");
  const hints = t("s.usage.hints");
  if (u.installed) {
    return {
      name, tone: "ok",
      title: u.chained ? t("s.usage.chained") : t("s.st.on"),
      text: t("s.usage.onText"),
      details: [
        how,
        u.chained
          ? t("s.usage.chainedHow")
          : t("s.usage.noOwn", { hints }),
      ],
      facts: [[t("s.fact.key"), "statusLine"]],
      remove: t("s.act.turnOff"),
    };
  }
  return {
    name, tone: "off", title: t("s.st.off"),
    text: t("s.usage.offText"),
    details: [
      how,
      u.otherStatusLine
        ? t("s.usage.haveLine")
        : t("s.usage.noLine", { hints }),
    ],
    facts: [],
    // The same relay as the hooks': a status line pointing at one that isn't there shows nothing.
    primary: { label: t("s.act.turnOn"), act: "install", blocked: hooks && !hooks.hookReady ? RELAY_MISSING : undefined },
  };
}

const CURSOR_DOES = t("s.cursor.does");
const CURSOR_HOW = t("s.cursor.how");

function cursorSpec(): Spec {
  const c = cursor;
  const name = "Cursor";
  if (!c) return { name, ...UNREACHABLE };
  const file: [string, string] = ["hooks.json", c.hooksPath];
  const relay: [string, string] = [t("s.fact.relay"), c.hookPath];
  if (c.unreadable) return { name, tone: "error", title: t("s.st.cantChange"), text: t("s.cursor.unsafe"), details: [c.unreadable], facts: [file] };
  if (c.refused) return { name, tone: "error", title: t("s.st.cantChange"), text: t("s.cursor.unsafe"), details: [c.refused], facts: [file, relay] };
  if (!c.hookReady) {
    return {
      name, tone: "error", title: t("s.st.restart"),
      text: t("s.cursor.missing"),
      details: [t("s.relayNotYet")],
      facts: [file, relay], primary: { label: t("s.act.restart"), act: "restart" }, remove: c.installed ? t("s.act.disconnect") : undefined,
    };
  }
  if (c.installed && !c.current) {
    return {
      name, tone: "warn", title: t("s.st.update"),
      text: t("s.cursor.old"),
      details: [t("s.relayMoved")],
      facts: [file, relay], primary: { label: t("s.act.update"), act: "install" }, remove: t("s.act.disconnect"),
    };
  }
  if (c.installed) {
    return {
      name, tone: "ok", title: t("s.st.connected"), text: CURSOR_DOES,
      details: [CURSOR_HOW, t("s.cursor.reloads")],
      facts: [file, relay], again: t("s.act.again"), remove: t("s.act.disconnect"),
    };
  }
  return {
    name, tone: "off", title: t("s.st.disconnected"), text: CURSOR_DOES,
    details: [
      CURSOR_HOW,
      c.cursorFound
        ? c.fileExists ? t("s.hooksKept") : t("s.hooksNew")
        : t("s.cursor.noFolder"),
      t("s.cursor.after"),
    ],
    facts: [file], primary: { label: t("s.act.connect"), act: "install" },
  };
}

const CODEX_DOES = t("s.codex.does");
const CODEX_HOW = t("s.codex.how");

function codexSpec(): Spec {
  const c = codex;
  const name = "Codex";
  if (!c) return { name, ...UNREACHABLE };
  const file: [string, string] = ["hooks.json", c.hooksPath];
  const relay: [string, string] = [t("s.fact.relay"), c.hookPath];
  if (c.unreadable) return { name, tone: "error", title: t("s.st.cantChange"), text: t("s.codex.unsafe"), details: [c.unreadable], facts: [file] };
  if (c.refused) return { name, tone: "error", title: t("s.st.cantChange"), text: t("s.codex.unsafe"), details: [c.refused], facts: [file, relay] };
  if (!c.hookReady) {
    return {
      name, tone: "error", title: t("s.st.restart"),
      text: t("s.codex.missing"),
      details: [t("s.relayNotYet")],
      facts: [file, relay], primary: { label: t("s.act.restart"), act: "restart" }, remove: c.installed ? t("s.act.disconnect") : undefined,
    };
  }
  if (c.installed && !c.current) {
    return {
      name, tone: "warn", title: t("s.st.update"),
      text: t("s.codex.old"),
      details: [t("s.relayMoved"), CODEX_TRUST],
      facts: [file, relay], primary: { label: t("s.act.update"), act: "install" }, remove: t("s.act.disconnect"),
    };
  }
  if (c.installed) {
    return {
      name, tone: "ok", title: t("s.st.connected"), text: CODEX_DOES,
      details: [CODEX_HOW, CODEX_TRUST],
      facts: [file, relay], again: t("s.act.again"), remove: t("s.act.disconnect"),
    };
  }
  return {
    name, tone: "off", title: t("s.st.disconnected"), text: CODEX_DOES,
    details: [
      CODEX_HOW,
      c.codexFound
        ? c.fileExists ? t("s.hooksKept") : t("s.hooksNew")
        : t("s.codex.noFolder"),
      CODEX_TRUST,
    ],
    facts: [file], primary: { label: t("s.act.connect"), act: "install" },
  };
}

/** The reply format's one sentence, said the same whatever its state. */
const REPLY_DOES = t("s.reply.does");
const REPLY_HOW = t("s.reply.how");

function replySpec(): Spec {
  const r = reply;
  const name = t("s.reply.name");
  if (!r) return { name, ...UNREACHABLE };
  const file: [string, string] = ["CLAUDE.md", r.path];
  switch (r.state) {
    case "installed":
      return { name, tone: "ok", title: t("s.st.on"), text: REPLY_DOES, details: [REPLY_HOW], facts: [file], remove: t("s.act.turnOff") };
    case "outdated":
      return {
        name, tone: "warn", title: t("s.st.update"),
        text: t("s.reply.outdated"),
        details: [REPLY_DOES, t("s.reply.updating")],
        facts: [file],
        primary: { label: t("s.act.update"), act: "install" }, remove: t("s.act.turnOff"),
      };
    case "unmarked":
      return {
        name, tone: "warn", title: t("s.reply.ownTitle"),
        text: t("s.reply.ownText"),
        found: r.found,
        details: [
          t("s.reply.ownFound"),
          t("s.reply.ownHow"),
        ],
        facts: [file],
      };
    case "error":
      return { name, tone: "error", title: t("s.st.cantChange"), text: t("s.reply.unsafe"), details: [r.error ?? t("s.reply.unreadable")], facts: [file] };
    default:
      return {
        name, tone: "off", title: t("s.st.off"), text: REPLY_DOES,
        details: [REPLY_HOW, r.exists ? t("s.reply.atEnd") : t("s.reply.noFile")],
        facts: [file], primary: { label: t("s.act.turnOn"), act: "install" },
      };
  }
}

const SPECS: Record<Change, () => Spec> = { hooks: hooksSpec, usage: usageSpec, reply: replySpec, cursor: cursorSpec, codex: codexSpec };
/** Each part's block, repainted in place. */
const painters: Partial<Record<Change, (opening?: boolean, focus?: "primary" | "panel") => void>> = {};
const paintClaude = () => {
  for (const kind of CHANGES) painters[kind]?.();
};

async function readClaude() {
  const [h2, u, r, c, x] = await Promise.all([oleo.hooksStatus(), oleo.usageStatus(), oleo.replyFormatStatus(), oleo.cursorStatus(), oleo.codexStatus()]);
  hooks = h2;
  usage = u;
  reply = r;
  cursor = c;
  codex = x;
}

/** The diff of what `install` (or removing) would write: asked of Rust, and shown. Nothing is written here. */
async function openPreview(kind: Change, install: boolean) {
  // One diff at a time: the other parts go back to their status.
  const others = CHANGES.filter((other) => other !== kind);
  for (const other of others) if (flows[other].at === "confirm") flows[other] = { at: "status" };
  const paintOthers = () => others.forEach((other) => painters[other]?.());
  // The reply format's block is added, brought up to date, or taken out: said as it stands now.
  const action: ReplyFormatAction = !install ? "remove" : reply?.state === "outdated" ? "update" : "install";
  try {
    const preview = kind === "reply" ? await oleo.replyFormatPreview(action)
      : kind === "usage" ? await oleo.usagePreview(install)
        : kind === "cursor" ? await oleo.cursorPreview(install)
          : kind === "codex" ? await oleo.codexPreview(install)
            : await oleo.hooksPreview(install);
    flows[kind] = { at: "confirm", install, preview, action };
    paintOthers();
    painters[kind]?.(true, "panel");
  } catch (err) {
    // An unreadable or invalid file stops here rather than being treated as
    // empty and written over.
    flows[kind] = { at: "status", error: reason(err) };
    paintOthers();
    painters[kind]?.(false, "primary");
  }
}

/** The confirm button of the diff on show: the one place a write is asked for. */
async function writeChange(kind: Change) {
  const flow = flows[kind];
  if (flow.at !== "confirm" || flow.busy) return;
  flow.busy = true;
  flow.error = undefined;
  painters[kind]?.();
  try {
    const backup = kind === "reply"
      ? await oleo.replyFormatApply(flow.action ?? (flow.install ? "install" : "remove"), flow.preview.fingerprint)
      : kind === "usage"
        ? await oleo.usageApply(flow.install, flow.preview.fingerprint)
        : kind === "cursor"
          ? await oleo.cursorApply(flow.install, flow.preview.fingerprint)
          : kind === "codex"
            ? await oleo.codexApply(flow.install, flow.preview.fingerprint)
            : await oleo.hooksApply(flow.install, flow.preview.fingerprint);
    if (kind === "reply") wasCreated = reply?.exists === false;
    if (kind === "cursor") wasCreated = cursor?.fileExists === false;
    if (kind === "codex") wasCreated = codex?.fileExists === false;
    flows[kind] = { at: "status", done: { install: flow.install, backup } };
    await readClaude();
    paintClaude();
    say(flow.install ? t("s.done") : t("s.removed"));
  } catch (err) {
    flow.busy = false;
    flow.error = t("s.diff.couldNot", { why: reason(err) });
    painters[kind]?.(false, "panel");
  }
}

function diffPanel(kind: Change, flow: Extract<Flow, { at: "confirm" }>, close: () => void): HTMLElement {
  const words = CHANGE_WORDS[kind];
  const fileName = CHANGED_FILE[kind];
  // A file that is not there yet has nothing to copy: said, rather than a backup promised.
  const created = (kind === "reply" && reply?.exists === false) || (kind === "cursor" && cursor?.fileExists === false) || (kind === "codex" && codex?.fileExists === false);
  const lines = flow.preview.diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+")).length;
  const removed = lines.filter((l) => l.startsWith("-")).length;
  const box = h("div", { class: "sp-diff", tabindex: "0", role: "region", "aria-label": t("s.diff.changesTo", { file: fileName }) });
  for (const line of lines) {
    const sign = line[0] === "+" || line[0] === "-" ? line[0] : " ";
    // Rust writes "+ ", "- " or two spaces before each line.
    box.append(h("div", { class: sign === "+" ? "add" : sign === "-" ? "del" : "", "data-sign": sign, text: line.slice(line[1] === " " ? 2 : 1) }));
  }
  const confirm = button(created ? t("s.diff.create") : flow.install ? t("s.diff.apply") : t("s.diff.remove"), flow.install ? "primary" : "danger solid", () => void writeChange(kind));
  const cancel = button(t("s.cancel"), "quiet", close);
  confirm.disabled = cancel.disabled = Boolean(flow.busy);
  const panel = h("div", { class: "sp-panel" },
    h("div", { class: "sp-panel-head" },
      h("span", { text: t("s.diff.changesTo", { file: fileName }) }),
      h("span", { class: "counts" },
        h("span", { class: "plus", text: `+${added}` }), h("span", { class: "minus", text: `−${removed}` }))),
    h("p", { class: "sp-help", text: `${flow.install ? words.install : words.remove} ${t("s.diff.untilClick")}` }),
    box,
    added + removed === 0 ? h("p", { class: "sp-help", text: t("s.diff.nothing", { file: fileName }) }) : null,
    created
      ? h("p", { class: "sp-help", text: t("s.diff.noBackup") })
      : h("p", { class: "sp-help" }, t("s.diff.backupFirst"), h("code", {}, ...breakable(flow.preview.backup))),
    flow.error ? h("div", { class: "sp-flash error", role: "alert" }, icon(LUCIDE.circleX, 15), h("span", { text: flow.error })) : null,
    h("div", { class: "sp-panel-actions" }, confirm, cancel));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !flow.busy) {
      e.preventDefault();
      close();
    }
  });
  return panel;
}

/**
 * Something Oleo writes for Claude Code or Cursor: where it stands in a plain
 * sentence, its one action, the technical side folded under Details, and the
 * diff that action would write.
 */
function integration(kind: Change): HTMLElement {
  const slot = h("div");
  const paint = (opening = false, focus?: "primary" | "panel") => {
    const spec = SPECS[kind]();
    const flow = flows[kind];
    const scrollOfDiff = slot.querySelector(".sp-panel .sp-diff")?.scrollTop;

    const head = h("div", { class: "sp-status-head" },
      h("span", { class: "sp-status-icon" }, icon(TONE_ICON[spec.tone], 22, 1.8)),
      h("div", {},
        h("div", { class: "sp-status-title" }, h("span", { text: spec.title })),
        h("p", { class: "sp-status-text", text: spec.text })));
    const block = h("div", { class: "sp-status", "data-tone": spec.tone, role: "group", "aria-label": spec.name }, head);

    if (flow.at === "status" && flow.done) {
      // A file Oleo created had no previous one to save.
      const saved = (kind === "reply" || kind === "cursor" || kind === "codex") && wasCreated ? [] : [t("s.savedAs"), ...breakable(flow.done.backup), ". "];
      block.append(h("div", { class: "sp-flash", role: "status" }, icon(LUCIDE.check, 15, 2.4),
        h("span", {}, flow.done.install ? t("s.doneSp") : t("s.removedSp"), ...saved, CHANGE_WORDS[kind].done)));
    }
    if (flow.at === "status" && flow.error) {
      block.append(h("div", { class: "sp-flash error", role: "alert" }, icon(LUCIDE.circleX, 15), h("span", { text: flow.error })));
    }
    if (flow.at === "status" && flow.note) {
      block.append(h("div", { class: "sp-flash note", role: "status" }, icon(LUCIDE.info, 15), h("span", { text: flow.note })));
    }

    const confirming = flow.at === "confirm";
    const go = (install: boolean) => void openPreview(kind, install);
    const actions = h("div", { class: "sp-actions" });
    if (spec.primary) {
      const { act, blocked, label } = spec.primary;
      const b = button(label, "primary", () => {
        if (act === "install") return go(true);
        flows[kind] = { at: "status", note: t("s.restarting") };
        paint();
        void oleo.restart().then(() => window.setTimeout(async () => {
          // Only reached where the window outlives the restart: a browser, or a restart that did not happen.
          flows[kind] = { at: "status" };
          await readClaude();
          paintClaude();
        }, 1500));
      });
      actions.append(b);
      if (blocked) {
        b.disabled = true;
        b.title = blocked;
        actions.append(h("span", { class: "sp-actions-note", text: blocked }));
      }
    }
    if (spec.again) actions.append(button(spec.again, "quiet", () => go(true)));
    if (spec.remove) actions.append(button(spec.remove, `danger${actions.childElementCount ? " push" : ""}`, () => go(false)));
    // While the diff is open, its two buttons are the only way on.
    if (!confirming && actions.childElementCount) block.append(actions);

    // The technical side: how it works, the files, the user's own lines. Folded until asked for.
    if (spec.found?.length || spec.details?.length || spec.facts.length) {
      const id = `details-${kind}`;
      const body = h("div", { class: "sp-details", id });
      if (spec.found?.length) {
        // Somebody's own lines: shown as they are, and nothing here acts on them.
        body.append(h("div", { class: "sp-diff sp-found", tabindex: "0", role: "region", "aria-label": t("s.found.in", { file: CHANGED_FILE[kind] }) },
          ...spec.found.map((line) => h("div", { "data-sign": " ", text: line || " " }))));
      }
      for (const text of spec.details ?? []) body.append(h("p", { text }));
      if (spec.facts.length) {
        const facts = h("dl", { class: "sp-facts" });
        for (const [k, v] of spec.facts) facts.append(h("dt", { text: k }), h("dd", {}, ...breakable(v)));
        body.append(facts);
      }
      const fold = h("div", { class: `sp-fold${detailsOpen[kind] ? " open" : ""}` }, h("div", {}, body));
      const more = h("button", { class: "sp-more", type: "button", "aria-expanded": String(detailsOpen[kind]), "aria-controls": id },
        h("span", { text: t("s.details") }), icon(LUCIDE.chevronDown, 14, 2.2));
      more.addEventListener("click", () => {
        detailsOpen[kind] = !detailsOpen[kind];
        fold.classList.toggle("open", detailsOpen[kind]);
        more.setAttribute("aria-expanded", String(detailsOpen[kind]));
      });
      block.append(h("div", { class: "sp-more-wrap" }, more, fold));
    }

    const fold = h("div", { class: "sp-fold sp-diff-fold" });
    if (confirming) {
      fold.append(h("div", {}, diffPanel(kind, flow, () => {
        flows[kind] = { at: "status" };
        paint(false, "primary");
      })));
    }
    block.append(fold);
    clear(slot);
    slot.append(block);
    if (confirming) {
      // Shut, then open: the panel unfolds from the block's lower edge.
      if (opening && !still()) void fold.offsetHeight;
      fold.classList.add("open");
      const box = block.querySelector<HTMLElement>(".sp-panel .sp-diff")!;
      if (opening) {
        // The whole file is in the diff: start at the first line that changes.
        const first = box.querySelector<HTMLElement>(".add, .del");
        if (first) box.scrollTop = Math.max(0, first.getBoundingClientRect().top - box.getBoundingClientRect().top - 36);
      } else if (scrollOfDiff != null) {
        box.scrollTop = scrollOfDiff;
      }
    }
    if (focus === "panel") block.querySelector<HTMLElement>(".sp-panel .sp-btn:not(:disabled)")?.focus({ preventScroll: opening });
    if (focus === "primary") block.querySelector<HTMLElement>(".sp-actions .sp-btn:not(:disabled)")?.focus();
    if (opening) block.querySelector(".sp-panel")?.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
  };
  painters[kind] = paint;
  paint();
  return slot;
}

/** A part of Connect, as a search finds it: by what it does, whatever state it is in. */
const connectGroup = (kind: Change, label: string, what: string, keys: string, ...more: Kid[]) =>
  findable(bare(label, integration(kind), ...more), label, what, keys, true);

/** A tool's own part of Connect: its mark, its name, what Oleo does with it, and under them everything Oleo writes for it. */
const toolPart = (key: SessionAgent, what: string, ...kids: Kid[]) =>
  h("section", { class: `sp-tool ${key}`, "aria-label": TOOL_NAME[key] },
    h("header", { class: "sp-tool-head" },
      h("span", { class: "sp-tool-mark", "aria-hidden": "true" },
        key === "cursor" ? brand(BRANDS.cursor, 18) : icon(key === "codex" ? CODEX_MARK : CLAUDE_MARK, 18, 2.4)),
      h("div", { class: "sp-tool-text" },
        h("h2", { class: "sp-tool-name", text: TOOL_NAME[key] }),
        h("p", { class: "sp-tool-what", text: what }))),
    ...kids);

function connectSection(): Kid[] {
  return [
    head("connect"),
    toolPart("claude", t("s.claude.what"),
      connectGroup("hooks", t("s.sessPerms"), t("s.hooks.find"),
        "hooks hook claude code connect connection install setup set up link sessions permissions approve relay settings.json uninstall disconnect"),
      connectGroup("usage", t("s.usage.name"), t("s.usage.find"),
        "usage limits limit quota plan subscription status line statusline weekly 5-hour five hour"),
      connectGroup("reply", t("s.reply.name"), REPLY_DOES,
        "reply replies format answers layout claude.md instructions summary decisions warnings tips markdown")),
    cursorGroup(),
    codexGroup(),
  ];
}

/** Codex beside Claude Code: its hooks (sessions and permission requests), and whether its sessions are shown. */
function codexGroup(): HTMLElement {
  const show = toggle(settings.showCodexSessions, t("s.codex.show"), (on) => change({ showCodexSessions: on }));
  followers.push(() => show.set(settings.showCodexSessions));
  return toolPart("codex", t("s.codex.what"),
    connectGroup("codex", t("s.sessPerms"), CODEX_DOES, "codex openai cli hooks.json agent sessions permissions approve allow deny connect"),
    group(null,
      row(t("s.codex.show"), t("s.codex.showHelp"), show.el,
        "codex show hide sessions openai")));
}

/** Cursor beside Claude Code: its hooks (status only), and whether its sessions are shown. */
function cursorGroup(): HTMLElement {
  const show = toggle(settings.showCursorSessions, t("s.cursor.show"), (on) => change({ showCursorSessions: on }));
  followers.push(() => show.set(settings.showCursorSessions));
  return toolPart("cursor", t("s.cursor.what"),
    connectGroup("cursor", t("s.sessions"), CURSOR_DOES, "cursor editor ide hooks.json agent sessions connect"),
    group(null,
      row(t("s.cursor.show"), t("s.cursor.showHelp"), show.el,
        "cursor show hide sessions editor")));
}

/** settings.json may have changed while the window was away: its state is read again, never written. */
async function refreshClaude() {
  const onShow = () => section === "connect" || query !== "";
  if (!onShow() || CHANGES.some((kind) => flows[kind].at === "confirm")) return;
  const before = JSON.stringify([hooks, usage, reply, cursor, codex]);
  await readClaude();
  if (JSON.stringify([hooks, usage, reply, cursor, codex]) !== before && onShow()) paintClaude();
}

// ── Shortcuts ─────────────────────────────────────────────────────────────────

/** A key of a shortcut as it is shown: "KeyK" is K, "Digit1" is 1, "Super" is the Windows key. */
const KEY_WORDS: Record<string, string> = {
  Super: "Win", ArrowUp: t("s.key.up"), ArrowDown: t("s.key.down"), ArrowLeft: t("s.key.left"), ArrowRight: t("s.key.right"), Escape: "Esc", Delete: t("s.key.del"),
  Space: t("s.key.space"), Enter: t("s.key.enter"), Backspace: t("s.key.backspace"), Home: t("s.key.home"), End: t("s.key.end"),
  PageUp: t("s.key.pageUp"), PageDown: t("s.key.pageDown"),
};
const keyWord = (key: string) => KEY_WORDS[key] ?? key.replace(/^(Key|Digit)(?=.$)/, "");
/** "Ctrl+Alt+Space" as its keys: Ctrl, Alt, Space. */
const shortcutKeys = (accelerator: string) => accelerator.split("+").map((part) => keyWord(part.trim()));

/** The keys that only modify another: pressed alone, the combination is not whole yet. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

/** The modifiers held during a key event, in the order a shortcut is written in. */
function heldModifiers(e: KeyboardEvent): string[] {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter((m): m is string => !!m);
}

/** Where the settings keep each shortcut: its keys, and whether it is on. */
const SHORTCUT_FIELDS = {
  expand: ["expandShortcut", "expandShortcutEnabled"],
  goto: ["gotoShortcut", "gotoShortcutEnabled"],
  panel: ["panelShortcut", "panelShortcutEnabled"],
  hide: ["hideShortcut", "hideShortcutEnabled"],
  agents: ["agentsShortcut", "agentsShortcutEnabled"],
} as const satisfies Record<ShortcutName, readonly [keyof Settings, keyof Settings]>;

/** The five global shortcuts: what each is called, what it does, and the words a search finds it by. */
const SHORTCUTS: readonly { which: ShortcutName; label: string; does: string; keys: string }[] = [
  { which: "expand", label: t("s.sc.expand"), does: t("s.sc.expandDoes"), keys: "expand large big full size shrink panel" },
  { which: "panel", label: t("s.sc.panel"), does: t("s.sc.panelDoes"), keys: "open panel sessions list" },
  { which: "goto", label: t("s.sc.goto"), does: t("s.sc.gotoDoes"), keys: "go to jump switch window focus needs you asking error" },
  { which: "hide", label: t("s.sc.hide"), does: t("s.sc.hideDoes"), keys: "hide show island invisible away" },
  { which: "agents", label: t("s.sc.agents"), does: t("s.sc.agentsDoes"), keys: "agents list window projects" },
];

/** What a reset does to each shortcut row: Rust's own path, as a change made by hand. */
const shortcutResets = new Map<ShortcutName, () => Promise<void>>();
/** Each row's key field: where "Set a keyboard shortcut for it" takes the keyboard. */
const shortcutFields = new Map<ShortcutName, HTMLElement>();

/** A shortcut as the settings have it. */
const savedShortcut = (which: ShortcutName): ShortcutStatus => {
  const [key, on] = SHORTCUT_FIELDS[which];
  return { accelerator: settings[key], enabled: settings[on], registered: false, error: null };
};

/**
 * A global shortcut: a field that records the combination pressed in it, a
 * switch, and under them where it stands. Rust has the last word: it registers
 * the combination before it saves it, and one it refuses — not a combination,
 * reserved, another Oleo shortcut's, or held by another program — leaves the one
 * that worked in place.
 */
function shortcutRow({ which, label, does, keys }: (typeof SHORTCUTS)[number]): HTMLElement {
  let status = shortcutsNow?.[which] ?? savedShortcut(which);
  /** Whether Rust has said where it stands: until then, nothing is claimed of it. */
  let known = shortcutsNow != null;
  /** What the last change was refused for, and the keys it was for, until the next one. */
  let refused: { why: string; keys: string[] } | null = null;
  let recording = false;
  /** Modifiers held so far while recording. */
  let partial: string[] = [];
  let doneAt = 0;

  const statusId = `shortcut-status-${which}`;
  const field = h("button", { class: "sp-keys", type: "button", "aria-describedby": statusId });
  const line = h("div", { class: "sp-shortcut-status", id: statusId, role: "status" });
  const el = h("div", { class: "sp-row stack sp-shortcut" });
  let power: Toggle;

  const paint = () => {
    // The agents shortcut is kept but not taken while the list is off.
    const dormant = which === "agents" && !settings.showAgentsList;
    const problem = refused?.why ?? (status.enabled && !dormant ? status.error : null);
    const state = recording ? "recording" : problem ? "error" : !status.enabled || dormant ? "off" : known && status.registered ? "ok" : "unknown";
    el.dataset.state = state;
    clear(field);
    const shown = recording ? partial.map(keyWord) : refused ? refused.keys : shortcutKeys(status.accelerator);
    for (const key of shown) field.append(h("kbd", { text: key }));
    if (recording) field.append(h("span", { class: "wait", text: partial.length ? t("s.sc.aKey") : t("s.sc.press") }));
    field.title = recording ? "" : t("s.sc.clickToChange");
    field.setAttribute("aria-label", recording ? t("s.sc.recordingAria", { label }) : t("s.sc.changeAria", { label, keys: shortcutKeys(status.accelerator).join(" + ") }));
    power.set(status.enabled);
    const using = shortcutKeys(status.accelerator).join(" + ");
    clear(line);
    // A notice is for what needs the user: a combination refused, one not taken, one waiting. A shortcut that works says nothing.
    line.classList.toggle("quiet", state === "ok" || state === "unknown" || (state === "off" && !(dormant && status.enabled)));
    line.append(h("i"), h("span", { text:
      state === "recording" ? t("s.sc.recording")
      : refused ? (status.enabled && status.registered ? t("s.sc.stillUsing", { why: refused.why, keys: using }) : `${refused.why}.`)
      : state === "error" ? `${problem}.`
      : state === "off" ? (dormant && status.enabled ? t("s.sc.dormant") : t("s.sc.off"))
      : state === "ok" ? t("s.sc.works")
      : known ? t("s.sc.notRegistered") : "" }));
  };

  async function set(accelerator: string, enabled: boolean, keys: string[]) {
    try {
      status = await oleo.setShortcut(which, accelerator, enabled);
      known = true;
      refused = null;
      if (shortcutsNow) shortcutsNow[which] = status;
      // Rust saved it, and says so to both windows; this is the same, a moment sooner.
      const [key, on] = SHORTCUT_FIELDS[which];
      settings = { ...settings, [key]: status.accelerator, [on]: status.enabled };
    } catch (err) {
      refused = { why: reason(err).replace(/\.$/, ""), keys };
    }
    paint();
    paintResets();
    say(line.textContent ?? "");
  }

  const stop = () => {
    recording = false;
    partial = [];
    doneAt = performance.now();
    paint();
  };

  field.addEventListener("click", () => {
    // A shortcut ending in Space or Enter must not start the next recording.
    if (recording || performance.now() - doneAt < 250) return;
    recording = true;
    partial = [];
    paint();
  });
  field.addEventListener("blur", () => {
    if (recording) stop();
  });
  field.addEventListener("keydown", (e) => {
    if (!recording) return;
    // Tab still leaves the field; everything else is the combination being pressed.
    if (e.key === "Tab" && heldModifiers(e).every((m) => m === "Shift")) return stop();
    e.preventDefault();
    e.stopPropagation();
    const held = heldModifiers(e);
    if (e.key === "Escape" && held.length === 0) return stop();
    partial = held;
    if (MODIFIER_KEYS.has(e.key)) return paint();
    if (e.repeat || !e.code) return;
    const key = e.code.replace(/^(Key|Digit)(?=.$)/, "");
    stop();
    void set([...held, key].join("+"), status.enabled, [...held, key].map(keyWord));
  });
  field.addEventListener("keyup", (e) => {
    if (!recording) return;
    partial = heldModifiers(e);
    paint();
  });

  power = toggle(status.enabled, t("s.sc.onAria", { label }), (on) => void set(status.accelerator, on, shortcutKeys(status.accelerator)));
  el.append(
    h("div", { class: "sp-shortcut-top" },
      h("div", { class: "sp-row-text" }, h("div", { class: "sp-row-label", text: label }), h("p", { class: "sp-help", text: does })),
      power.el),
    field, line);
  paint();
  shortcutFields.set(which, field);
  shortcutResets.set(which, async () => {
    const [key, on] = SHORTCUT_FIELDS[which];
    const accelerator = DEFAULT_SETTINGS[key];
    const enabled = DEFAULT_SETTINGS[on];
    if (status.accelerator === accelerator && status.enabled === enabled && !refused) return;
    await set(accelerator, enabled, shortcutKeys(accelerator));
  });
  // The list turned on or off takes this shortcut from the OS, or gives it back: Rust has saved by the time it echoes, and says where it stands.
  if (which === "agents") {
    followers.push(() => {
      paint();
      void oleo.shortcutStatus().then((fresh) => {
        if (!fresh) return;
        shortcutsNow = fresh;
        if (recording || refused) return;
        status = fresh[which];
        paint();
      });
    });
  }

  // What Rust has: a saved shortcut that could not be registered at launch says so here.
  void oleo.shortcutStatus().then((fresh) => {
    if (!fresh) return;
    shortcutsNow = fresh;
    if (recording || refused) return;
    status = fresh[which];
    known = true;
    paint();
  });
  return findable(el, label, does, `shortcut shortcuts hotkey hot key keyboard keys key combination ${keys}`);
}

function shortcutsSection(): Kid[] {
  const of = (...names: ShortcutName[]) => SHORTCUTS.filter((s) => names.includes(s.which)).map(shortcutRow);
  return [
    head("shortcuts"),
    group(t("s.info.theIsland"), ...of("expand", "panel", "goto", "hide")),
    group(t("s.info.agents"), ...of("agents")),
    resetFoot("shortcuts"),
  ];
}

// ── Sounds ────────────────────────────────────────────────────────────────────

/** The sound's volume as the island has it — 0 to 0.2 — and as the slider shows it: 0 to 100 %. */
const VOLUME_MAX = 0.2;
const volumePercent = () => Math.round((Math.max(0, Math.min(VOLUME_MAX, settings.soundVolume)) / VOLUME_MAX) * 100);

function soundsSection(): Kid[] {
  const volumeNeeds = needs();
  const volume = slider(t("s.volume"), volumePercent(), (v) => `${v}%`, (v) => change({ soundVolume: Number(((v / 100) * VOLUME_MAX).toFixed(4)) }, true));
  const paintVolume = () => {
    volume.setDisabled(!settings.soundEnabled);
    sayNeeds(volumeNeeds, settings.soundEnabled ? null : t("s.sound.needs"));
  };
  const sound = toggle(settings.soundEnabled, t("s.sound.play"), (on) => {
    change({ soundEnabled: on });
    paintVolume();
  });
  paintVolume();
  // The island's own quick settings change the sound too.
  followers.push(() => {
    sound.set(settings.soundEnabled);
    volume.set(volumePercent());
    paintVolume();
  });
  return [
    head("sounds"),
    group(t("s.sound.group"),
      row(t("s.sound.play"), t("s.sound.help"), sound.el,
        "sound sounds audio mute unmute noise beep chime alert notification quiet silent"),
      row(t("s.volume"), t("s.volume.help"), volume.el, "volume loud quiet louder softer level audio sound", volumeNeeds)),
    resetFoot("sounds"),
  ];
}

// ── Agents list ───────────────────────────────────────────────────────────────

function agentsSection(): Kid[] {
  const fadeNeeds = needs();
  const opacityNeeds = needs();
  const agentsFade = toggle(settings.agentsListFade, t("s.ag.fade"), (on) => {
    change({ agentsListFade: on });
    paintAgentsFade();
  });
  const fadePercent = () => Math.max(FADE_MIN, Math.min(FADE_MAX, Math.round(settings.agentsListFadeOpacity) || 50));
  const agentsFadeTo = slider(t("s.ag.fadeTo"), fadePercent(), (v) => `${v}%`, (v) => change({ agentsListFadeOpacity: v }, true), FADE_MIN, FADE_MAX);
  const agentsList = toggle(settings.showAgentsList, t("s.ag.show"), (on) => {
    change({ showAgentsList: on });
    paintAgentsFade();
  });
  // Both fade rows are for a list that is on; the opacity is for a fade that is on.
  const paintAgentsFade = () => {
    agentsFade.el.disabled = !settings.showAgentsList;
    agentsFadeTo.setDisabled(!settings.agentsListFade || !settings.showAgentsList);
    const off = settings.showAgentsList ? null : t("s.ag.needsList");
    sayNeeds(fadeNeeds, off);
    sayNeeds(opacityNeeds, off ?? (settings.agentsListFade ? null : t("s.ag.needsFade")));
  };
  paintAgentsFade();
  followers.push(() => {
    agentsList.set(settings.showAgentsList);
    agentsFade.set(settings.agentsListFade);
    agentsFadeTo.set(fadePercent());
    paintAgentsFade();
  });

  const toShortcut = h("button", { class: "sp-link", type: "button" },
    icon(LUCIDE.keyboard, 16), h("span", { class: "sp-link-text", text: t("s.ag.shortcut") }), icon(LUCIDE.arrowRight, 14));
  toShortcut.addEventListener("click", () => {
    goTo("shortcuts", shortcutFields.get("agents")?.closest<HTMLElement>(".sp-shortcut") ?? undefined);
    window.requestAnimationFrame(() => shortcutFields.get("agents")?.focus({ preventScroll: true }));
  });

  return [
    head("agents"),
    group(t("s.ag.group"),
      row(t("s.ag.show"),
        t("s.ag.showHelp"),
        agentsList.el, "agents list window projects overlay sessions always on top floating"),
      row(t("s.ag.fade"), t("s.ag.fadeHelp"), agentsFade.el,
        "fade dim idle transparent", fadeNeeds),
      row(t("s.ag.fadeTo"), t("s.ag.fadeToHelp"), agentsFadeTo.el,
        "opacity transparency fade dim see-through visible", opacityNeeds)),
    group(t("s.ag.move"),
      findable(h("div", { class: "sp-row" },
        rowText(t("s.ag.moveRow"),
          t("s.ag.moveHelp"))),
      t("s.ag.moveRow"), t("s.ag.moveFind"),
      "move drag resize size width height position place reset double-click"),
      findable(h("div", { class: "sp-row" }, toShortcut), t("s.ag.shortcut"), null, "shortcut hotkey keyboard keys agents")),
    resetFoot("agents"),
  ];
}

// ── Island ────────────────────────────────────────────────────────────────────

const AUTO_CLOSE = ["3", "5", "10", "15", "30", "custom"] as const;
type AutoClose = (typeof AUTO_CLOSE)[number];
const autoClosePreset = (): AutoClose => {
  const preset = String(Math.round(settings.autoCloseInterval));
  return settings.autoCloseInterval === Math.round(settings.autoCloseInterval) && (AUTO_CLOSE as readonly string[]).includes(preset) ? (preset as AutoClose) : "custom";
};
/** "Custom" stays picked while its number happens to be one of the presets. */
let autoCloseCustom = false;

/** A row of the picker: one of the island's cells. */
type MetricRow = CompactMetric;
const METRIC_ROWS: readonly MetricRow[] = COMPACT_METRICS;
const metricName = (id: MetricRow) => COMPACT_CELLS[id].name;
const isMetric = (id: string): id is CompactMetric => (COMPACT_METRICS as readonly string[]).includes(id);

/** The compact island, live: at the top of the Island page and of Look and colours, whichever is on show. */
const folded = islandPreview(islandBot);
/**
 * What the preview draws. The Island page follows "Folded island": the line (in the colour chosen; "" is the neutral one)
 * or the capsule. Look and colours always shows the capsule: the mascot is in it.
 */
const previewLine = (): string | null =>
  section === "look" || settings.foldedStyle !== "thread" ? null : /^#[0-9a-f]{6}$/i.test(settings.threadColor) ? settings.threadColor : "";
const paintPreview = (animate: boolean) => folded.update(compactMetrics(settings), animate && !still(), settings.dock, previewLine());

/** The metrics to choose from: made once, repainted in place. */
const metricPicker = (() => {
  const list = h("ul", { class: "sp-metrics" });
  const count = h("span", { class: "count" });
  const refusal = h("div", { class: "sp-refusal", role: "status", hidden: true }, icon(LUCIDE.triangleAlert, 15), h("span"));
  const rows = new Map<MetricRow, { el: HTMLElement; check: HTMLButtonElement; grip: HTMLButtonElement }>();

  const chosen = () => compactMetrics(settings);
  const order = (): MetricRow[] => [...chosen(), ...METRIC_ROWS.filter((id) => !(chosen() as MetricRow[]).includes(id))];

  const paint = (animate = true) => {
    const on = chosen() as MetricRow[];
    flip(list, () => {
      for (const id of order()) {
        const r = rows.get(id)!;
        const picked = on.includes(id);
        r.el.classList.toggle("on", picked);
        if (picked) delete r.el.dataset.fixed;
        else r.el.dataset.fixed = "";
        r.check.setAttribute("aria-checked", String(picked));
        r.grip.tabIndex = picked ? 0 : -1;
        list.append(r.el);
      }
    }, !animate || still());
    count.textContent = t("s.metrics.count", { n: on.length, max: MAX_COMPACT_METRICS });
    paintPreview(animate);
  };

  const refuse = (id: MetricRow | null) => {
    for (const r of rows.values()) r.el.classList.remove("refused");
    refusal.hidden = id == null;
    if (id == null) return;
    const text = t("s.metrics.max", { name: metricName(id) });
    refusal.querySelector("span")!.textContent = text;
    say(text);
    const el = rows.get(id)!.el;
    void el.offsetWidth;
    el.classList.add("refused");
  };

  for (const id of METRIC_ROWS) {
    const name = metricName(id);
    const check = h("button", { class: "sp-check", type: "button", role: "checkbox" },
      h("i", { class: "box" }, icon(LUCIDE.check, 12, 3.2)),
      h("i", { class: "glyph" }, cellIcon(id, 16)),
      h("span", { class: "name", text: name }),
      h("span", { class: "sample", text: COMPACT_CELLS[id].sample }));
    // A machine that reports no GPU use shows "—" in its cell: it can still be picked.
    if (id === "gpu") check.title = t("s.metrics.gpuTip");
    check.addEventListener("click", () => {
      const on = chosen();
      if (on.includes(id)) {
        change({ compactMetrics: on.filter((x) => x !== id) });
        refuse(null);
      } else if (on.length >= MAX_COMPACT_METRICS) {
        // Refused, and said so: nothing is dropped to make room. Rust holds
        // the same line on save, whatever a page sends.
        return refuse(id);
      } else {
        change({ compactMetrics: [...on, id] });
        refuse(null);
      }
      paint();
    });
    const grip = h("button", { class: "sp-grip", type: "button", "aria-label": t("s.metrics.moveAria", { name }), title: t("s.drag") },
      icon(LUCIDE.gripVertical, 16));
    grip.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      const on = chosen();
      const at = on.indexOf(id);
      const to = at + step;
      if (!step || at < 0) return;
      e.preventDefault();
      if (to < 0 || to >= on.length) return;
      on.splice(at, 1);
      on.splice(to, 0, id);
      change({ compactMetrics: on });
      paint();
      grip.focus();
      say(t("s.position", { name, n: to + 1, of: on.length }));
    });
    const el = h("li", { class: "sp-metric", "data-id": id }, grip, check);
    rows.set(id, { el, check, grip });
  }

  reorderable(list, {
    item: ".sp-metric",
    handle: ".sp-grip",
    still,
    onDrop: (ids) => {
      const on = chosen();
      const next = ids.filter(isMetric).filter((id) => on.includes(id));
      if (next.join() !== on.join()) change({ compactMetrics: next });
      paint();
    },
  });

  paint(false);
  return { list, count, refusal, refuse, paint };
})();

/** t("s.isl.hideAfter"): the choices as the control names them, by their seconds ("0" is never). */
type HideAfter = `${(typeof FOLDED_AUTO_HIDE)[number]}`;
const HIDE_AFTER_WORDS: Record<HideAfter, string> = { 5: "5 s", 10: "10 s", 30: "30 s", 60: "1 min", 0: t("s.never") };
/**
 * What keeping the island on show costs, said as what it is: one measurement,
 * on one machine (the app at rest with the folded island up, across Oleo and
 * its WebView2 processes, 3 October 2026) — not a promise for another.
 */
const ALWAYS_SHOWN_NOTE =
  t("s.alwaysNote");

/** The page again, in the language now set, on the category that was on show. */
const REOPEN_AT = "oleo.settings.section";
function reopen() {
  try {
    sessionStorage.setItem(REOPEN_AT, section);
  } catch {
    // Without storage it opens on the first category.
  }
  location.reload();
}

/** The language picker: following the system (named in its own language), or one of the three. */
function languagePicker(): HTMLSelectElement {
  const el = h("select", { class: "sp-select", id: "sp-language", "aria-label": t("s.lang.title") });
  for (const value of LANGUAGE_SETTINGS) {
    const own = value === "system" ? systemLang() : value;
    el.append(h("option", { value, lang: own, text: value === "system" ? t("s.lang.system", { name: LANGUAGE_NAMES[own] }) : LANGUAGE_NAMES[value] }));
  }
  el.value = settings.language ?? "system";
  el.addEventListener("change", () => change({ language: el.value as LanguageSetting }));
  followers.push(() => {
    if (document.activeElement !== el) el.value = settings.language ?? "system";
  });
  return el;
}

function islandSection(): Kid[] {
  const language = languagePicker();
  // Where it sits.
  const screen = segmented<Settings["screen"]>(t("s.isl.screen"), [["primary", t("s.isl.main")], ["cursor", t("s.isl.pointer")]], settings.screen, (v) => change({ screen: v }));
  const dock = segmented<Settings["dock"]>(t("s.isl.edge"), [["top", t("s.isl.top")], ["bottom", t("s.isl.bottom")], ["left", t("s.isl.left")], ["right", t("s.isl.right")]], settings.dock, (v) => {
    change({ dock: v });
    paintPreview(false);
  });
  const foldedStyle = segmented<Settings["foldedStyle"]>(t("s.isl.folded"), [["thread", t("s.isl.line")], ["capsule", t("s.isl.capsule")]], settings.foldedStyle, (v) => {
    change({ foldedStyle: v });
    paintPreview(false);
  });
  // The thread's colour: each session's own, or one of the user's.
  const ownThread = () => /^#[0-9a-f]{6}$/i.test(settings.threadColor);
  const threadInput = h("input", { type: "color", value: ownThread() ? settings.threadColor : "#f4aa86", "aria-label": t("s.isl.lineColor") });
  const threadFold = h("div", { class: `sp-fold${ownThread() ? " open" : ""}` }, h("div", {}, threadInput));
  const threadColor = segmented<"session" | "own">(t("s.isl.lineColor"), [["session", t("s.isl.neutral")], ["own", t("s.isl.pick")]], ownThread() ? "own" : "session", (v) => {
    threadFold.classList.toggle("open", v === "own");
    change({ threadColor: v === "own" ? threadInput.value : "" });
    paintPreview(false);
  });
  threadInput.addEventListener("input", () => {
    change({ threadColor: threadInput.value });
    paintPreview(false);
  });
  const autostart = toggle(settings.autostart, t("s.isl.autostart"), (on) => change({ autostart: on }));

  // When it closes and hides.
  const clamp = (v: number) => Math.max(2, Math.min(120, Math.round(v) || 15));
  const custom = h("input", { type: "number", min: "2", max: "120", step: "1", value: String(clamp(settings.autoCloseInterval)), "aria-label": t("s.isl.closeAria") });
  custom.addEventListener("change", () => {
    const seconds = clamp(Number(custom.value));
    custom.value = String(seconds);
    change({ autoCloseInterval: seconds });
  });
  const picked = (): AutoClose => (autoCloseCustom ? "custom" : autoClosePreset());
  autoCloseCustom = autoClosePreset() === "custom";
  const customFold = h("div", { class: `sp-fold${picked() === "custom" ? " open" : ""}` },
    h("div", {}, h("label", { class: "sp-number" }, custom, h("span", { text: t("s.isl.seconds") }))));
  const autoClose = segmented<AutoClose>(t("s.isl.closeAfter"), AUTO_CLOSE.map((v) => [v, v === "custom" ? t("s.isl.other") : `${v} s`] as const), picked(), (v) => {
    autoCloseCustom = v === "custom";
    customFold.classList.toggle("open", autoCloseCustom);
    // Other starts from the time in use: nothing changes until another number is typed.
    if (autoCloseCustom) custom.value = String(clamp(settings.autoCloseInterval));
    else change({ autoCloseInterval: Number(v) });
  });

  const hideAfterOf = (): HideAfter => String(foldedAutoHide(settings)) as HideAfter;
  const neverFold = h("div", { class: `sp-fold${hideAfterOf() === "0" ? " open" : ""}` }, h("div", {}, h("p", { class: "sp-note", text: ALWAYS_SHOWN_NOTE })));
  const hideAfter = segmented<HideAfter>(t("s.isl.hideAfter"), FOLDED_AUTO_HIDE.map((v) => [String(v) as HideAfter, HIDE_AFTER_WORDS[String(v) as HideAfter]] as const), hideAfterOf(), (v) => {
    neverFold.classList.toggle("open", v === "0");
    change({ foldedAutoHide: Number(v) });
  });
  const whenIdle = toggle(settings.hideOnlyWhenIdle, t("s.isl.whenIdle"), (on) => change({ hideOnlyWhenIdle: on }));
  const fullscreen = toggle(settings.hideInFullscreen, t("s.isl.fullscreen"), (on) => change({ hideInFullscreen: on }));
  const finished = segmented<FinishedNotice>(t("s.isl.finished"), [["mark", t("s.isl.markOnly")], ["card", t("s.isl.card")]], finishedNotice(settings), (v) => change({ finishedNotice: v }));
  const weather = weatherPicker((location) => change({ weatherLocation: location }));
  weather.paint(settings.weatherLocation);

  // The island's own quick settings change the auto-close too.
  let seconds = settings.autoCloseInterval;
  followers.push(() => {
    if (settings.autoCloseInterval !== seconds) {
      seconds = settings.autoCloseInterval;
      autoCloseCustom = autoClosePreset() === "custom";
      if (document.activeElement !== custom) custom.value = String(clamp(seconds));
    }
    autoClose.set(picked());
    customFold.classList.toggle("open", picked() === "custom");
    screen.set(settings.screen);
    dock.set(settings.dock);
    foldedStyle.set(settings.foldedStyle);
    threadColor.set(ownThread() ? "own" : "session");
    threadFold.classList.toggle("open", ownThread());
    if (ownThread() && document.activeElement !== threadInput) threadInput.value = settings.threadColor;
    autostart.set(settings.autostart);
    hideAfter.set(hideAfterOf());
    neverFold.classList.toggle("open", hideAfterOf() === "0");
    whenIdle.set(settings.hideOnlyWhenIdle);
    fullscreen.set(settings.hideInFullscreen);
    finished.set(finishedNotice(settings));
    weather.paint(settings.weatherLocation);
    metricPicker.paint(false);
  });

  return [
    head("island"),
    group(null,
      row(t("s.lang.title"), t("s.lang.help"), h("label", { class: "sp-select-wrap" }, language), "language idioma lingua english spanish portuguese español português")),
    group(t("s.isl.position"),
      stackRow(t("s.isl.screen"), t("s.isl.screenHelp"),
        "screen display monitor second screen multiple main primary pointer mouse", screen.el),
      stackRow(t("s.isl.edge"), t("s.isl.edgeHelp"),
        "position edge top bottom left right side move place taskbar dock where", dock.el),
      stackRow(t("s.isl.folded"), t("s.isl.foldedHelp"),
        "folded compact thread line capsule peek tabs click through cover style look", foldedStyle.el),
      stackRow(t("s.isl.lineColor"), t("s.isl.lineColorHelp"),
        "thread line colour color bar stripe accent custom", threadColor.el, threadFold),
      row(t("s.isl.autostart"), t("s.isl.autostartHelp"), autostart.el,
        "startup start up launch login log in sign in boot automatically autostart open")),
    group(t("s.isl.when"),
      stackRow(t("s.isl.closeAfter"), t("s.isl.closeHelp"),
        "close auto-close timer seconds stay open delay", autoClose.el, customFold),
      stackRow(t("s.isl.hideAfter"), t("s.isl.hideHelp"),
        "hide auto-hide autohide compact folded small closed disappear timer never always visible", hideAfter.el, neverFold),
      row(t("s.isl.whenIdle"), t("s.isl.whenIdleHelp"), whenIdle.el,
        "busy working active idle keep visible hide thinking"),
      row(t("s.isl.fullscreen"), t("s.isl.fullscreenHelp"), fullscreen.el,
        "full screen fullscreen video game presentation movie hide")),
    group(t("s.isl.notices"),
      stackRow(t("s.isl.finished"), t("s.isl.finishedHelp"),
        "notify notification finished done end turn card mark badge chip popup open alert tarjeta marca aviso terminar", finished.el)),
    group(t("s.isl.weather"), stackRow(t("s.isl.location"), t("s.isl.locationHelp"),
      "clima weather temperatura ubicación ciudad pronóstico", weather.el)),
    findable(bare(h("span", { class: "sp-label-row" }, t("s.isl.content"), metricPicker.count),
      h("div", { class: "sp-box" },
        metricPicker.list,
        metricPicker.refusal,
        h("p", { class: "sp-note", text: t("s.isl.contentNote") }))),
    t("s.isl.content"), t("s.isl.contentFind"),
    "metrics numbers stats cpu processor gpu graphics ram memory usage limits weekly waiting sessions show", true),
    resetFoot("island"),
  ];
}

// ── Look and colours ──────────────────────────────────────────────────────────

/** The mascot: a card per one Oleo has, each one alive in its card. */
function mascotPicker(): HTMLElement {
  const ids = Object.keys(MASCOTS).filter(isMascot);
  const cards = h("div", { class: "sp-mascots", role: "radiogroup", "aria-label": t("s.look.mascot") });
  const worn = () => (isMascot(settings.botMascot) ? settings.botMascot : DEFAULT_MASCOT);
  const buttons = ids.map((id) => {
    const bot = mountBot(56, id);
    const b = h("button", { class: "sp-mascot", type: "button", role: "radio", "aria-label": MASCOTS[id].label },
      bot.el, h("span", { class: "sp-mascot-name", text: MASCOTS[id].label }));
    b.addEventListener("click", () => pick(id));
    return b;
  });
  const paint = () => {
    buttons.forEach((b, i) => {
      const on = ids[i] === worn();
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  const pick = (id: MascotId) => {
    if (id !== worn()) change({ botMascot: id });
    paint();
  };
  cards.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const to = (ids.indexOf(worn()) + step + ids.length) % ids.length;
    pick(ids[to]);
    buttons[to].focus();
  });
  cards.append(...buttons);
  paint();
  followers.push(paint);
  return stackRow(t("s.look.mascot"), t("s.look.mascotHelp"),
    "mascota mascot character bot durazno pet buddy", cards);
}

function lookSection(): Kid[] {
  const themeHelp = h("p", { class: "sp-help" });
  const writeHelp = () => {
    // Asked of the system only while following it: a picked theme answers for itself.
    themeHelp.textContent = settings.theme === "system"
      ? (systemDark.matches ? t("s.theme.followsDark") : t("s.theme.followsLight"))
      : t("s.look.alwaysDark");
  };
  const theme = segmented<Theme>(t("s.look.colors"), [["light", t("s.look.light")], ["dark", t("s.look.dark")], ["system", t("s.look.system")]], settings.theme, (v) => {
    change({ theme: v });
    writeHelp();
  });
  const motion = segmented<Motion>(t("s.look.reduce"), [["system", t("s.look.system")], ["on", t("s.st.on")], ["off", t("s.st.off")]], settings.reduceMotion, (v) => change({ reduceMotion: v }));
  const playful = toggle(settings.playfulReactions !== false, t("s.look.playful"), (on) => change({ playfulReactions: on }));
  writeHelp();
  followers.push(() => {
    theme.set(settings.theme);
    motion.set(settings.reduceMotion);
    playful.set(settings.playfulReactions !== false);
    writeHelp();
  });
  return [
    head("look"),
    group(t("s.look.mascot"),
      mascotPicker(),
      row(t("s.look.playful"), t("s.look.playfulHelp"), playful.el,
        "playful reactions animation mouse fun mascot character bot")),
    group(t("s.look.window"),
      findable(h("div", { class: "sp-row stack" },
        h("div", { class: "sp-row-text" }, h("div", { class: "sp-row-label", text: t("s.look.colors") }), themeHelp),
        theme.el),
      t("s.look.colors"), t("s.look.colorsFind"),
      "dark mode light mode theme colours colors night appearance window black white")),
    group(t("s.look.motion"),
      stackRow(t("s.look.reduce"), t("s.look.reduceHelp"),
        "animation animations motion reduce accessibility movement still effects calm", motion.el)),
    resetFoot("look"),
  ];
}

// ── Shelf ─────────────────────────────────────────────────────────────────────

/** The Shelf's six widgets: what each is called, its colour, its mark, and what it will be. The ids are Rust's (settings.rs `SHELF_WIDGETS`). */
const WIDGETS = {
  media: { name: t("w.media"), accent: "#34D399", about: t("s.shelf.media"),
    icon: LUCIDE.music },
  todo: { name: t("w.todo"), accent: "#FACC15", about: t("s.shelf.todo"),
    icon: LUCIDE.listTodo },
  timer: { name: t("w.timer"), accent: "#F5A524", about: t("s.shelf.timer"),
    icon: LUCIDE.timer },
  reminders: { name: t("w.reminders"), accent: "#F472B6", about: t("s.shelf.reminders"),
    icon: LUCIDE.bell },
  mirror: { name: t("w.mirror"), accent: "#22D3EE", about: t("s.shelf.mirror"),
    icon: LUCIDE.camera },
  projects: { name: t("w.projects"), accent: "#3B9EFF", about: t("s.shelf.projects"),
    icon: LUCIDE.folder },
};
type WidgetId = keyof typeof WIDGETS;
const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];
const isWidget = (id: string): id is WidgetId => id in WIDGETS;

/** The order as the settings have it, held to the six: each once, what is missing at the end. As Rust keeps it. */
function shelfOrder(): WidgetId[] {
  const said = Array.isArray(settings.shelfOrder) ? settings.shelfOrder.filter(isWidget) : [];
  return [...new Set([...said, ...WIDGET_IDS])];
}
const shelfHidden = (): Set<WidgetId> => new Set(Array.isArray(settings.shelfHidden) ? settings.shelfHidden.filter(isWidget) : []);

/** The shelf's cards in their order: made once, repainted in place. */
const shelfPicker = (() => {
  // The island's black, and the dark tokens with it, whatever the window's theme.
  const tray = h("div", { class: "sp-tray sp-dark", role: "list", "aria-label": t("s.shelf.trayAria") });
  const count = h("span", { class: "count" });
  const cards = new Map<WidgetId, { el: HTMLElement; shown: Toggle }>();

  /** Shown ones in their order, then the hidden ones. */
  const order = () => {
    const hidden = shelfHidden();
    return [...shelfOrder().filter((id) => !hidden.has(id)), ...shelfOrder().filter((id) => hidden.has(id))];
  };

  const paint = (animate = true) => {
    const ids = order();
    const hidden = shelfHidden();
    const shown = ids.length - hidden.size;
    flip(tray, () => {
      ids.forEach((id, i) => {
        const card = cards.get(id)!;
        const off = hidden.has(id);
        card.el.classList.toggle("hidden", off);
        if (off) card.el.dataset.fixed = "";
        else delete card.el.dataset.fixed;
        card.shown.set(!off);
        card.el.setAttribute("aria-label", off
          ? t("s.shelf.hiddenAria", { name: WIDGETS[id].name })
          : t("s.shelf.posAria", { name: WIDGETS[id].name, n: i + 1, of: shown }));
        tray.append(card.el);
      });
    }, !animate || still());
    count.textContent = t("s.shelf.count", { n: shown, of: ids.length });
  };

  for (const id of WIDGET_IDS) {
    const def = WIDGETS[id];
    const shown = toggle(true, t("s.shelf.show", { name: def.name }), (on) => {
      const hidden = shelfHidden();
      if (on) hidden.delete(id);
      else hidden.add(id);
      change({ shelfHidden: WIDGET_IDS.filter((x) => hidden.has(x)) });
      paint();
      say(on ? t("s.shelf.shown", { name: def.name }) : t("s.shelf.hidden", { name: def.name }));
    });
    const el = h("div", { class: "sp-card", role: "listitem", tabindex: "0", "data-id": id, style: `--c:${def.accent}` },
      h("span", { class: "sp-mark" }, icon(def.icon, 15, 2.2)),
      h("div", { class: "sp-card-text" }, h("b", { text: def.name }), h("p", { text: def.about })),
      shown.el);
    el.addEventListener("keydown", (e) => {
      const hidden = shelfHidden();
      if (e.target !== el || hidden.has(id)) return;
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const on = order().filter((x) => !hidden.has(x));
      const at = on.indexOf(id);
      const to = at + step;
      if (to < 0 || to >= on.length) return;
      on.splice(at, 1);
      on.splice(to, 0, id);
      change({ shelfOrder: [...on, ...order().filter((x) => hidden.has(x))] });
      paint();
      el.focus();
      say(t("s.position", { name: def.name, n: to + 1, of: on.length }));
    });
    cards.set(id, { el, shown });
  }

  reorderable(tray, {
    item: ".sp-card",
    ignore: ".sp-toggle",
    still,
    onDrop: (ids) => {
      const next = [...new Set([...ids.filter(isWidget), ...WIDGET_IDS])];
      if (next.join() !== order().join()) change({ shelfOrder: next });
      paint();
    },
  });

  paint(false);
  return { tray, count, paint };
})();

function shelfSection(): Kid[] {
  followers.push(() => shelfPicker.paint(false));
  return [
    head("shelf"),
    h("div", { class: "sp-flash note sp-intro", role: "note" }, icon(LUCIDE.info, 15),
      h("span", { text: t("s.shelf.intro") })),
    findable(bare(h("span", { class: "sp-label-row" }, "Widgets", shelfPicker.count),
      shelfPicker.tray,
      h("p", { class: "sp-note", text: t("s.shelf.note") })),
    "Widgets", t("s.shelf.find"),
    "shelf widgets widget media music player to-do todo tasks timer countdown reminders mirror camera projects folders order hide", true),
    resetFoot("shelf"),
  ];
}

// ── About ─────────────────────────────────────────────────────────────────────

/**
 * The owner's links. What is written here is only what the row says: the
 * address each one opens is a constant in Rust (about.rs), picked by its id.
 */
const LINKS: readonly { which: AboutLink; name: string; where: string; mark: () => SVGSVGElement }[] = [
  { which: "github", name: "GitHub", where: "github.com/icarlocl", mark: () => brand(BRANDS.github, 16) },
];

/**
 * Updates: the one thing Oleo uses the internet for, and only on the user's
 * say — the switch (a check a day) or the button (a check now). What a check
 * found is said here; the island says it too while the switch is on.
 */
function updatesGroup(): HTMLElement {
  const auto = toggle(settings.checkUpdates, t("s.upd.daily"), (on) => change({ checkUpdates: on }));
  followers.push(() => auto.set(settings.checkUpdates));
  const status = h("p", { class: "sp-help", role: "status" });
  const check = button(t("s.upd.now"), "quiet", () => void run());
  const get = button(t("s.upd.get"), "primary", () => void oleo.updateOpen());
  let found: UpdateInfo | null = null;
  let busy = false;
  let failed: string | null = null;

  const paint = () => {
    get.style.display = found?.available && !busy ? "" : "none";
    check.disabled = busy;
    check.textContent = busy ? t("s.upd.checking") : t("s.upd.now");
    status.classList.toggle("sp-danger-text", failed != null);
    status.textContent = failed
      ?? (busy ? t("s.upd.asking")
        : !found ? t("s.upd.never")
          : found.available ? t("s.upd.out", { v: found.latest })
            : `${t("s.upd.latest")}${found.checkedAt ? ` ${t("s.upd.checked", { when: new Date(found.checkedAt).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) })}` : ""}`);
  };
  async function run() {
    if (busy) return;
    busy = true;
    failed = null;
    paint();
    try {
      found = await oleo.updateCheck();
    } catch (err) {
      failed = reason(err) || t("s.upd.failed");
    }
    busy = false;
    paint();
  }
  void oleo.updateLast().then((last) => {
    if (last && !busy) found = last;
    paint();
  });
  paint();

  return group(t("s.upd.group"),
    row(t("s.upd.daily"),
      t("s.upd.dailyHelp"),
      auto.el, "update updates upgrade new version automatic auto check daily github release internet network"),
    findable(h("div", { class: "sp-row" },
      rowText(version ? t("s.upd.have", { v: version }) : t("s.upd.this"), null, status),
      h("div", { class: "sp-update-actions" }, get, check)),
    t("s.upd.now"), t("s.upd.nowFind"), "update updates check now latest version download upgrade"));
}

function aboutSection(): Kid[] {
  const place = (label: string, help: string, path: string | undefined, keys: string, open: () => void) =>
    findable(h("div", { class: "sp-row stack sp-place" },
      h("div", { class: "sp-place-top" }, rowText(label, help), button(t("s.about.openFolder"), "quiet", open)),
      h("div", { class: "sp-path" }, ...(path ? breakable(path) : ["—"]))), label, help, keys);
  const link = ({ which, name, where, mark }: (typeof LINKS)[number]) =>
    h("button", {
      class: "sp-social", type: "button", title: where,
      "aria-label": t("s.about.linkAria", { name, where }), onclick: () => void oleo.openLink(which),
    }, h("i", {}, mark()), h("span", { text: name }));
  return [
    head("about"),
    h("div", { class: "sp-about" },
      h("div", { class: "sp-oleo", "aria-hidden": "true" }, aboutBot.el),
      h("div", {},
        h("p", { class: "sp-about-name", text: "Oleo" }),
        h("p", { class: "sp-about-version", text: version ? t("s.version", { v: version }) : "" }),
        h("p", { class: "sp-about-version", text: t("s.about.with") }))),
    updatesGroup(),
    findable(bare(t("s.about.privacy"),
      h("div", { class: "sp-box sp-privacy" },
        icon(LUCIDE.circleCheck, 18, 2),
        h("p", { text: t("s.about.privacyText") }))),
    t("s.about.privacy"), t("s.about.privacyFind"),
    "privacy private telemetry tracking data network internet offline online send", true),
    group(t("s.about.where"),
      place(t("s.about.settings"), t("s.about.settingsHelp"), paths?.settings, "files folder location data settings where stored path open explorer",
        () => void oleo.openSettingsFolder()),
      place(t("s.about.logs"), t("s.about.logsHelp"), paths?.local, "logs log folder files helper relay location open explorer",
        () => void oleo.openLogFolder()),
      ...(paths?.relayError ? [h("p", { class: "sp-help sp-danger-text", text: t("s.about.relayError", { why: paths.relayError }) })] : []),
    ),
    findable(bare(t("s.about.madeBy"),
      h("div", { class: "sp-credit" },
        h("p", { class: "sp-made", text: "Franco Ruiz" }),
        h("div", { class: "sp-links", role: "group", "aria-label": t("s.about.links") }, ...LINKS.map(link))),
      h("p", { class: "sp-credits", text: t("s.about.license") })),
    t("s.about.madeBy"), t("s.about.madeFind"),
    "author made by credits github linkedin website portfolio contact licence license open source", true),
  ];
}

// ── Putting a category on show ────────────────────────────────────────────────

const BUILD: Record<Section, () => Kid[]> = {
  connect: connectSection, island: islandSection, look: lookSection, sounds: soundsSection,
  agents: agentsSection, shortcuts: shortcutsSection, shelf: shelfSection, about: aboutSection,
};

/**
 * What a category does when it comes on show; what it returns, it does when
 * it goes. Connect reads the files again, and forgets an open diff when left —
 * as it always has. The island and Look carry the live preview between them.
 */
const ENTER: Partial<Record<Section, () => (() => void) | void>> = {
  connect: () => {
    void refreshClaude();
    return () => {
      // What was said of the last change, or an open diff, does not wait for the next visit.
      for (const kind of CHANGES) flows[kind] = { at: "status" };
      paintClaude();
    };
  },
  island: () => {
    metricPicker.refuse(null);
    metricPicker.paint(false);
    heads.get("island")!.after(folded.el);
    return folded.run();
  },
  look: () => {
    paintPreview(false);
    heads.get("look")!.after(folded.el);
    return folded.run();
  },
};

const panes = new Map<Section, HTMLElement>();
let shownPane: HTMLElement | null = null;
let leaving: (() => void) | null = null;
const leaveTimers = new Map<HTMLElement, number>();

function setSection(next: Section, animate = true) {
  if (query) clearSearch();
  const pane = panes.get(next);
  if (!pane || (next === section && shownPane === pane)) return;
  leaving?.();
  leaving = null;
  const old = shownPane;
  section = next;
  shownPane = pane;

  window.clearTimeout(leaveTimers.get(pane));
  pane.classList.remove("leaving");
  pane.inert = false;
  pane.hidden = false;
  pane.scrollTop = 0;
  leaving = ENTER[next]?.() ?? null;
  if (old && animate && !still()) {
    // The one leaving fades under the one arriving, then hides.
    old.classList.remove("entering");
    old.classList.add("leaving");
    old.inert = true;
    leaveTimers.set(old, window.setTimeout(() => {
      old.hidden = true;
      old.classList.remove("leaving");
      old.inert = false;
    }, 140));
    replay(pane, "entering");
  } else if (old) {
    old.hidden = true;
  }
  paintTabs();
  refreshBots();
}

// ── Go ────────────────────────────────────────────────────────────────────────

async function start() {
  oleo = await connect();
  const [boot, , statuses, where] = await Promise.all([oleo.boot(), readClaude(), oleo.shortcutStatus(), oleo.dataPaths()]);
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  // The words were written in the language this window last had: another one now, and it opens again in it.
  if (setLanguage(settings.language)) return reopen();
  document.title = t("s.window");
  let reopened: string | null = null;
  try {
    reopened = sessionStorage.getItem(REOPEN_AT);
    sessionStorage.removeItem(REOPEN_AT);
  } catch {
    // Nothing kept: the first category.
  }
  shortcutsNow = statuses;
  paths = where;
  applyAppearance();
  versionLine.textContent = version ? t("s.version", { v: version }) : "";

  // Every category, built once: the search finds a row in any of them.
  for (const id of SECTIONS) {
    building = id;
    const pane = h("div", { class: "sp-pane", id: `pane-${id}`, role: "tabpanel", "aria-labelledby": `tab-${id}`, hidden: true }, ...BUILD[id]());
    panes.set(id, pane);
    main.append(pane);
  }
  main.append(results);

  clear(root);
  app.append(
    h("nav", { class: "sp-side", "aria-label": t("s.about.settings") },
      h("div", { class: "sp-brand" },
        h("div", { class: "sp-oleo", "aria-hidden": "true" }, sideBot.el),
        h("div", { class: "sp-brand-text" }, h("b", { text: "Oleo" }), versionLine)),
      searchBox, searchOpen,
      nav,
      oleo.fake ? h("div", { class: "sp-fake", text: t("s.fake"), title: t("s.fakeTip") }) : null),
    main);
  root.append(app, live);
  setSection(sectionNamed(oleo.start) ?? sectionNamed(reopened) ?? "connect", false);
  paintResets();
  startBots(still);

  oleo.onSettingsChanged(settingsChanged);
  systemDark.addEventListener("change", () => {
    applyAppearance();
    follow();
  });
  systemStill.addEventListener("change", applyAppearance);
  // The window lives hidden between two looks at it: what it shows of
  // settings.json is read again when it comes back.
  window.addEventListener("focus", () => void refreshClaude());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshClaude();
  });

  if (oleo.fake) await fakeStates();
}

/**
 * The made-up window only: a state to start in, said in the address, so every
 * page can be looked at — and captured — as it is: `details=hooks` opens a
 * Connect part's Details, `diff=hooks` its diff, `reset=armed` arms the reset
 * of the category on show, `q=volume` searches. `window.__shotReady` says the
 * page is drawn (scripts/shot.mjs waits for it).
 */
async function fakeStates() {
  const q = new URLSearchParams(location.search);
  const kind = (name: string | null): Change | null => (CHANGES as readonly string[]).includes(name ?? "") ? (name as Change) : null;
  const open = kind(q.get("details"));
  if (open) {
    detailsOpen[open] = true;
    painters[open]?.();
  }
  const diff = kind(q.get("diff"));
  if (diff) await openPreview(diff, q.get("install") !== "0");
  if (q.get("reset") === "armed") resetArmers.get(section)?.();
  const text = q.get("q");
  if (text) {
    searchInput.value = text;
    app.classList.add("search-open");
    runSearch(text);
  }
  await document.fonts.ready;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    (window as unknown as { __shotReady?: boolean }).__shotReady = true;
  }));
}

void start();
