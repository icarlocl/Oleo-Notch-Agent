// The Shelf (plans/tabs-plan.md §2): the island's second tab, a mosaic. What has
// something going on stands as a small card — up to three side by side — and
// every other widget is a chip in a row of shortcuts under them; on a side dock
// the cards are a column that scrolls up and down, with the chips after it.
// Each widget is one thing in two sizes: the small card works where it stands,
// and the expanded view — the card, or the chip, morphing into it — is the same
// state with more in it (src/widgets/).
//
// Which widget is a card and which a chip is decided when the Shelf comes on
// show, from what each one says it has (`Widget.live`), in the order Settings
// gives. While it stays on show nothing that is a card is taken away — it would
// leave under the pointer — and what starts to have something takes a free
// place, if there is one.
//
// Nothing here runs on its own. The mosaic is drawn when that changes; a
// widget is painted when it changes or when the Shelf comes on show; and while
// it is on show, one timer ticks once a second for what grows old by itself.
// With the Shelf off the screen — another tab, a card over it, the island
// folded or hidden — the timer is gone, and every widget has been told to let
// go of whatever it holds open (the camera).
//
// The Shelf does not own the island's size: an expanded widget says how large
// it wants the island (`width`, `height`), and the island's own spring does it.

import { Bridge } from "../core/bridge";
import { onLangChange, t } from "../core/i18n";
import { Spring, clamp } from "../core/anim";
import { Room, SHELF_CARD_GAP, SHELF_CARD_H, SHELF_CARD_W, SHELF_CHIPS_H, sideDock } from "../core/layout";
import { State } from "../core/state";
import { BUILDERS } from "../widgets";
import { flushWidgets, onShelfChange } from "../widgets/core";
import { SHELF_WIDGETS, WIDGET_IDS, expandedSize, shelfWidgets, type ShelfWidgetId } from "../widgets/defs";
import { enableGestures } from "../widgets/gestures";
import { CONTROL, chip, type ShelfChip, type Widget, type WidgetContext } from "../widgets/ui";
import { clear, h } from "./dom";
import type { ViewActions, ViewHost } from "./views";

export { SHELF_WIDGETS, shelfWidgets };
export type { ShelfWidgetId };

/** How long a card is held before it lifts to be moved (plans/tabs-plan.md §2). */
const LONG_PRESS_MS = 350;

/** At most this many widgets stand as cards, side by side; the others are chips. */
const MAX_CARDS = 3;

/** Who stands as a card and who as a chip, each in the order Settings gives. */
interface Mosaic {
  cards: ShelfWidgetId[];
  chips: ShelfWidgetId[];
  /** The one card is the timer, standing ready because nothing is going on: it is not kept once something is. */
  ready: boolean;
}

/** What the Shelf names for one shared-element transition (see `Shelf` below and the island's `morph`). */
export interface MorphNames {
  /** The side being left: its shared elements get their names. */
  before(): void;
  /** The side being entered, once the page has changed. */
  after(): void;
  /** The transition is over: every name is taken off. */
  clear(): void;
}

/** What the island asks of the Shelf, beyond a view's own. */
export interface ShelfHost extends ViewHost {
  /** The expanded widget, or null on the row. */
  readonly focused: ShelfWidgetId | null;
  /** The island's bar steps aside for an expanded widget. */
  readonly bare: boolean;
  /** Back to the row, with the morph: Escape, Backspace, a swipe to the right. False when there was nothing to go back from. */
  closeWidget(): boolean;
  /** A timer ran out, a reminder is due: the widget is expanded at once, with no morph. */
  showWidget(id: ShelfWidgetId): void;
  /** The Shelf is on show, or is not: what ticks is started, or stopped, and every widget told. */
  visible(on: boolean): void;
  /** The island folds: the expanded widget goes back to the row, unseen, and the keyboard is let go. */
  leave(): void;
}

// ── The spring of a shared-element transition ─────────────────────────────────
// The browser draws the morph from an easing function, not a spring. The island's
// own spring (anim.ts, response 0.5, damping 0.72) is run once from 0 to 1 and
// written out as a `linear()` easing, so a card grows into a widget exactly as
// the island grows between views.

let curveMade = false;

export function ensureMorphCurve() {
  if (curveMade) return;
  curveMade = true;
  const spring = new Spring(0);
  spring.target = 1;
  const step = 1 / 120;
  const samples = [0];
  let t = 0;
  while (t < 1.5) {
    spring.step(step);
    t += step;
    samples.push(spring.value);
    if (Math.abs(1 - spring.value) < 0.0015 && Math.abs(spring.velocity) < 0.02) break;
  }
  samples[samples.length - 1] = 1;
  const root = document.documentElement;
  root.style.setProperty("--vt-spring", `linear(${samples.map((v) => clamp(v, -1, 2).toFixed(4)).join(", ")})`);
  root.style.setProperty("--vt-spring-ms", `${Math.round(t * 1000)}ms`);
}

// ── The row, scrolled by hand ─────────────────────────────────────────────────

/**
 * The row runs up and down on a side dock, where the Shelf is a column
 * (style.css), and sideways on the others: everything that scrolls it by hand
 * asks which, here.
 */
const upright = () => sideDock(Room.dock);

/** How far the row is scrolled along its own axis. */
const scrolled = (row: HTMLElement) => (upright() ? row.scrollTop : row.scrollLeft);

function scrollRowTo(row: HTMLElement, at: number) {
  if (upright()) row.scrollTop = at;
  else row.scrollLeft = at;
}

/** The row's scroll along its own axis, in the three numbers island/swipe.ts `canScroll` reads. */
export function rowScroll(row: HTMLElement): { scrollLeft: number; scrollWidth: number; clientWidth: number } {
  if (!upright()) return row;
  return { scrollLeft: row.scrollTop, scrollWidth: row.scrollHeight, clientWidth: row.clientHeight };
}

/**
 * The row scrolled by hand. The island moves it itself, by the travel of each
 * wheel event (island.ts `swipeTabs`, `wheelUpright`): left to the browser, a
 * wheel event goes to whatever was under the pointer before the view changed,
 * and scrolls nothing until the pointer moves. While it is moved so, the row
 * does not snap (`.swiping`): each small step would be pulled back to the card it left.
 */
export function scrollRow(row: HTMLElement, by: number) {
  row.classList.add("swiping");
  scrollRowTo(row, scrolled(row) + by);
}

/** The gesture has paused: the row comes to rest on a card, as it does when the browser scrolls it. */
export function settleRow(row: HTMLElement, still: boolean) {
  if (!row.classList.contains("swiping")) return;
  const step = (upright() ? SHELF_CARD_H : SHELF_CARD_W) + SHELF_CARD_GAP;
  const { scrollWidth, clientWidth } = rowScroll(row);
  const now = scrolled(row);
  const max = Math.max(0, scrollWidth - clientWidth);
  // The nearest card's edge — or the row's end, when that is nearer than the last edge before it.
  const edge = Math.min(max, Math.round(now / step) * step);
  const to = Math.abs(max - now) < Math.abs(now - edge) ? max : edge;
  const snap = () => row.classList.remove("swiping");
  if (still || Math.abs(to - now) < 1) {
    scrollRowTo(row, to);
    snap();
    return;
  }
  // Snapping comes back once it has arrived; a scroll that is taken over meanwhile says so again.
  row.addEventListener("scrollend", snap, { once: true });
  window.setTimeout(snap, 600);
  row.scrollTo(upright() ? { top: to, behavior: "smooth" } : { left: to, behavior: "smooth" });
}

export function buildShelf(actions: ViewActions): ShelfHost {
  const row = h("div", { class: "shelf-row" });
  // The chips and, at their end, the way to Settings: the last child of the row.
  const chipBar = h("div", { class: "shelf-chips" });
  const edit = h("button", {
    class: "shelf-edit", type: "button", text: () => t("shelf.edit"), title: () => t("shelf.editTip"),
    onclick: () => actions.openSettingsWindow(),
  });
  const empty = h("div", { class: "shelf-empty" },
    h("div", { class: "title", text: () => t("shelf.allHidden") }),
    h("div", { class: "sub", text: () => t("shelf.turnOn") }),
    h("button", { class: "link-btn", text: () => t("shelf.openSettings"), onclick: () => actions.openSettingsWindow() }));
  const rowLayer = h("div", { class: "shelf-layer on" }, row, empty);
  const focusLayer = h("div", { class: "shelf-layer" });
  const el = h("div", { class: "view shelf-view" }, rowLayer, focusLayer);
  // The card's width (its height in a side's column) and the gap, said once (layout.ts): the stylesheet reads them here.
  el.style.setProperty("--shelf-card-h", `${SHELF_CARD_H}px`);
  el.style.setProperty("--shelf-card-gap", `${SHELF_CARD_GAP}px`);
  el.style.setProperty("--shelf-chips-h", `${SHELF_CHIPS_H}px`);

  // ── The widgets ─────────────────────────────────────────────────────────────

  let focus: ShelfWidgetId | null = null;
  const widgets = new Map<ShelfWidgetId, Widget>();
  const chips = new Map<ShelfWidgetId, ShelfChip>();

  const ctx: WidgetContext = {
    back: () => void closeWidget(),
    keyboard: (on) => actions.keyboard(on),
  };
  for (const id of WIDGET_IDS) {
    const make = BUILDERS[id];
    if (!make) continue;
    const widget = make(ctx);
    widgets.set(id, widget);
    focusLayer.append(widget.card);
    // A tap on the card expands it — unless it landed on a control, which then acts by
    // itself. The corner's expand button is the one control that expands. A press that
    // moved never gets this far: gestures.ts swallows its click.
    widget.small?.addEventListener("click", (e) => {
      // The path as it was when the click began: a control may have redrawn itself since
      // (play turns to pause), and what was clicked is then no longer inside it.
      const control = e.composedPath().find((n): n is Element => n instanceof Element && n.matches(CONTROL));
      if (control && !control.hasAttribute("data-expand")) return;
      openWidget(id);
    });
    // Its chip, for when it is not a card: a press on it expands the widget too.
    const shortcut = chip(id);
    shortcut.el.addEventListener("click", () => openWidget(id));
    chips.set(id, shortcut);
  }

  /** More cards past an edge: that edge fades. In a side's column, "left" is above and "right" below. */
  const edges = () => {
    const { scrollLeft: at, scrollWidth, clientWidth } = rowScroll(row);
    const max = scrollWidth - clientWidth;
    row.classList.toggle("more-left", at > 2);
    row.classList.toggle("more-right", at < max - 2);
  };
  row.addEventListener("scroll", edges, { passive: true });
  // The row is narrower while the island is still opening.
  new ResizeObserver(edges).observe(row);

  // ── The mosaic ──────────────────────────────────────────────────────────────

  /** What the row was last drawn for: nothing is touched when that has not changed. */
  let key: string | null = null;
  /** Who is a card and who is a chip, as drawn. */
  let placed: Mosaic = { cards: [], chips: [], ready: false };
  /** The widgets Settings had on the shelf, in order, when the mosaic was last made. */
  let madeFor = "";
  /** The next mosaic is made anew, from what is live: the Shelf is coming on show, or Settings changed what is on it. */
  let fresh = true;

  /** A widget that can stand as a card: it has a small one. */
  const hasCard = (id: ShelfWidgetId) => widgets.get(id)?.small != null;

  /**
   * Who stands as a card, up to MAX_CARDS: the widgets with something going on,
   * in the order Settings gives — and, when nothing is, the timer, ready to
   * start, so that the island is never a lone row of chips. The rest are chips.
   * While the Shelf stays on show, a card is not taken away when what it held is
   * over (it would leave under the pointer); what starts now takes a free place.
   */
  function compose(enabled: ShelfWidgetId[]): Mosaic {
    const there = enabled.filter((id) => widgets.has(id));
    const live = (id: ShelfWidgetId) => hasCard(id) && widgets.get(id)!.live();
    let cards: ShelfWidgetId[];
    let ready = false;
    if (fresh || placed.ready) {
      cards = there.filter(live).slice(0, MAX_CARDS);
      ready = !cards.length && there.includes("timer");
      if (ready) cards = ["timer"];
    } else {
      cards = placed.cards.filter((id) => there.includes(id));
      for (const id of there) if (cards.length < MAX_CARDS && !cards.includes(id) && live(id)) cards.push(id);
      cards.sort((a, b) => there.indexOf(a) - there.indexOf(b));
    }
    return { cards, chips: there.filter((id) => !cards.includes(id)), ready };
  }

  /** The mosaic: the cards, then the row of chips and the way to Settings. */
  function drawRow(enabled: ShelfWidgetId[]) {
    const now = enabled.join();
    if (now !== madeFor) fresh = true;
    madeFor = now;
    placed = compose(enabled);
    fresh = false;
    const next = `${placed.cards.join()}|${placed.chips.join()}`;
    if (next === key) return;
    key = next;
    clear(row);
    clear(chipBar);
    for (const id of placed.cards) row.append(widgets.get(id)!.small!);
    for (const id of placed.chips) chipBar.append(chips.get(id)!.el);
    chipBar.append(edit);
    row.append(chipBar);
    row.style.setProperty("--cols", String(Math.max(1, placed.cards.length)));
    row.classList.toggle("solo", placed.cards.length === 1);
    row.classList.toggle("no-cards", placed.cards.length === 0);
    row.style.display = enabled.length ? "" : "none";
    empty.style.display = enabled.length ? "none" : "";
    row.scrollTo({ left: 0, top: 0 });
    edges();
  }

  /** The chip of a widget, said again from the widget's state. */
  const paintChip = (id: ShelfWidgetId) => {
    const widget = widgets.get(id);
    if (widget) chips.get(id)?.paint(widget.shortcut());
  };

  // A card dragged to another place, or a swipe: the order is Settings'. The same
  // two settings the Settings window writes, and the island follows it live.
  enableGestures({
    row,
    upright,
    card: ".wmini",
    control: CONTROL,
    longPressMs: LONG_PRESS_MS,
    onScrollStart: () => row.classList.add("swiping"),
    onScrollEnd: () => settleRow(row, actions.reducedMotion()),
    onReorder: (ids) => {
      const moved = ids.filter((id): id is ShelfWidgetId => id in SHELF_WIDGETS);
      const order = [...new Set([...(Array.isArray(State.settings.shelfOrder) ? State.settings.shelfOrder : []), ...WIDGET_IDS])] as ShelfWidgetId[];
      // The cards trade the places they hold in Settings' order; no other widget moves.
      const places = order.flatMap((id, at) => (moved.includes(id) ? [at] : []));
      const next = [...order];
      moved.forEach((id, k) => (next[places[k]] = id));
      State.settings.shelfOrder = next;
      // The row already stands as it will be drawn: it is not drawn again, and not made anew.
      placed = { cards: moved, chips: placed.chips, ready: placed.ready };
      key = `${placed.cards.join()}|${placed.chips.join()}`;
      madeFor = shelfWidgets().join();
      // The card dropped last went after the chips in the page; the chips go back to the end.
      row.append(chipBar);
      void Bridge.saveSettings(State.settings);
      State.notify();
    },
  });

  // ── Paint ───────────────────────────────────────────────────────────────────

  let live = false;
  let tickTimer = 0;

  /** The small cards and the chips on the shelf and the expanded one, from their widgets' state. */
  function paintAll() {
    for (const id of shelfWidgets()) {
      widgets.get(id)?.paint();
      paintChip(id);
    }
    if (focus) widgets.get(focus)?.paint();
  }

  /** Which layer is on show, and which widget's view is in it. */
  function render() {
    const open = focus != null;
    rowLayer.classList.toggle("on", !open);
    rowLayer.inert = open;
    focusLayer.classList.toggle("on", open);
    focusLayer.inert = !open;
    for (const [id, widget] of widgets) widget.card.classList.toggle("on", id === focus);
  }

  /** What a widget changed, said while the Shelf is on show: repainted at once. Off the screen, nothing is painted. */
  onShelfChange(() => {
    if (!live) return;
    // What a widget has to say may have changed its place in the row — never under a card being carried.
    if (!focus && !row.classList.contains("reordering") && !row.classList.contains("dragging")) drawRow(shelfWidgets());
    paintAll();
  });

  // A new language: every widget says its words again (painted on the next show if the Shelf is hidden).
  onLangChange(() => {
    for (const [id, widget] of widgets) {
      widget.paint();
      paintChip(id);
    }
  });

  /** Once a second, while the Shelf is on show: what is on the row, or the one widget expanded. */
  function tick() {
    if (focus) {
      widgets.get(focus)?.tick?.();
      return;
    }
    for (const id of shelfWidgets()) {
      widgets.get(id)?.tick?.();
      // A chip says a countdown or a time that grows old by itself.
      if (!placed.cards.includes(id)) paintChip(id);
    }
  }

  function stopAll(why: string) {
    for (const widget of widgets.values()) widget.stop?.(why);
  }

  // ── The morph ───────────────────────────────────────────────────────────────
  // Every element that is the same thing in the small card and in the expanded
  // view carries `data-vt` (widgets/ui.ts). For the length of one transition the
  // ones on show get `view-transition-name: w-<that name>`: first in the size
  // being left, then — once the page has changed — in the size being entered. A
  // name on both sides moves; a name on one side only fades. Names are unique at
  // each capture because only one widget, in one size, wears them at a time.

  const named = new Set<HTMLElement>();
  let revealTimer = 0;

  /** Laid out, and not scrolled out of the list or the row that holds it. */
  function onShow(node: HTMLElement): boolean {
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const holder = node.parentElement?.closest<HTMLElement>(".gh-list, .shelf-row");
    if (!holder) return true;
    const clip = holder.getBoundingClientRect();
    return box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1 && box.left >= clip.left - 1 && box.right <= clip.right + 1;
  }

  function nameShared(scope: HTMLElement) {
    const done: string[] = [];
    for (const node of [scope, ...scope.querySelectorAll<HTMLElement>("[data-vt]")]) {
      const name = node.dataset.vt;
      if (!name || done.includes(name) || !onShow(node)) continue;
      node.style.setProperty("view-transition-name", `w-${name}`);
      if (node.dataset.vtc) node.style.setProperty("view-transition-class", `w-${node.dataset.vtc}`);
      named.add(node);
      done.push(name);
    }
  }

  function unnameAll() {
    for (const node of named) {
      node.style.removeProperty("view-transition-name");
      node.style.removeProperty("view-transition-class");
    }
    named.clear();
  }

  /** What stands for a widget in the row: its small card, or its chip. */
  function spot(id: ShelfWidgetId): HTMLElement | null {
    return placed.cards.includes(id) ? widgets.get(id)?.small ?? null : chips.get(id)?.el ?? null;
  }

  /** Brings a card or a chip wholly into the row's view, at once: what is cut by the row's edge would grow from outside the island. */
  function revealCard(card: HTMLElement) {
    const up = upright();
    const start = up ? card.offsetTop - row.offsetTop : card.offsetLeft - row.offsetLeft;
    const end = start + (up ? card.offsetHeight : card.offsetWidth);
    const at = scrolled(row);
    const seen = up ? row.clientHeight : row.clientWidth;
    if (start >= at && end <= at + seen) return;
    // Set by hand, so not while the row snaps by itself.
    window.clearTimeout(revealTimer);
    row.classList.add("swiping");
    scrollRowTo(row, start < at ? start : end - seen);
    revealTimer = window.setTimeout(() => row.classList.remove("swiping"), 800);
  }

  function morphNames(widget: Widget, open: boolean): MorphNames {
    return {
      before() {
        unnameAll();
        const from = open ? spot(widget.id) : widget.card;
        if (open && from) revealCard(from);
        if (from) nameShared(from);
      },
      after() {
        unnameAll();
        const into = open ? widget.card : spot(widget.id);
        // Going back: the card or chip it shrinks into stands wholly in the row.
        if (!open && into?.isConnected) revealCard(into);
        if (into) nameShared(into);
      },
      clear: unnameAll,
    };
  }

  /**
   * Changes what the Shelf shows — a widget expands, or goes back — as the
   * morph where the page can draw one, and as the island's spring and a
   * cross-fade where it cannot (or where motion is reduced: then, a plain swap).
   */
  function go(change: () => void, id: ShelfWidgetId, open: boolean) {
    const widget = widgets.get(id);
    if (widget && actions.morph(change, morphNames(widget, open), open)) return;
    change();
    actions.resized(!open);
  }

  function openWidget(id: ShelfWidgetId) {
    if (focus || !widgets.has(id)) return;
    go(() => {
      focus = id;
      render();
      paintAll();
      widgets.get(id)?.opened?.();
    }, id, true);
  }

  function closeWidget(): boolean {
    if (!focus) return false;
    const id = focus;
    // The widget on its way out lets go of what it holds open — the camera — at once.
    if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) document.activeElement.blur();
    widgets.get(id)?.stop?.("closed");
    go(() => {
      focus = null;
      render();
      // What was done in the expanded view may have given a widget something to show: a card for it, if there is a place.
      drawRow(shelfWidgets());
      paintAll();
    }, id, false);
    return true;
  }

  return {
    el,

    get focused() {
      return focus;
    },
    get bare() {
      return focus != null;
    },
    get width() {
      return focus ? expandedSize(focus).w : undefined;
    },
    get height() {
      return focus ? expandedSize(focus).h : undefined;
    },

    sync() {
      const shown = shelfWidgets();
      // Switched off in Settings while it was expanded: back to the row.
      if (focus && !shown.includes(focus)) {
        widgets.get(focus)?.stop?.("switched off");
        focus = null;
      }
      drawRow(shown);
      render();
      paintAll();
    },

    closeWidget,

    showWidget(id) {
      if (!widgets.has(id)) return;
      focus = id;
      render();
      paintAll();
    },

    visible(on) {
      if (on === live) return;
      live = on;
      if (on) {
        // The Shelf comes on show: who is a card and who a chip is made anew, from what is going on now.
        fresh = true;
        drawRow(shelfWidgets());
        paintAll();
        tickTimer = window.setInterval(tick, 1000);
        // Not a second late: what is asked of the system (the player) is asked now.
        tick();
      } else {
        window.clearInterval(tickTimer);
        tickTimer = 0;
        stopAll("the Shelf is off the screen");
        flushWidgets();
      }
    },

    leave() {
      if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) document.activeElement.blur();
      stopAll("the island folded");
      if (focus) {
        focus = null;
        render();
      }
      flushWidgets();
    },
  };
}
