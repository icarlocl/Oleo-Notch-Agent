// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "confused"
  | "settings"
  | "greeting"
  | "session"
  | "shelf";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName =
  | "hello" | "love" | "giggle" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

// The island at its normal size is 720×320 at most, like the macOS panel: the
// session panel is, and no card is taller. It is drawn glued to the edge of its
// window it is docked to (the top unless Settings say otherwise), and centred
// along it.
export const PANEL_W = 720;
export const PANEL_H = 320;

/** The session panel at its large size: this, or what of it the display has room for. */
export const LARGE_W = 1120;
export const LARGE_H = 640;

/**
 * The window's own size. It is given once the size of the largest shape the
 * island takes — the large panel — and never follows the island as it grows
 * and shrinks (src-tauri/src/island.rs sizes it, and says here what it came
 * to on this display). The island hangs in it from the edge it is docked to;
 * the large panel fills it. The window stays landscape on every dock.
 */
export const Room = { w: PANEL_W, h: PANEL_H, dock: "top" as Dock };

/** The edge of the display the island hangs from (Rust: src-tauri/src/dock.rs). */
export type Dock = "top" | "bottom" | "left" | "right";

/** Docked to a side of the display, left or right, not to the top or bottom (Rust: `Dock::vertical`). */
export function sideDock(dock: Dock): boolean {
  return dock === "left" || dock === "right";
}

/**
 * Where the island's top-left corner is in its window — the one mapping the
 * drawing and the rectangle told to Rust both come from, so what takes the
 * mouse is what is drawn. `start` is where it begins along the edge it is
 * docked to, as it is drawn (centred, on a whole pixel): its left edge at the
 * top and bottom, its upper edge on a side. `w` × `h` is its size.
 *
 * At the top it hangs from the window's upper edge; at the bottom it stands on
 * the lower one and grows upwards; on the left it hangs from the window's left
 * edge, on the right from its right one. In each the window's slack for the
 * spring's overshoot is on the side away from the screen's edge. An edge that
 * is not the window's own is put on a whole pixel of the screen, as the others are.
 */
export function islandOrigin(
  dock: Dock, windowW: number, windowH: number, start: number, w: number, h: number, dpr: number,
): { x: number; y: number } {
  switch (dock) {
    case "top":
      return { x: start, y: 0 };
    case "bottom":
      return { x: start, y: Math.round((windowH - h) * dpr) / dpr };
    case "left":
      return { x: 0, y: start };
    case "right":
      return { x: Math.round((windowW - w) * dpr) / dpr, y: start };
  }
}

/**
 * What the large panel leaves of the window, in all: the spring it opens on
 * goes a little past its size before it settles, and would be cut by the
 * window's edge.
 */
export const OVERSHOOT_W = 16;
export const OVERSHOOT_H = 14;

/** The session panel's size: normal, or large. */
export function sessionSize(large: boolean): { w: number; h: number } {
  if (!large) return { w: PANEL_W, h: PANEL_H };
  return {
    w: Math.max(PANEL_W, Math.min(LARGE_W, Room.w - OVERSHOOT_W)),
    h: Math.max(PANEL_H, Math.min(LARGE_H, Room.h - OVERSHOOT_H)),
  };
}

// No notch on a PC: these are the hidden/compact sizes from docs/SPEC.md.
export const NOTCH_W = 184;
export const NOTCH_H = 38;
/** The folded island as the greeting draws it, and as the previews unfold from. Its real width is `compactLayout`'s. */
export const COMPACT_W = 288; // NOTCH_W + 104
/** The folded island with nothing beside the bot. Kept for what was written against it: `compactLayout` says the width now. */
export const COMPACT_SOLO_W = 76;
export const EXPANDED_W = 640;

/**
 * The folded island: fixed slots, left to right — the bot, a dot per session,
 * up to three metric cells. Every slot has its own width, and an empty one
 * goes with its gap; nothing in it can push the island wider.
 */
export const COMPACT_PAD = 12;
export const COMPACT_SLOT_GAP = 10;
export const COMPACT_BOT_SLOT = 34;
/** The bot in its slot: its diameter (`botPosition`). */
export const COMPACT_BOT = 26;
export const COMPACT_DOT = 9;
export const COMPACT_DOT_GAP = 6;
export const COMPACT_MORE_W = 24;
export const COMPACT_METRIC_GAP = 8;
/** Sessions on show — dots here, mini bots on the home view — before the rest fold into "+N". */
export const MAX_VISIBLE = 6;
/** It is never wider than this, ears included… */
export const COMPACT_MAX_W = 420;
/** …nor than this share of the display's logical width, whichever is smaller. */
export const COMPACT_SCREEN_SHARE = 0.4;

/**
 * Folded on a side, the same slots stand in a column, top to bottom, flush
 * with the side edge: the bot, a dot per session, the metric cells. The column
 * is as wide as a cell's widest number, "100%", with room either side, and as
 * the bot's slot (style.css `#compact` on a side). A cell stands its icon over
 * its number: 14 px, 2 px, a 16 px line. "+N" is as tall as it is in the row.
 * The text is never turned: only the slots are.
 */
export const COMPACT_COLUMN_W = 46;
export const COMPACT_CELL_H = 32;
export const COMPACT_MORE_H = 16;
/**
 * A chip: one session whose turn ended and has not been looked at, named by its
 * initial. They stand in the column under the bot, newest on top, only on a
 * side (the row has the bot's mark and nothing more), from two sessions on —
 * with one, the bot's mark says it. At most COMPACT_CHIPS_MAX of them, and the
 * rest is a "+N" as tall as the dots' own.
 */
export const COMPACT_CHIP = 30;
export const COMPACT_CHIP_GAP = 6;
export const COMPACT_CHIPS_MAX = 3;
/**
 * The column is never taller than COMPACT_MAX_W, ears included, nor than this
 * share of the display's logical height: half, where the row has 40 % of the
 * width — a display is landscape, and the column is a sliver of it.
 */
export const COMPACT_COLUMN_SHARE = 0.5;

/**
 * The ears: the concave quarter-circles the island flares into the top edge
 * with, on each side. Their radius, folded and open; it follows the island's
 * size on the same spring.
 */
export const EAR_COMPACT = 11;
export const EAR_EXPANDED = 16;

/**
 * The display the island hangs from: its logical width, which caps the folded
 * island, and its height, which caps it folded on a side. `zoom` is 1 in the
 * app; a dev page that scales its stage to stand for display scaling says by
 * how much, so that edges are snapped to the pixels really drawn.
 */
export const Display = { w: 1920, h: 1080, zoom: 1 };

/**
 * The longest the folded island may be along its edge on this display, ears
 * included: its width at the top and bottom; its height on a side, where the
 * window, less the spring's overshoot, holds it too.
 */
export const compactCap = (dock: Dock = Room.dock) =>
  sideDock(dock)
    ? Math.min(COMPACT_MAX_W, Math.floor(Display.h * COMPACT_COLUMN_SHARE), Math.max(0, Room.h - OVERSHOOT_H))
    : Math.min(COMPACT_MAX_W, Math.floor(Display.w * COMPACT_SCREEN_SHARE));

export interface CompactLayout {
  /** Dots on show; the other sessions are behind "+N". */
  dots: number;
  /** Metric cells on show: the first this many of those picked. */
  metrics: number;
  /** Chips on show, for the results nobody has looked at; the others are behind a "+N" — or, with none, behind the bot's mark. */
  chips: number;
  /** The island's body, ears not counted: what it is wide for at the top and bottom; the column's width on a side. */
  width: number;
  /** Its height: the pill's at the top and bottom; on a side, what the column is tall for. */
  height: number;
}

/**
 * What of the folded island fits under `cap`, for this many sessions and metric
 * cells of these widths. Short of room, the last metric goes first, then dots
 * fold into "+N": the bot and a way to the sessions always stay. On a side the
 * same slots are stacked, and it is the column's length that is capped: a cell
 * is COMPACT_CELL_H tall whatever its width in the row, "+N" COMPACT_MORE_H.
 *
 * `unseen` is how many sessions ended a turn that nobody has looked at. On a
 * side, two or more of them get a chip each under the bot (COMPACT_CHIPS_MAX,
 * then a "+N"). Short of room the metrics go first, then the chips — the bot's
 * mark still counts them — and only then the dots.
 */
export function compactLayout(
  sessions: number, metricWidths: readonly number[], dock: Dock = Room.dock, cap = compactCap(dock), unseen = 0,
): CompactLayout {
  const side = sideDock(dock);
  const chipsLength = (chips: number) => {
    if (chips === 0) return 0;
    const more = unseen > chips ? COMPACT_MORE_H + COMPACT_CHIP_GAP : 0;
    return chips * COMPACT_CHIP + (chips - 1) * COMPACT_CHIP_GAP + more;
  };
  const dotsLength = (dots: number) => {
    if (sessions === 0) return 0;
    const more = sessions > dots ? (side ? COMPACT_MORE_H : COMPACT_MORE_W) : 0;
    const cells = dots + (more ? 1 : 0);
    return dots * COMPACT_DOT + more + Math.max(0, cells - 1) * COMPACT_DOT_GAP;
  };
  const metricsLength = (count: number) =>
    metricWidths.slice(0, count).reduce((w, m) => w + (side ? COMPACT_CELL_H : m), 0) +
    Math.max(0, count - 1) * COMPACT_METRIC_GAP;
  const body = (dots: number, count: number, chips: number) => {
    const d = dotsLength(dots);
    const m = metricsLength(count);
    const c = chipsLength(chips);
    return COMPACT_PAD + COMPACT_BOT_SLOT + (c ? COMPACT_SLOT_GAP + c : 0) + (d ? COMPACT_SLOT_GAP + d : 0) + (m ? COMPACT_SLOT_GAP + m : 0) + COMPACT_PAD;
  };
  let dots = Math.min(MAX_VISIBLE, sessions);
  let metrics = metricWidths.length;
  // The row has no chips: one session's end is the bot's mark, and so are several.
  let chips = side && unseen >= 2 ? Math.min(COMPACT_CHIPS_MAX, unseen) : 0;
  while (metrics > 0 && body(dots, metrics, chips) + 2 * EAR_COMPACT > cap) metrics--;
  while (chips > 0 && body(dots, metrics, chips) + 2 * EAR_COMPACT > cap) chips--;
  while (dots > 0 && body(dots, metrics, chips) + 2 * EAR_COMPACT > cap) dots--;
  const length = body(dots, metrics, chips);
  return side ? { dots, metrics, chips, width: COMPACT_COLUMN_W, height: length } : { dots, metrics, chips, width: length, height: NOTCH_H };
}

/**
 * The middle of the bot's slot, from the island's top-left corner: the first
 * slot of the row, or the top one of the column. The one place the folded
 * bot is placed from (`botPosition`): its canvas and the slot style.css keeps
 * for it (`.ci-bot`) cannot part.
 */
export function compactBotSeat(dock: Dock = Room.dock): { cx: number; cy: number } {
  return sideDock(dock)
    ? { cx: COMPACT_COLUMN_W / 2, cy: COMPACT_PAD + COMPACT_BOT_SLOT / 2 }
    : { cx: COMPACT_PAD + COMPACT_BOT_SLOT / 2, cy: NOTCH_H / 2 };
}

export const ROUNDED_CORNER = 16; // hidden / compact
export const EXPANDED_CORNER = 22;

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 6;

/**
 * How tall the island is for the home view before it has measured what it holds
 * (views/home.ts reports its own height once it is on show): the card and a row
 * of chips under it.
 */
export const HOME_H = 200;

/** Where the views start in the island: under #content's 8 px of padding and the 34 px bar, 10 px in (style.css `#content`, `#header`). */
const VIEW_TOP = 8 + 34;
const VIEW_LEFT = 10;
/** A card's border (style.css `.card`). */
const CARD_EDGE = 1;

/**
 * The bot in the session panel: at the head of its one column, in the header
 * of the card, beside the session's name (style.css `.sess-bot-slot` keeps
 * its room: the card's border, the header's padding, then half the slot).
 */
export const SESSION_BOT = {
  normal: { x: VIEW_LEFT + CARD_EDGE + 10 + 24, y: VIEW_TOP + CARD_EDGE + 8 + 24, diameter: 48 },
  large: { x: VIEW_LEFT + CARD_EDGE + 14 + 28, y: VIEW_TOP + CARD_EDGE + 10 + 28, diameter: 56 },
} as const;

/**
 * The row of sessions above the card (style.css `.sess-strip`): its height and
 * the gap under it. The row is there only with more than one session, and the
 * view says so — the card, and the bot in it, are that much lower.
 */
export const SESSION_STRIP_H = 32;
export const SessionRoom = { strip: false };

/**
 * The stage the home view's card keeps for the island's own bot (style.css
 * `.home-focus`, `.hf-stage`), in the island's coordinates: its box, and its
 * floor — which the bot's feet stand on. The card is the first thing in the
 * view; it has 14 px of padding on top.
 */
export interface StageBox {
  x: number;
  y: number;
  w: number;
  h: number;
  floor: number;
}

export const HOME_STAGE: Record<"row" | "column", StageBox> = {
  // Top and bottom: the card is as wide as the view, with 16 px of padding on
  // the left and 14 on top, and the stage a square of 64 px at its left corner.
  row: { x: VIEW_LEFT + CARD_EDGE + 16, y: VIEW_TOP + CARD_EDGE + 14, w: 64, h: 64, floor: 3 },
  // Left and right: the card is a row the width of the view, and the stage a
  // column of its own at its left, 8 px in, as tall as it is in the row.
  column: { x: VIEW_LEFT + CARD_EDGE + 8, y: VIEW_TOP + CARD_EDGE + 8, w: 76, h: 73, floor: 6 },
};

/** The island's bot on the home view, and what it is on its stage. */
const HOME_BOT = 58;

/**
 * Where a bot this wide stands on a stage: its middle over the stage's, its
 * feet on the stage's floor. The one place the home view's bot is placed
 * from (VIEW_LAYOUTS, SIDE_LAYOUTS): the canvas and the stage it stands on
 * cannot part.
 */
export function botOnStage(stage: StageBox, diameter: number): { x: number; y: number } {
  return { x: stage.x + stage.w / 2, y: stage.y + stage.h - stage.floor - diameter / 2 };
}

/** 59, 89: the bot's place on the top and bottom docks' home view. */
const HOME_SEAT = botOnStage(HOME_STAGE.row, HOME_BOT);

/**
 * What the island's own bar and margins take of a view's height: a view is
 * its content and this.
 */
const ISLAND_CHROME = 52;

/**
 * The Shelf, the island's second tab (plans/tabs-plan.md §2): a mosaic. What
 * has something going on stands as a card — up to three side by side, a card
 * holding three lines and a field under its header — and the rest is a row of
 * shortcuts under them, one chip each. Nothing scrolls at the top and bottom;
 * the island is as tall as a row of cards, the gap and a row of chips.
 */
export const SHELF_CARD_W = 200;
export const SHELF_CARD_GAP = 10;
export const SHELF_CARD_H = 160;
export const SHELF_CHIPS_H = 32;
export const SHELF_H = ISLAND_CHROME + SHELF_CARD_H + SHELF_CARD_GAP + SHELF_CHIPS_H;
/** The Shelf's inner width: four cards' worth and a sliver, so that three cards are as wide as the small cards were. */
const SHELF_VISIBLE_CARDS = 4;
const SHELF_PEEK = 12;
/** The island's side padding (style.css `#content`). */
const ISLAND_SIDE_PAD = 10;
/** The Shelf's width at its widest: wider than Home, so that its cards are not cut. */
export const SHELF_W =
  SHELF_VISIBLE_CARDS * (SHELF_CARD_W + SHELF_CARD_GAP) + SHELF_PEEK + 2 * ISLAND_SIDE_PAD;

/** The Shelf's width on this display, at the top or bottom: as wide as the window has room for, never narrower than Home. */
export function shelfWidth(): number {
  return Math.max(EXPANDED_W, Math.min(SHELF_W, Room.w - OVERSHOOT_W));
}

/** How far a tab's view travels sideways as it gives way to the other, and the bot with it. */
export const TAB_SLIDE = 28;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  // The home view: the bot stands in the stage its card keeps for it, on the
  // left (HOME_STAGE, `botOnStage`: its feet 6 px above the stage's bottom edge).
  overview: { height: HOME_H, botX: HOME_SEAT.x, botY: HOME_SEAT.y, botDiameter: HOME_BOT, agentMode: "none" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 56, botY: null, botDiameter: 56, agentMode: "column" },
  // 196 as docs/SPEC.md has it: a question, its options, and a line for what
  // the option under the mouse means.
  question: { height: 196, botX: 56, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  settings: { height: 160, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  // Windows only, no macOS counterpart yet: what a Claude Code session did —
  // its journal, its subagents, the files it changed. One column: the row of
  // sessions on top, then the card — a small bot beside the session's name,
  // the journal under it. SESSION_BOT has the bot, at both sizes.
  session: {
    height: PANEL_H, botX: SESSION_BOT.normal.x, botY: SESSION_BOT.normal.y, botDiameter: SESSION_BOT.normal.diameter,
    agentMode: "none",
  },
  // The Shelf has no bot: the row of cards is all of it. The bot waits where
  // the home view left it, a slide to the left, and is not drawn (`botPosition`).
  shelf: { height: SHELF_H, botX: HOME_SEAT.x - TAB_SLIDE, botY: HOME_SEAT.y, botDiameter: HOME_BOT, agentMode: "none" },
};

/**
 * An approval card that shows what the edit would do holds a diff between the
 * request and its buttons: the island is that much taller for it — as tall as
 * the window allows.
 */
export const PROPOSAL_ROOM = PANEL_H - 160;

/**
 * A view whose content varies — a question has two options or four, a line
 * each or a row of buttons — says how tall the island should be for it: what
 * it holds, the air the card keeps above and below it, and the island around
 * the card (its bar, its own margins), between a card's usual height and the
 * window's.
 */
const VIEW_MIN = 160;
/** The air a card that asks something keeps above and below its lines. */
export const CARD_AIR = 22;
/**
 * The least air any card keeps: one that tells something — a turn's end, an
 * error — is as tall as it always was until its lines would come closer to
 * its edges than this.
 */
export const CARD_AIR_MIN = 14;

/**
 * A fresh request's card ignores clicks for this long. The card slides out
 * under wherever the pointer happens to be, and a click that was aimed at
 * something else a moment earlier must not allow a command nobody has read.
 */
export const REQUEST_ARM_MS = 400;

/**
 * The island as tall as the home view's card and chips are, and the island's own
 * bar and margins: no least height, since a card with nothing to ask is short.
 */
export function homeFitted(content: number): number {
  return Math.min(PANEL_H, Math.ceil(content) + ISLAND_CHROME);
}

export function fittedHeight(content: number, air = CARD_AIR): number {
  return Math.min(PANEL_H, Math.max(VIEW_MIN, Math.ceil(content) + ISLAND_CHROME + 2 * air));
}

// ── Docked to a side ──────────────────────────────────────────────────────────
// On the left or right edge the two tabs stand upright: Home's three cards one
// above the other, the Shelf's cards in a column that scrolls up and down. The
// in-island settings stand upright too, as wide as Home. Every other view keeps
// its landscape size and hangs from the side edge.

/**
 * How wide Home and the Shelf are on a side: a bot card with its stage and
 * three short lines beside it, the lanes of six mini bots and their "+N"
 * (about 250 px), and the machine and usage in two columns of 130 each.
 */
export const SIDE_W = 320;

/**
 * Home's two parts on a side (style.css `.home` on a side, by way of views/home.ts),
 * and the 8 px between them. The card: the 73 px stage and its 8 px padding on
 * each side, beside the session's name and what it says, the command it asks
 * for, and its buttons (about 150 when a request waits). The chips: a row that
 * wraps, with room for "Also" and three lines of them.
 */
export const HOME_SIDE_BOT_H = 150;
export const HOME_SIDE_CHIPS_H = 124;
const HOME_SIDE_GAP = 8;
/**
 * The island for Home on a side: 334, the card, the chips and the island's bar
 * and margins. It fits a 1366 × 768 laptop at 150 %; where the window is shorter
 * the chips scroll under the card, which stays.
 */
export const HOME_SIDE_H = ISLAND_CHROME + HOME_SIDE_BOT_H + HOME_SIDE_GAP + HOME_SIDE_CHIPS_H;

/**
 * The Shelf's cards stacked on a side: each as tall as a card of the row is,
 * as wide as the column, as far apart as in the row, and the shortcuts as
 * chips under the last card. Two whole cards and a peek of what follows —
 * enough of the third card, or of the first line of chips, to say that the
 * column goes on: 432.
 */
const SHELF_SIDE_VISIBLE = 2;
const SHELF_SIDE_PEEK = 44;
export const SHELF_SIDE_H = ISLAND_CHROME + SHELF_SIDE_VISIBLE * (SHELF_CARD_H + SHELF_CARD_GAP) + SHELF_SIDE_PEEK;

/**
 * The in-island settings on a side: the quick panel (sound, auto-close) as wide
 * as Home, upright. As tall as its title line, its two cards and the button to
 * the full window need: 330, as the proposal measured it (a 44 px bar, a title
 * line, a card of sound and one of auto-close with its note, the button and the
 * 10 px the island keeps below).
 */
export const SETTINGS_SIDE_H = 330;

/** The settings' bot on a side: small, at the left of the title line (its words start 58 px in). */
const SETTINGS_SIDE_BOT = 30;

/** 57, 89: the bot on the stage of Home's upright bot card. */
const SIDE_SEAT = botOnStage(HOME_STAGE.column, HOME_BOT);

/** The views that are laid out otherwise on a side. */
const SIDE_LAYOUTS: Partial<Record<IslandViewName, ViewLayout>> = {
  overview: { height: HOME_SIDE_H, botX: SIDE_SEAT.x, botY: SIDE_SEAT.y, botDiameter: HOME_BOT, agentMode: "none" },
  // Nothing slides between the tabs on a side (they cross-fade): the bot fades where it stands.
  shelf: { height: SHELF_SIDE_H, botX: SIDE_SEAT.x, botY: SIDE_SEAT.y, botDiameter: HOME_BOT, agentMode: "none" },
  settings: { height: SETTINGS_SIDE_H, botX: 32, botY: 61, botDiameter: SETTINGS_SIDE_BOT, agentMode: "none" },
};

/** A view's layout on this dock: VIEW_LAYOUTS, but for Home and the Shelf upright on a side. */
export function viewLayout(view: IslandViewName, dock: Dock = Room.dock): ViewLayout {
  return (sideDock(dock) ? SIDE_LAYOUTS[view] : undefined) ?? VIEW_LAYOUTS[view];
}

/** What a side's upright view has to grow in: the window less the spring's overshoot, as the large panel. */
const sideRoom = () => ({ w: Math.max(0, Room.w - OVERSHOOT_W), h: Math.max(0, Room.h - OVERSHOOT_H) });

/** Home's size on this dock: three columns at the top and bottom; upright on a side, no larger than the window allows. */
export function homeSize(dock: Dock = Room.dock): { w: number; h: number } {
  if (!sideDock(dock)) return { w: EXPANDED_W, h: HOME_H };
  const room = sideRoom();
  return { w: Math.min(SIDE_W, room.w), h: Math.min(HOME_SIDE_H, room.h) };
}

/** The Shelf's size on this dock: its row at the top and bottom; its column on a side, as Home's. */
export function shelfSize(dock: Dock = Room.dock): { w: number; h: number } {
  if (!sideDock(dock)) return { w: shelfWidth(), h: SHELF_H };
  const room = sideRoom();
  return { w: Math.min(SIDE_W, room.w), h: Math.min(SHELF_SIDE_H, room.h) };
}

/** The in-island settings' size on this dock: the landscape bar at the top and bottom; upright on a side, as wide as Home. */
export function settingsSize(dock: Dock = Room.dock): { w: number; h: number } {
  if (!sideDock(dock)) return { w: EXPANDED_W, h: VIEW_LAYOUTS.settings.height };
  const room = sideRoom();
  return { w: Math.min(SIDE_W, room.w), h: Math.min(SETTINGS_SIDE_H, room.h) };
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  proposal = false,
  fitted: number | null = null,
  large = false,
  compact: { w: number; h: number } = { w: COMPACT_W, h: NOTCH_H },
  fittedW: number | null = null,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the top edge of the screen instead of sitting there as a bar.
      // On a side it retracts into that edge: to no width, at its folded length.
      return sideDock(Room.dock) ? { w: 0, h: compact.h } : { w: NOTCH_W, h: 0 };
    case "compact":
      // Folded, as `compactLayout` has it: a level pill at the top and bottom, a column flush with a side.
      return { w: compact.w, h: compact.h };
    case "expanded": {
      if (view === "session") return sessionSize(large);
      // The two tabs at rest — no widget of the Shelf expanded — have the dock's own size.
      if (fitted == null && fittedW == null) {
        if (view === "overview") return homeSize();
        if (view === "shelf") return shelfSize();
        if (view === "settings" && sideDock(Room.dock)) return settingsSize();
      }
      const h = fitted ?? viewLayout(view).height;
      const room = proposal && view === "approval" ? PROPOSAL_ROOM : 0;
      // An expanded widget of the Shelf is as wide as it says: no wider than the window's normal panel.
      return { w: fittedW != null ? Math.min(fittedW, PANEL_W) : view === "shelf" ? shelfWidth() : EXPANDED_W, h: h + room };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  large = false,
): BotPlacement {
  switch (mode) {
    case "hidden":
      // On a side, gone where it will come back: its slot at the top of the column.
      return sideDock(Room.dock)
        ? { ...compactBotSeat(), diameter: 6, opacity: 0 }
        : { cx: 46, cy: NOTCH_H / 2, diameter: 6, opacity: 0 };
    case "compact":
      // In the middle of its slot, the first one.
      return { ...compactBotSeat(), diameter: COMPACT_BOT, opacity: 1 };
    case "expanded": {
      if (view === "session") {
        const at = SESSION_BOT[large ? "large" : "normal"];
        return { cx: at.x, cy: at.y + (SessionRoom.strip ? SESSION_STRIP_H : 0), diameter: at.diameter, opacity: 1 };
      }
      const layout = viewLayout(view);
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: view === "shelf" ? 0 : 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

/** The colour of each state: the bot's sprout and bubble (BOT_STATES), and the glow under it. */
export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "idle":
      return "#8FD3A0";
    case "working":
      return "#5AA9FF";
    case "thinking":
      return "#A98BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#FFB547";
    case "question":
      return "#38CFE0";
    case "error":
      return "#FF6B7A";
    case "finished":
      return "#4FD69C";
    case "ratelimit":
      return "#FF9B5C";
    case "sleeping":
      return "#A7B4C8";
    case "dizzy":
      return "#E879F9";
  }
}

/** How strong the glow under the bot is: each state's own glow level (BOT_STATES), 0.65 at its brightest. */
export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "sleeping":
      return 0.1;
    case "idle":
      return 0.23;
    case "ratelimit":
      return 0.4;
    case "thinking":
      return 0.52;
    case "approval":
      return 0.65;
    case "dizzy":
      return 0;
    default:
      return 0.58;
  }
}

// Project colours (IslandConst.projectColors)
const PROJECT_COLORS: Record<string, string> = {
  korus: "#FF5A4E",
  "sbe hub": "#2EC4A0",
  "morning ai brief": "#F29B38",
  "publication ig": "#7C5CFF",
  "ig post": "#7C5CFF",
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  const key = name.toLowerCase().trim();
  const exact = PROJECT_COLORS[key];
  if (exact) return exact;
  for (const [k, c] of Object.entries(PROJECT_COLORS)) {
    if (key.startsWith(k) || key.includes(k)) return c;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
