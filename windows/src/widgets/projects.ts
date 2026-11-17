// Projects: the folders Claude Code sessions have run in, most recent first.
// On the shelf it is a shortcut with how many folders there are. Expanded: all of
// them, each with "Open in VS Code" and "New Claude session", which opens Windows
// Terminal running `claude` there.
//
// The list is Rust's (src-tauri/src/projects.rs): a folder is added when a
// session's hook event names it, at most 30, and one that no longer exists is
// not shown. This page only draws it and names a folder to launch; Rust
// launches it only if it is on its own list, with the path as one argument and
// never through a shell. The list is asked for once when the Shelf comes on
// show, and again no more than every ten seconds while it stays.

import { currentLang, t } from "../core/i18n";
import { clear, h } from "../views/dom";
import { ICONS } from "../views/icons";
import type { ProjectInfo } from "../core/bridge";
import { ShelfBackend } from "./backend";
import { notifyShelf } from "./core";
import { widgetOn } from "./defs";
import { frame, setIcon, type Widget, type WidgetContext } from "./ui";

/** The list is not asked for again sooner than this while the Shelf stays on show. */
const STALE_MS = 10_000;
/** What a button says, for a moment, after it was pressed. */
const SAID_MS = 1400;

const CODE = "M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5";

const state = {
  list: [] as ProjectInfo[],
  asked: 0,
  inflight: false,
  /** The last button pressed, what came of it, and when. */
  said: { path: "", kind: "" as "" | "code" | "claude", ok: true, at: 0 },
};

/** A session was seen running in this folder: Rust keeps it, if it could launch it. Said once per folder, as long as Oleo runs. */
const noted = new Set<string>();
export function rememberProject(cwd: string) {
  if (!cwd || noted.has(cwd) || !widgetOn("projects")) return;
  noted.add(cwd);
  void ShelfBackend.projects.note(cwd).then(() => {
    // What is on show is asked for again at the next tick.
    state.asked = 0;
  });
}

async function refresh() {
  if (state.inflight || Date.now() - state.asked < STALE_MS) return;
  state.inflight = true;
  state.asked = Date.now();
  try {
    state.list = await ShelfBackend.projects.list();
  } finally {
    state.inflight = false;
  }
  notifyShelf();
}

async function launch(p: ProjectInfo, kind: "code" | "claude") {
  const ok = kind === "code" ? await ShelfBackend.projects.openInCode(p.path) : await ShelfBackend.projects.newSession(p.path);
  state.said = { path: p.path, kind, ok, at: Date.now() };
  notifyShelf();
  // The button is itself again a moment later.
  window.setTimeout(notifyShelf, SAID_MS + 50);
}

const saying = (p: ProjectInfo, kind: "code" | "claude") =>
  state.said.path === p.path && state.said.kind === kind && Date.now() - state.said.at < SAID_MS;

/** "just now", "5 min ago", "yesterday", "3 d ago". */
export function agoText(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("w.ago.min", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("w.ago.h", { n: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("w.ago.yesterday");
  return days < 14 ? t("w.ago.d", { n: days }) : t("w.ago.w", { n: Math.round(days / 7) });
}

export function buildProjects(ctx: WidgetContext): Widget {
  /** A button that says what it did for a moment after it is pressed. */
  const launcher = (p: ProjectInfo, kind: "code" | "claude", label: string, title: string) => {
    const btn = h("button", { class: "chip-btn launch", title, onclick: () => void launch(p, kind) });
    const markEl = h("span", { class: "launch-icon" });
    const done = saying(p, kind);
    const ok = state.said.ok;
    btn.classList.toggle("done", done && ok);
    btn.classList.toggle("failed", done && !ok);
    setIcon(markEl, done ? (ok ? ICONS.check : ICONS.xmark) : kind === "code" ? CODE : ICONS.terminal, 11, done ? 3 : 2.2);
    const words = done && !ok ? (kind === "code" ? t("w.proj.noCode") : t("w.proj.noTerminal")) : label;
    btn.append(markEl, h("span", { text: words }));
    return btn;
  };

  // No small card: the projects are a shortcut on the shelf, with how many folders there are.
  // Expanded: every folder, and a new Claude session in each.
  const note = h("div", { class: "fc-note", text: () => t("w.proj.note") });
  const list = h("div", { class: "gh-list fc-list", "aria-label": () => t("w.proj.list") });
  const count = h("span", { class: "fc-aside" });
  const body = h("div", { class: "fc-col" }, list, note);

  let shown: string | null = null;
  function paint() {
    const items = state.list;
    count.textContent = t("w.proj.count", { count: items.length });
    const key = items.map((p) => `${p.path}${p.at}${saying(p, "code") ? "c" : ""}${saying(p, "claude") ? "n" : ""}`).join("|")
      + (state.said.ok ? "" : "!");
    // The words ("5 min ago") grow old by themselves: the lines are drawn again when a minute has gone, as the rest changes.
    const minute = Math.floor(Date.now() / 60_000);
    const full = `${key}@${minute}${currentLang()}`;
    if (full === shown) return;
    shown = full;

    clear(list);
    items.forEach((p) => {
      list.append(h("div", { class: "gh-row proj-row" },
        h("div", { class: "proj-who" },
          h("div", { class: "proj-name" },
            h("b", { text: p.name }),
            h("span", { class: "int-ago", text: agoText(p.at) })),
          h("div", { class: "gh-sub path", text: p.path, title: p.path })),
        launcher(p, "code", t("w.proj.openCode"), t("w.proj.openTip", { name: p.name })),
        launcher(p, "claude", t("w.proj.newSession"), t("w.proj.newSessionTip", { name: p.name }))));
    });
    if (items.length === 0) list.append(h("div", { class: "wmini-none", text: t("w.proj.empty") }));
  }

  return {
    id: "projects",
    card: frame("projects", body, ctx.back, count),
    paint,
    // Once a second while the Shelf is on show; the list is asked for no more than every STALE_MS.
    tick: () => void refresh(),
    // A list of places to go to, not something going on: always a shortcut, with how many folders it holds.
    live: () => false,
    shortcut: () => ({ label: t("w.projects"), note: state.list.length ? String(state.list.length) : "" }),
  };
}
