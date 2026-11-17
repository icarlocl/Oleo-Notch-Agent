// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot, type Words } from "./dom";
import { currentLang, formatNumber, t } from "../core/i18n";
import { ICONS } from "./icons";
import {
  CLAUDE_ID, State, isQuestion, newSession, repliedWords, requestsOf, subagentName, targetTip, targetWords,
  type AgentTask, type ClaudeSession, type SessionRequest,
} from "../core/state";
import { CARD_AIR_MIN, REQUEST_ARM_MS, fittedHeight, washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { buildHome } from "./home";
import { buildSession, sessionName } from "./session";
import { buildShelf, type MorphNames } from "./shelf";
import { diffLine, fileKind, plusMinus, readPatch } from "./code";
import { COLOR } from "./palette";
import { LUCIDE, lucide } from "./iconset";
import { TOOL_NAME, toolMark } from "./tool";
import { buildReplyBox } from "./reply-box";
import { Update } from "../core/update";
import { buildHeaderStats } from "./header-stats";
import { buildWeather } from "./weather";

/** What stands for a session where there is none to go to: another agent's pill has no ↗. */
const NO_SESSION = newSession("");

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  /**
   * A card that tells something — a turn's end, an error — is done with. It
   * goes back to the Shelf when it came up over it; otherwise the island folds
   * (`fold`) or shows the home view, as it always did.
   */
  leaveCard(fold: boolean): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  decide(d: "allow" | "deny"): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** The answers to the question on the card, keyed by each question's own words. */
  answer(answers: Record<string, string>): void;
  /** The question on the card goes unanswered: Claude is told so and carries on without. */
  skipQuestion(): void;
  /** Leaves the question on the card to Claude Code's own window. */
  passQuestion(): void;
  /** A text field wants the keyboard, or gives it back: the island never takes it on its own. */
  keyboard(on: boolean): void;
  /** The session panel's sidebar was clicked: it wants the keyboard, for the arrows to move through it. */
  panelKeyboard(): void;
  /** The session panel at its large size, or back at its normal one. */
  setLarge(on: boolean): void;
  /** From the session panel, back to the card of the request its session is waiting on. */
  showRequest(): void;
  /**
   * Into the session panel: what Claude is writing or, its turn over, what it
   * said. With `changes`, straight to the list of files it changed.
   */
  openSession(changes?: boolean): void;
  /** Into the session panel, on the list of the sessions followed: the way from one to another. */
  openSessions(): void;
  /** Puts another Claude Code session in front: the island shows that one. */
  pickSession(id: string): void;
  /** Goes to where a session runs, whichever is in front, and folds the island once there. */
  goToSession(id: string): void;
  /** From the home view: a session's panel — or, when it is waiting for an answer, the card that asks. */
  openSessionOf(id: string): void;
  /** From the home view: the card of the request a session is waiting on, that session put in front. */
  reviewRequest(id: string): void;
  /** Motion is reduced (Settings → Appearance, or the system's): nothing travels, nothing morphs. */
  reducedMotion(): boolean;
  /**
   * The Shelf changes its own shape — a widget expands, or goes back — drawn as
   * a shared-element transition: `change` is run when the page is ready for it,
   * and the island is at its new size by then. False when the page cannot draw
   * one (or motion is reduced): nothing was done, and the Shelf changes itself
   * and says `resized`.
   */
  morph(change: () => void, names: MorphNames, open: boolean): boolean;
  /** The Shelf changed what it shows: the island takes its new size, shrinking or growing. */
  resized(shrinking: boolean): void;
}

/** A reply's first line as plain words: what marks it as bold, a heading or code goes. */
function firstWords(text: string | null): string | null {
  return text?.split("\n").find((line) => line.trim())?.replace(/^#{1,6}\s+|\*\*|`/g, "").trim() ?? null;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
  /** How tall the island should be for what the view holds now, when that varies. */
  readonly height?: number;
  /** How wide, when it is not the usual: an expanded widget. */
  readonly width?: number;
  /** An approval whose diff is asked for whole: the island is as tall as the window allows (layout.ts `PROPOSAL_ROOM`). */
  readonly roomy?: boolean;
  /**
   * The view has just come on show. A card that asks something starts its
   * arming again: whatever click brought it up must not also answer it.
   */
  arm?(): void;
  /** The session panel: to the next session of its sidebar (1) or the one before (-1), as a click on its line would. */
  step?(by: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string | Words,
  kind: "primary" | "secondary" | "ghost",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

/**
 * Whose card this is, for a card about a Claude Code session: the conversation
 * by its name — with several open, the project alone would not say which —
 * and, when other sessions are waiting for an answer behind it, how many.
 */
function sessionWho(label: string): HTMLElement {
  const task = State.tasks.find((t) => t.id === CLAUDE_ID) ?? State.focusTask;
  const session = State.session;
  const row = h("div", { class: "who-row" });
  if (task) row.append(dot(task.color, 8), ...(session.id ? [toolMark(session.agent, 11)] : []), h("span", { class: "n", text: session.id ? sessionName(session) : task.name }));
  row.append(h("span", { text: label }));
  const waiting = State.waiting.length;
  if (waiting > 0) row.append(h("span", { class: "who-waiting", text: t("views.waitingN", { n: waiting }), title: t("views.othersWaiting") }));
  return row;
}

/**
 * Who is asking, on a request's card. The session itself: as `sessionWho`
 * says it. One of its subagents: by what it was launched to do, then its kind
 * and the session it belongs to — "Write a note (general-purpose subagent) of
 * oleo needs permission" — or, when nothing named it, "A general-purpose
 * subagent of oleo needs permission". When a request does not say who it comes
 * from (an older Claude Code) while subagents are at work, the card says only
 * what it knows: that one of them may be asking.
 */
function askerWho(request: SessionRequest | null, label: string, color: string): HTMLElement {
  const session = State.session;
  const agent = request?.agentId ? (session.subagents.find((a) => a.id === request.agentId) ?? null) : null;
  let row: HTMLElement;
  if (!agent) {
    row = sessionWho(label);
    const unsure = request != null && session.attributed !== true && session.subagents.some((a) => a.state === "running");
    if (unsure) row.insertBefore(h("span", { class: "who-maybe", text: t("views.maybeSubagent") }), row.querySelector(".who-waiting"));
  } else {
    row = h("div", { class: "who-row who-asker" }, dot(color, 8));
    const project = h("i", { class: "who-proj", text: session.project, title: session.title ?? session.project });
    // A short name keeps its own width; only a long one is held to a least width as it is cut.
    if (session.project.length <= 8) {
      project.style.flex = "0 0 auto";
      project.style.minWidth = "0";
    }
    // Its kind, as far as it is known: "general-purpose subagent", or just "subagent".
    const kind = agent.type ? t("views.kindTyped", { type: agent.type }) : t("views.kindPlain");
    const task = agent.description ?? agent.task;
    if (task) {
      row.append(
        h("span", { class: "n", text: task, title: task }),
        h("span", { class: "who-of", text: t("views.kindOf", { kind }) }), project, h("span", { class: "who-of", text: label }),
      );
    } else {
      row.append(h("span", { text: t("views.aKindOf", { kind }) }), project, h("span", { text: label }));
    }
    const waiting = State.waiting.length;
    if (waiting > 0) row.append(h("span", { class: "who-waiting", text: t("views.waitingN", { n: waiting }), title: t("views.othersWaiting") }));
  }
  // Two of the session's subagents can ask at once: one card at a time, the oldest first.
  const queued = requestsOf(session).length;
  if (queued > 1) {
    row.append(h("span", { class: "who-waiting", text: t("views.oneOf", { n: queued }), title: t("views.requestsWaiting", { n: queued }) }));
  }
  return row;
}

/** The request waiting behind the one on the card, in a line: who asks, and what. */
function nextWords(session: ClaudeSession): string {
  const next = session.queued[0];
  if (!next) return "";
  const agent = next.agentId ? session.subagents.find((a) => a.id === next.agentId) : null;
  const who = agent ? (agent.description ? `${agent.description} (${agent.type ? t("views.kindTyped", { type: agent.type }) : t("views.kindPlain")})` : `${subagentName(agent)} (${t("views.kindPlain")})`) : t("views.anotherRequest");
  return t("views.next", { who, what: isQuestion(next) ? (next.questions[0]?.question ?? t("views.aQuestion")) : next.command });
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

/**
 * Keeps a card whose lines vary from filling up to its edges: measures what
 * its stack holds and asks the island for the height that leaves the least
 * air a card keeps. A card with room to spare is left as tall as it always was.
 */
function airy(lines: HTMLElement, onResize: () => void): { fit(): void; readonly height: number | undefined } {
  let height: number | undefined;
  const fit = () => {
    const parts = [...lines.children].map((child) => (child as HTMLElement).offsetHeight).filter((h) => h > 0);
    const gap = parseFloat(getComputedStyle(lines).rowGap) || 0;
    const content = parts.reduce((sum, part) => sum + part, 0) + gap * Math.max(0, parts.length - 1);
    // Not on screen yet: nothing to measure, the layout's own height stands.
    const next = parts.length > 0 ? fittedHeight(content, CARD_AIR_MIN) : undefined;
    if (next === height) return;
    height = next;
    onResize();
  };
  // Measured again when the card's width changes: while the island is still
  // opening it is narrow, its lines wrap, and it looks taller than it is.
  new ResizeObserver(fit).observe(lines);
  return {
    fit,
    get height() {
      return height;
    },
  };
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  // The two tabs: Home, the agents; the Shelf, the widgets. A click on one
  // never leaves it with the focus (island.ts stops that for every button).
  const tabHome = h("button", { class: "tab named", title: () => t("views.tab.homeTip"), onclick: () => go("overview") }, svg(ICONS.house, 13), () => t("views.tab.home"));
  const tabShelf = h("button", { class: "tab named", title: () => t("views.tab.shelfTip"), onclick: () => go("shelf") }, svg(ICONS.shelf, 13), () => t("views.tab.shelf"));

  // The session panel's own button: its normal size, or as large as the display has room for.
  const expandBtn = h("button", { class: "expand ha", onclick: () => actions.setLarge(!State.large) });
  // A click on it does not leave it with the focus: the keyboard, which the
  // large panel takes, is for the sidebar and for Escape — Enter must not shrink the panel back.
  expandBtn.addEventListener("mousedown", (e) => e.preventDefault());
  let expandKey = "";
  const gearBtn = h("button", { class: "ha", title: () => t("views.settings"), "aria-label": () => t("views.settings"), onclick: () => go("settings") }, lucide(LUCIDE.slidersHorizontal, 15, 1.75));
  const soundBtn = h("button", { class: "ha", onclick: () => actions.toggleSound() });
  let soundKey = "";
  // The way to fold the island at once, without waiting for it to fold by itself: an arrow toward the edge it is docked to.
  const foldBtn = h("button", { class: "ha fold", onclick: () => actions.collapse() });
  let foldKey = "";
  // A newer Oleo is out, and the user asked to be told (core/update.ts): the way to its release page.
  const updateBtn = h("button", { class: "ha ha-update", onclick: () => {
    actions.blip();
    Update.open();
  } }, lucide(LUCIDE.download, 15, 1.75), h("i"));
  updateBtn.style.display = "none";
  let updateKey = "";
  // The machine and Claude's usage: written when a sample or a usage comes, never on a timer.
  const stats = buildHeaderStats();
  const weather = buildWeather();
  State.onGauges(stats.draw);
  stats.draw();

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabShelf),
    weather.el,
    stats.el,
    h("div", { class: "header-actions" }, updateBtn, expandBtn, gearBtn, soundBtn, foldBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      void weather.sync(State.settings.weatherLocation, State.mode === "expanded");
      // The session panel is reached from the overview and goes back to it.
      tabHome.classList.toggle("on", v === "overview" || v === "empty" || v === "session");
      tabShelf.classList.toggle("on", v === "shelf");
      // Drawn again only when it changes: rebuilt between a mouse-down and its mouse-up, it would swallow the click.
      const nextExpand = `${v === "session"}:${State.large}:${currentLang()}`;
      if (nextExpand !== expandKey) {
        expandKey = nextExpand;
        expandBtn.style.display = v === "session" ? "" : "none";
        clear(expandBtn);
        expandBtn.append(svg(State.large ? ICONS.shrink : ICONS.expand, 13, { stroke: 2 }));
        expandBtn.title = State.large ? t("views.shrink") : t("views.expand");
        expandBtn.classList.toggle("on", State.large);
      }
      gearBtn.classList.toggle("on", v === "settings");
      const soundOn = State.settings.soundEnabled;
      const nextSound = `${soundOn}:${currentLang()}`;
      if (nextSound !== soundKey) {
        soundKey = nextSound;
        clear(soundBtn);
        soundBtn.append(lucide(soundOn ? LUCIDE.volume2 : LUCIDE.volumeX, 15, 1.75));
        soundBtn.title = soundBtn.ariaLabel = soundOn ? t("views.mute") : t("views.unmute");
      }
      const dock = State.settings.dock;
      const nextFold = `${dock}:${currentLang()}`;
      if (nextFold !== foldKey) {
        foldKey = nextFold;
        clear(foldBtn);
        const toward = dock === "bottom" ? ICONS.chevronDown : dock === "left" ? ICONS.chevronLeft : dock === "right" ? ICONS.chevronRight : ICONS.chevronUp;
        foldBtn.append(svg(toward, 14, { stroke: 2 }));
        foldBtn.title = foldBtn.ariaLabel = t("views.fold");
      }
      const offered = Update.offered;
      const nextUpdate = `${offered?.latest ?? ""}:${currentLang()}`;
      if (nextUpdate !== updateKey) {
        updateKey = nextUpdate;
        updateBtn.style.display = offered ? "" : "none";
        updateBtn.title = updateBtn.ariaLabel = offered ? t("views.updateOut", { v: offered.latest }) : "";
      }
      stats.draw();
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: () => t("views.empty.title") }),
      h("div", { class: "sub", text: () => t("views.empty.sub") }),
    ),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

/** How many lines of an edit's diff the card shows before "See all the changes". */
const DIFF_PEEK_LINES = 6;
/** Asked for whole, the island grows by the height of this many more lines of the diff, at most. */
const DIFF_MORE_LINES = 10;
/** A line of a diff, in pixels (`.gh-diff-line`). */
const DIFF_LINE_H = 16;
/** The card's column for the bot, and where the text starts: the same for a permission and a question. */
const CARD_TEXT_LEFT = 92;

function buildApproval(actions: ViewActions, onResize: () => void): ViewHost {
  // The request the card was last armed for, and when its buttons start to count.
  let armedFor = "";
  let armedAt = 0;
  // The whole diff, over the island's full height, instead of its first lines: asked for per request.
  let showAll = false;
  const decide = (decision: "allow" | "deny") => {
    // The request a click answers is the one the card has drawn, and has shown
    // for long enough. With several waiting, the next takes the card the
    // moment one is answered — before the card is drawn again: a second click
    // on the same spot must not answer a request nobody has seen.
    if ((State.pendingApproval?.requestId ?? "") !== armedFor || performance.now() < armedAt) return;
    actions.decide(decision);
  };
  const who = h("div", { class: "ask-who" });
  // All of what is asked, however long: it wraps, and scrolls past a few lines.
  const code = h("div", { class: "code asked" });
  // For an edit: the diff it would make, between what is asked and the answer.
  const proposed = h("div", { class: "proposed gh-code" });
  // Under the diff, when it is longer than what the card shows: all of it, or back.
  const more = h("button", {
    class: "link-btn more-changes",
    onclick: () => {
      showAll = !showAll;
      State.notify();
    },
  });
  const row = h("div", { class: "actions" });
  // Behind the request on the card: the one that asked next.
  const next = h("div", { class: "who-next" });
  const lines = stack(CARD_TEXT_LEFT, 16, who, code, proposed, more, row, next);
  const el = h("div", { class: "view" }, card("amber", lines));
  // How tall the card was with a few lines of its diff: what asking for all of them grows from.
  let peekHeight: number | undefined;
  const air = airy(lines, () => {
    if (!showAll) peekHeight = air.height;
    onResize();
  });
  let rowKey = "";
  let proposedKey = "";
  // The lines of the diff on the card, and how they are laid out in it: a few, or all.
  let diffRows: HTMLElement[] = [];
  let diffFirst = 0;
  let diffAll: boolean | null = null;
  return {
    el,
    // An edit's diff, asked for whole: the card grows by the lines it has to show, and the diff takes the room.
    // Otherwise the card is as tall as its lines, the diff showing a few.
    get height() {
      if (!State.pendingApproval?.proposal || !showAll) return air.height;
      const more = Math.min(DIFF_MORE_LINES, Math.max(0, diffRows.length - DIFF_PEEK_LINES));
      return peekHeight === undefined ? undefined : peekHeight + more * DIFF_LINE_H;
    },
    // Not on screen yet, so with no height to grow from: the island's own room for a diff.
    get roomy() {
      return State.pendingApproval?.proposal != null && showAll && peekHeight === undefined;
    },
    arm() {
      armedAt = performance.now() + REQUEST_ARM_MS;
    },
    sync() {
      const approval = State.pendingApproval;
      const proposal = approval?.proposal ?? null;
      // Armed once per request, from the moment its card is drawn. The card
      // looks the same while it is arming; only the click waits.
      const asked = approval?.requestId ?? "";
      if (asked !== armedFor) {
        armedFor = asked;
        armedAt = performance.now() + REQUEST_ARM_MS;
        showAll = false;
      }
      clear(who);
      const asking = askerWho(approval, t("views.needsPermission"), COLOR.amber);
      if (proposal) asking.append(plusMinus(proposal.additions, proposal.deletions));
      who.append(asking);
      next.textContent = next.title = nextWords(State.session);
      next.style.display = next.textContent ? "" : "none";
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = proposal
        ? `${approval?.tool} · ${proposal.path}${proposal.created ? t("views.newFile") : ""}`
        : approval?.command || approval?.tool || "…";
      // What that edit would do, line by line, before it is allowed. Drawn once
      // per request: a list redrawn under the mouse would lose its scroll.
      proposed.style.display = proposal ? "" : "none";
      // A few lines of it, none cut, or — asked for whole — all the room the card has grown by.
      proposed.classList.toggle("capped", proposal != null && !showAll);
      const nextProposed = proposal ? (approval?.requestId ?? "") : "";
      if (nextProposed !== proposedKey) {
        proposedKey = nextProposed;
        diffAll = null;
        diffRows = [];
        diffFirst = 0;
        if (proposal) {
          const kind = fileKind(proposal.path);
          for (const line of readPatch(proposal.patch)) {
            if (!("hunk" in line)) diffRows.push(diffLine(line.new ?? line.old, line.sign, line.text, kind));
          }
          diffFirst = Math.max(0, diffRows.findIndex((r) => r.classList.contains("add") || r.classList.contains("del")));
          if (proposal.truncated) {
            diffRows.push(
              h("div", { class: "gh-diff-line hunk" }, h("span", { class: "n", text: "⋯" }), h("span", { class: "s" }), h("span", { class: "t", text: t("views.editRest") })),
            );
          }
        }
      }
      // Few lines, whole: from a line of context above the first change, so none is cut in half.
      // All of them: the diff scrolls in the room the island gives it, opening on that same line.
      if (diffAll !== showAll) {
        diffAll = showAll;
        clear(proposed);
        if (proposal) {
          const start = showAll ? 0 : Math.max(0, Math.min(diffFirst - 1, diffRows.length - DIFF_PEEK_LINES));
          const diff = h("div", { class: "gh-diff" }, ...(showAll ? diffRows : diffRows.slice(start, start + DIFF_PEEK_LINES)));
          proposed.append(diff);
          const first = diff.querySelector<HTMLElement>(".add, .del");
          proposed.scrollTop = showAll && first ? Math.max(0, first.offsetTop - diff.offsetTop - first.offsetHeight) : 0;
        }
      }
      // More lines than the card shows: all of them one click away.
      const longer = proposal != null && diffRows.length > DIFF_PEEK_LINES;
      more.style.display = longer ? "" : "none";
      more.textContent = showAll ? t("views.seeLess") : t("views.seeChanges", { count: (proposal?.additions ?? 0) + (proposal?.deletions ?? 0) });
      // Allow, Deny, and the session on the right — built once per kind of request. Rebuilding
      // them between a mouse-down and a mouse-up would swallow the click. A request too long
      // to show whole has no Allow or Deny: it is answered in Claude Code, which shows it all.
      const nextRow = `${approval?.tooLong ? "too-long" : "buttons"}:${currentLang()}`;
      if (rowKey !== nextRow) {
        rowKey = nextRow;
        clear(row);
        if (approval?.tooLong) {
          row.append(h("span", { class: "too-long", text: t("views.tooLong", { client: State.clientName }) }));
        } else {
          row.append(
            btn(t("views.allow"), "primary", () => decide("allow")),
            btn(t("views.deny"), "secondary", () => decide("deny")),
            h("button", { class: "btn ghost end", onclick: () => actions.openSession() }, h("span", { text: t("views.seeSession") })),
          );
        }
      }
      air.fit();
      if (!showAll) peekHeight = air.height;
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

/** Several options picked for one question go back as one answer, as Claude Code writes them. */
const ANSWER_JOIN = ", ";
/** A click in the field asks the window for the keyboard; this long later it has it. */
const FOCUS_MS = 120;

/**
 * A question Claude asks with its question tool, answered here: one question
 * at a time, each option with what it means beside it.
 * "Other…" takes a typed answer. The last answer sends them all — and the
 * session, wherever it runs, goes on as if they had been picked there.
 */
function buildQuestion(actions: ViewActions, onResize: () => void): ViewHost {
  const who = h("div", { class: "ask-who" });
  const title = h("div", { class: "title q-title" });
  const row = h("div", { class: "actions q-options" });
  const hint = h("span", { class: "q-hint" });
  const back = h("button", { class: "link-btn q-link", text: () => t("views.q.back") });
  const pass = h("button", { class: "link-btn q-link", onclick: () => seen() && actions.passQuestion() });
  const skip = h("button", { class: "btn secondary q-skip", text: () => t("views.q.skip"), title: () => t("views.q.skipTip"), onclick: () => seen() && actions.skipQuestion() });
  // Under a list of options: "Other…", and Send when several can be picked.
  const tail = h("div", { class: "q-tail" });
  const foot = h("div", { class: "q-foot" }, tail, hint, h("div", { class: "grow" }), back, pass, skip);
  const field = h("input", {
    class: "island-field", type: "text", maxlength: "2000", autocomplete: "off", spellcheck: "false",
    placeholder: () => t("views.q.placeholder"),
  }) as HTMLInputElement;
  const lines = stack(CARD_TEXT_LEFT, 16, who, title, row, foot);
  // A question with more options than the window is tall for fills its card:
  // the list of options scrolls, and the card keeps its least air around it.
  lines.style.paddingTop = lines.style.paddingBottom = `${CARD_AIR_MIN}px`;
  const el = h("div", { class: "view" }, card("cyan", lines));

  /** The request all of this is about: a new one starts from the first question. */
  let request = "";
  let at = 0;
  /** One answer per question answered so far. */
  let answers: string[] = [];
  /** A question that takes several: the labels picked so far. */
  let picked = new Set<string>();
  let typing = false;
  let key = "";
  /** The island's height for what the card holds now; unset until it has been measured. */
  let height: number | undefined;
  /** When a fresh question starts taking answers: see REQUEST_ARM_MS. */
  let armedAt = 0;
  /** True once the card has drawn the question that waits, and shown it for long enough: only then does a click count. */
  const seen = () => (State.pendingQuestion?.requestId ?? "") === request && performance.now() >= armedAt;

  /** Asks the island for the room the card's content takes, no more. */
  function fit() {
    // The card's lines, and the gap the stack leaves between each two of them.
    const parts = [who.offsetHeight, title.offsetHeight, row.scrollHeight, foot.offsetHeight];
    const gap = parseFloat(getComputedStyle(lines).rowGap) || 0;
    const content = parts.reduce((sum, part) => sum + part, 0) + gap * (parts.length - 1);
    // Not on screen yet: nothing to measure, the layout's own height stands.
    const next = who.offsetHeight > 0 ? fittedHeight(content) : undefined;
    if (next === height) return;
    height = next;
    onResize();
  }

  // Measured again whenever the card's width changes: while the island is still
  // opening it is narrow, the lines wrap, and the content looks taller than it is.
  new ResizeObserver(() => fit()).observe(el);

  function settle(value: string) {
    const info = State.pendingQuestion;
    if (!info || !value) return;
    // Only the question the card has drawn, once it has been up long enough: see buildApproval's `decide`.
    if (info.requestId !== request || performance.now() < armedAt) return;
    answers[at] = value;
    stopTyping();
    picked = new Set();
    if (at + 1 < info.questions.length) {
      at++;
      actions.blip();
      State.notify();
      return;
    }
    const out: Record<string, string> = {};
    info.questions.forEach((q, i) => (out[q.question] = answers[i] ?? ""));
    actions.answer(out);
  }

  function stopTyping() {
    typing = false;
    field.value = "";
    field.blur();
  }

  field.addEventListener("blur", () => actions.keyboard(false));
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") settle(field.value.trim());
    else if (e.key === "Escape") {
      stopTyping();
      State.notify();
    }
  });
  back.addEventListener("click", () => {
    if (at === 0) return;
    at--;
    stopTyping();
    picked = new Set();
    actions.blip();
    State.notify();
  });

  function draw() {
    const info = State.pendingQuestion;
    if ((info?.requestId ?? "") !== request) {
      request = info?.requestId ?? "";
      armedAt = performance.now() + REQUEST_ARM_MS;
      at = 0;
      answers = [];
      picked = new Set();
      typing = false;
      key = "";
    }
    // Rebuilding the buttons between a mouse-down and its mouse-up would
    // swallow the click, so only rebuild when what they show has changed.
    const asker = info?.agentId ? State.session.subagents.find((a) => a.id === info.agentId) : null;
    const next = [
      request, at, typing, [...picked].join("|"), State.clientName, State.waiting.length,
      requestsOf(State.session).length, asker?.type, asker?.description, currentLang(),
    ].join("~");
    if (next === key) return;
    key = next;

    const task = State.tasks.find((t) => t.id === CLAUDE_ID) ?? State.focusTask;
    const q = info?.questions[at];
    clear(who);
    clear(row);
    clear(tail);
    pass.textContent = t("views.q.answerIn", { client: State.clientName });
    back.style.display = at > 0 ? "" : "none";
    if (!info || !q) {
      who.append(askerWho(info, t("views.asking"), COLOR.cyan));
      title.textContent = task?.steps.at(-1) ?? t("views.q.needsAnswer");
      hint.textContent = "";
      pass.style.display = "none";
      skip.style.display = "none";
      return;
    }
    pass.style.display = "";
    skip.style.display = "";

    const asking = askerWho(info, t("views.asking"), COLOR.cyan);
    if (q.header) asking.append(h("span", { class: "q-chip", text: q.header }));
    if (info.questions.length > 1) asking.append(h("span", { class: "q-count", text: t("views.q.count", { at: at + 1, total: info.questions.length }) }));
    who.append(asking);
    title.textContent = q.question;
    title.title = q.question;

    const rest = q.multiSelect ? t("views.q.pickMany") : "";
    hint.textContent = rest;

    if (typing) {
      row.classList.remove("q-list");
      row.append(
        field,
        btn(at + 1 < info.questions.length ? t("views.q.next") : t("views.q.send"), "primary", () => settle(field.value.trim())),
        btn(t("views.q.return"), "secondary", () => {
          stopTyping();
          State.notify();
        }),
      );
      return;
    }

    // Options that explain themselves are read before they are picked: each
    // on a line of its own, what it means beside its name. Bare labels stay
    // the row of buttons of the prototype.
    const explained = q.options.some((o) => o.description);
    row.classList.toggle("q-list", explained);
    for (const option of q.options) {
      const on = picked.has(option.label);
      const el = explained
        ? h(
            "button",
            { class: on ? "q-row on" : "q-row" },
            h("b", { text: option.label }),
            h("span", { text: option.description ?? "", title: option.description ?? "" }),
          )
        : h("button", { class: on ? "btn secondary q-opt on" : "btn secondary q-opt" }, h("span", { text: option.label }));
      el.addEventListener("click", () => {
        if (!q.multiSelect) return settle(option.label);
        if (!picked.delete(option.label)) picked.add(option.label);
        State.notify();
      });
      row.append(el);
    }
    // After the options: in the row of buttons, or under the list, at its foot.
    const after = explained ? tail : row;
    after.append(
      h("button", {
        class: "btn secondary q-opt other",
        text: t("views.q.other"),
        onclick: () => {
          typing = true;
          State.notify();
          actions.keyboard(true);
          window.setTimeout(() => field.focus(), FOCUS_MS);
        },
      }),
    );
    if (q.multiSelect) {
      after.append(
        btn(at + 1 < info.questions.length ? t("views.q.next") : t("views.q.send"), "primary", () =>
          // In the order the options are listed, not the order they were clicked.
          settle(q.options.filter((o) => picked.has(o.label)).map((o) => o.label).join(ANSWER_JOIN)),
        ),
      );
    }
  }

  return {
    el,
    get height() {
      return height;
    },
    arm() {
      armedAt = performance.now() + REQUEST_ARM_MS;
    },
    sync() {
      draw();
      fit();
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions, onResize: () => void): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: () => t("views.error.title") });
  const detail = h("div", { class: "detail" });
  // Where what stopped runs: the Claude app, a terminal — the pill's own way out.
  const openLabel = h("span");
  const openBtn = h("button", { class: "btn secondary", onclick: () => actions.openTarget() }, openLabel);
  const row = h("div", { class: "actions" },
    btn(() => t("views.error.retry"), "primary", () => actions.leaveCard(false)),
    openBtn,
  );
  const lines = stack(116, 16, who, title, detail, row);
  const el = h("div", { class: "view" }, card("red", lines));
  const air = airy(lines, onResize);
  return {
    el,
    get height() {
      return air.height;
    },
    sync() {
      const task = State.focusTask;
      clear(who);
      // A Claude Code session is named by its conversation; a third-party
      // agent's pill by its own name.
      who.append(task?.id === CLAUDE_ID ? sessionWho(TOOL_NAME[State.session.agent]) : agentWho(task, t("views.stopped")));
      detail.textContent = task?.steps.at(-1) ?? t("views.error.noDetail");
      // Nowhere known to go to — another agent's pill, a session that has not
      // said where it runs — and the button is not there.
      const session = task?.id === CLAUDE_ID ? State.session : NO_SESSION;
      const words = targetWords(session.target);
      openBtn.style.display = words ? "" : "none";
      openLabel.textContent = words ?? "";
      openBtn.title = targetTip(session) ?? "";
      air.fit();
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions, onResize: () => void): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  // Built once, like every button of a card: only its words follow the session.
  const openLabel = h("span");
  const openBtn = h("button", { class: "btn primary", onclick: () => actions.openTerminal() }, openLabel);
  const changesLabel = h("span");
  const changesBtn = h("button", { class: "btn secondary", onclick: () => actions.openSession(true) }, changesLabel);
  // What Claude said, in full: the card only has room for its first words.
  const readBtn = h("button", { class: "btn primary", onclick: () => actions.openSession() }, h("span", { text: () => t("views.readReply") }));
  const row = h("div", { class: "actions" },
    readBtn,
    openBtn,
    changesBtn,
    btn("OK", "secondary", () => actions.leaveCard(true)),
  );
  // A line to answer with, where a reply can reach the session (views/reply-box.ts).
  const replyBox = buildReplyBox(actions, "card", () => air.fit());
  const lines = stack(116, 16, who, title, replyBox.el, row);
  const el = h("div", { class: "view" }, card("green", lines));
  const air = airy(lines, onResize);
  return {
    el,
    get height() {
      return air.height;
    },
    sync() {
      clear(who);
      // A third-party agent's pill has no session behind it: its name, its last step, and OK.
      const claude = State.focusTask?.id === CLAUDE_ID;
      replyBox.sync(claude ? State.session : null);
      // A reply given while subagents still run is told on this card too, as
      // what it is: the session has replied, and is not finished.
      const replied = claude ? repliedWords(State.session) : null;
      who.append(claude ? sessionWho(replied ?? t("views.finished")) : agentWho(State.focusTask, t("views.finished")));
      // What Claude said to end its turn, its first line; its last step otherwise.
      const answer = claude ? firstWords(State.session.answer) : null;
      title.textContent = answer ?? State.focusTask?.steps.at(-1) ?? t("views.sessionFinished");
      // An answer is a sentence, not a step: smaller, and two lines at most.
      title.classList.toggle("said", answer != null);
      readBtn.style.display = answer ? "" : "none";
      openBtn.className = answer ? "btn secondary" : "btn primary";
      // Where the session runs, and what it left behind: the way to its diffs.
      const files = claude ? State.sessionFiles.length : 0;
      const words = claude ? targetWords(State.session.target) : null;
      openBtn.style.display = words ? "" : "none";
      openLabel.textContent = words ?? "";
      openBtn.title = claude ? targetTip(State.session) ?? "" : "";
      changesBtn.style.display = files > 0 ? "" : "none";
      changesLabel.textContent = t("views.filesChanged", { count: files });
      air.fit();
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: () => t("views.confused.title") }),
    h("div", { class: "sub", text: () => t("views.confused.sub") }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── In-island settings ────────────────────────────────────────────────────────

/** Where the sound's slider tops out; the sheet writes the volume as a share of it. */
const VOLUME_MAX = 0.2;
/** The auto-close times the sheet offers, as the settings window does; any other value is "Otro". */
const AUTO_CLOSE_PRESETS = [3, 5, 10, 15, 30] as const;
const autoCloseNote = () => t("views.autoCloseNote");

/**
 * The settings of the island on a left or right edge: the quick panel as a
 * sheet as wide as Home — sound, auto-close and the way to the full window
 * (layout.ts SETTINGS_SIDE_H). style.css shows it on a side and hides it at the
 * top and bottom, where the bar below stays as it was.
 */
function buildSettingsSheet(actions: ViewActions): { el: HTMLElement; sync(): void } {
  const iconOn = lucide(LUCIDE.volume2, 18, 1.8);
  iconOn.classList.add("ss-ico-on");
  const iconOff = lucide(LUCIDE.volumeX, 18, 1.8);
  iconOff.classList.add("ss-ico-off");
  const mute = h("button", {
    class: "ss-mute", type: "button", "aria-label": () => t("views.mute"), "aria-pressed": "false", onclick: () => actions.toggleSound(),
  }, iconOn, iconOff);
  const volume = h("input", {
    class: "ss-volume", type: "range", min: "0", max: String(VOLUME_MAX), step: "0.005", "aria-label": () => t("views.volume"),
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const level = h("span", { class: "ss-level", "aria-hidden": "true" });

  // The five times, then "Otro…", which is the way to the settings window's own field for any other.
  const presets = AUTO_CLOSE_PRESETS.map((seconds) =>
    h("button", {
      class: "ss-opt", type: "button", role: "radio", "aria-checked": "false", tabindex: "-1",
      onclick: () => actions.setAutoClose(seconds),
    }, `${seconds} s`),
  );
  const other = h("button", {
    class: "ss-opt", type: "button", role: "radio", "aria-checked": "false", onclick: () => actions.openSettingsWindow(),
  }, () => t("views.other"));
  const group = h("div", { class: "ss-seg", role: "radiogroup", "aria-label": () => t("views.closeAfter") }, ...presets, other);
  // The arrows go from one time to the next, as a group of radios does; they skip "Otro…", which opens a window.
  group.addEventListener("keydown", (e) => {
    const at = presets.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (at < 0 || step === 0) return;
    e.preventDefault();
    const next = presets[(at + step + presets.length) % presets.length];
    next.focus();
    next.click();
  });
  const note = h("p", { class: "ss-note" });
  const connection = h("div", { class: "ss-conn" });

  const el = h(
    "div",
    { class: "settings-side" },
    h(
      "div",
      { class: "ss-head" },
      h("div", { class: "ss-title", text: () => t("views.quick") }),
      connection,
    ),
    h(
      "section",
      { class: "ss-card", "aria-labelledby": "ss-sound" },
      h("h2", { class: "ss-label", id: "ss-sound", text: () => t("views.sound") }),
      h("div", { class: "ss-row" }, mute, volume, level),
    ),
    h(
      "section",
      { class: "ss-card", "aria-labelledby": "ss-close" },
      h("h2", { class: "ss-label", id: "ss-close", text: () => t("views.closeAfter") }),
      group,
      note,
    ),
    h("button", {
      class: "ss-all", type: "button", text: () => t("views.allSettings"), onclick: () => actions.openSettingsWindow(),
    }),
  );

  return {
    el,
    sync() {
      const s = State.settings;
      const muted = !s.soundEnabled;
      const share = Math.min(100, Math.max(0, Math.round((s.soundVolume / VOLUME_MAX) * 100)));
      el.classList.toggle("muted", muted);
      mute.setAttribute("aria-pressed", String(muted));
      mute.title = muted ? t("views.unmute") : t("views.mute");
      volume.value = String(s.soundVolume);
      volume.style.setProperty("--p", `${share}%`);
      volume.setAttribute("aria-valuetext", muted ? t("views.mutedPct", { n: share }) : `${share} %`);
      level.textContent = muted ? t("views.muted") : `${share} %`;

      // The time that is set is always the one marked: a preset, or "Otro…" for any other value.
      const at = AUTO_CLOSE_PRESETS.findIndex((p) => p === s.autoCloseInterval);
      presets.forEach((b, i) => {
        b.setAttribute("aria-checked", String(i === at));
        b.classList.toggle("on", i === at);
        // One stop for the group, on the time that is set (the first when it is another): the arrows do the rest.
        b.tabIndex = i === Math.max(at, 0) ? 0 : -1;
      });
      other.setAttribute("aria-checked", String(at < 0));
      other.classList.toggle("on", at < 0);
      note.textContent = at < 0 ? `${t("views.nowSeconds", { n: formatNumber(Number(s.autoCloseInterval.toFixed(1))) })} ${autoCloseNote()}` : autoCloseNote();

      clear(connection);
      connection.append(
        dot(s.hooksInstalled ? "#22C55E" : "#FF6B7A", 7),
        s.hooksInstalled ? t("views.connected") : t("views.notConnected"),
      );
    },
  };
}

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: () => t("views.sound") }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: () => t("views.settingsMore"),
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  // The bar, for the top and bottom docks; on a left or right edge the sheet stands in its place.
  const bar = card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows));
  bar.classList.add("settings-bar");
  const sheet = buildSettingsSheet(actions);
  const el = h("div", { class: "view" }, bar, sheet.el);

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = t("views.autoClose", { n: Math.round(s.autoCloseInterval) });
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#FF6B7A", 6),
        h("span", { text: "Claude Code" }),
      );
      sheet.sync();
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onResize: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildHome(actions, onResize));
  map.set("empty", buildEmpty());
  map.set("approval", buildApproval(actions, onResize));
  map.set("question", buildQuestion(actions, onResize));
  map.set("error", buildError(actions, onResize));
  map.set("finished", buildFinished(actions, onResize));
  map.set("confused", buildConfused());
  map.set("settings", buildSettings(actions));
  map.set("session", buildSession(actions));
  map.set("shelf", buildShelf(actions));
  return map;
}
