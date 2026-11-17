// The home view, one thing at a time (plans: Foco). A card with Durazno on its
// left says the one thing that most needs the user — a permission, a question,
// an error — with the command it is about and the buttons to answer it; with
// nothing waiting it says in a line how the sessions are doing. Under the card,
// one chip per session (the others, while the card is about one), in a row
// that scrolls sideways. Claude's usage is in the header (views/header-stats.ts).
// On a side dock the same two parts stand one above the other (style.css, layout.ts
// SIDE_LAYOUTS): the same elements, laid out by the stylesheet.
//
// The island's own bot is not drawn here: island.ts places it over the stage
// the card keeps for it (layout.ts VIEW_LAYOUTS.overview). Nothing here runs on
// its own either: the view is drawn when the state changes, and what depends on
// the time passing — "3 min ago", a session fading — when the island's slow
// timer says so.

import { HOME_STAGE, HOME_SIDE_BOT_H, REQUEST_ARM_MS, Room, homeFitted, sideDock, washRGBA, type BotStateName, type Wash } from "../core/layout";
import { State } from "../core/state";
import { clear, h, svg } from "./dom";
import { currentLang, t } from "../core/i18n";
import { ICONS } from "./icons";
import { toolMark } from "./tool";
import { roster, doingOf, labelOf, labelText, runningSubagents, span, stateWords, subagentColor, MAX_CHILD_DOTS, type Entry } from "./roster";
import type { ViewActions, ViewHost } from "./views";

/** The island's entrance curve (.view.on in style.css): what moves, moves like this. */
const SPRING = "cubic-bezier(0.3, 1.2, 0.4, 1)";

const WASH: Partial<Record<BotStateName, Wash>> = {
  approval: "amber", question: "cyan", error: "red", finished: "green",
};

interface Cell {
  el: HTMLButtonElement;
  kids: HTMLElement;
  mark: HTMLElement;
  /** What it was last drawn for: nothing is touched when that has not changed. */
  key: string;
}

/** What the card is for. */
type Mode = "allow" | "review" | "error" | "calm" | "empty";

export function buildHome(actions: ViewActions, onResize: () => void): ViewHost {
  // ── The card ────────────────────────────────────────────────────────────────
  const dot = h("i", { class: "dot" });
  const name = h("b", { class: "hf-name" });
  const words = h("span", { class: "hf-words" });
  const ago = h("span", { class: "hf-ago" });
  const head = h("div", { class: "hf-head" }, dot, name, words, ago);
  const title = h("div", { class: "hf-title" });
  const sub = h("div", { class: "hf-sub" });
  /** What is asked, whole: a long command wraps and scrolls, as on the request's own card. */
  const code = h("div", { class: "code asked hf-code" });

  /** The session the card speaks for: what its buttons go to. */
  let frontId = "";
  /** The permission the Allow and Deny on the card answer; "" when there is none. */
  let askedId = "";
  /** From when a fresh permission takes clicks: see REQUEST_ARM_MS. */
  let armedAt = 0;
  let mode: Mode = "calm";
  let emptyAct: (() => void) | null = null;

  // Built once: rebuilt between a mouse-down and its mouse-up, a button would swallow the click.
  const decide = (decision: "allow" | "deny") => {
    // The request a click answers is the one the card has drawn, in front of the
    // island, and has shown for long enough. Nothing is allowed that was not read.
    if (askedId === "" || State.pendingApproval?.requestId !== askedId || performance.now() < armedAt) return;
    actions.decide(decision);
  };
  const allowLabel = h("span");
  const denyLabel = h("span");
  const goLabel = h("span");
  const seeLabel = h("span");
  const allow = h("button", { class: "btn primary", onclick: () => decide("allow") }, allowLabel);
  const deny = h("button", { class: "btn secondary", onclick: () => decide("deny") }, denyLabel);
  const go = h("button", { class: "btn primary", onclick: () => frontId && actions.reviewRequest(frontId) }, goLabel);
  const see = h("button", { class: "btn ghost end", onclick: () => frontId && open(frontId) }, seeLabel);
  const emptyLabel = h("span");
  const emptyBtn = h("button", { class: "btn secondary", onclick: () => emptyAct?.() }, emptyLabel);
  const buttons = h("div", { class: "actions hf-actions" }, allow, deny, go, see, emptyBtn);

  const stage = h("div", { class: "hf-stage" });
  const body = h("div", { class: "hf-body" }, head, title, sub, code, buttons);
  const card = h("div", { class: "card wash home-focus" }, stage, body);
  card.addEventListener("click", (e) => {
    if (!frontId || (e.target as Element).closest("button, .code")) return;
    open(frontId);
  });

  // ── The chips: one per session ──────────────────────────────────────────────
  const alsoLabel = h("span", { class: "hc-label" });
  const row = h("div", { class: "hc-row" });
  const turnOn = h("button", { class: "hc-turnon", onclick: () => actions.openSettingsWindow() });
  const chips = h("div", { class: "home-chips" }, alsoLabel, row, turnOn);
  row.addEventListener("scroll", () => edge(), { passive: true });
  // Its width is known only once it is on show: the fade is drawn then.
  new ResizeObserver(() => edge()).observe(row);
  // A wheel turned over the row moves it sideways: that is the way it goes.
  row.addEventListener("wheel", (e) => {
    if (sideDock(Room.dock) || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    row.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  const home = h("div", { class: "home" }, card, chips);
  const el = h("div", { class: "view" }, home);
  // Home upright on a side: the card's height and the stage's width, said once (layout.ts), read by the stylesheet.
  el.style.setProperty("--home-side-bot", `${HOME_SIDE_BOT_H}px`);
  el.style.setProperty("--hf-side-stage", `${HOME_STAGE.column.w}px`);
  el.style.setProperty("--hf-stage-h", `${HOME_STAGE.column.h}px`);

  // ── What is on show ─────────────────────────────────────────────────────────
  const cells = new Map<string, Cell>();
  let entries = new Map<string, Entry>();
  /** Where each stood last time: nothing reshuffles in the row under the pointer. */
  let lastIndex = new Map<string, number>();
  let pointerInRow = false;
  let orderKey = "";
  let emptyKey = "";
  let fitted: number | undefined;

  row.addEventListener("pointerenter", () => { pointerInRow = true; });
  row.addEventListener("pointerleave", () => { pointerInRow = false; State.notify(); });

  /** A session's panel — or, when it is waiting for an answer, the card that asks. Another agent's pill has neither. */
  function open(id: string) {
    const entry = entries.get(id);
    if (!entry?.session) return;
    actions.openSessionOf(id);
  }

  /** The row fades out at the edge where there is more of it to scroll to. */
  function edge() {
    row.classList.toggle("more", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  }

  function makeCell(entry: Entry): Cell {
    // A result nobody has opened: a dot — or, when its reply waits on a decision, a "!" in that colour.
    const mark = h("i", { class: "unseen" }, svg(ICONS.bang, 9));
    const kids = h("span", { class: "kids" });
    const dotEl = h("i", { class: "dot" });
    const label = h("span", { class: "agent-name" });
    const state = h("span", { class: "agent-state" });
    // Which tool it is, at the corner: the chip's colour says what it does, never whose it is.
    const tool = entry.session ? toolMark(entry.session.agent, 9) : null;
    if (tool) tool.classList.add("corner");
    const cell = h("button", { class: "agent" }, dotEl, label, state, mark, kids, tool);
    const id = entry.id;
    cell.addEventListener("click", (e) => { e.stopPropagation(); open(id); });
    // A click does not leave it with the focus: the keyboard is the panel's.
    cell.addEventListener("mousedown", (e) => e.preventDefault());
    return { el: cell, kids, mark, key: "" };
  }

  function updateCell(cell: Cell, entry: Entry) {
    const running = entry.session ? runningSubagents(entry.session) : [];
    const { name: who, n } = labelOf(entry);
    const state = stateWords(entry);
    const doing = doingOf(entry);
    const key = [entry.state, entry.lane, entry.unseen, entry.decision, entry.color, who, n, state, doing, running.map((r) => (r.asking ? "a" : "r")).join(""), currentLang()].join("~");
    if (key === cell.key) return;
    cell.key = key;
    cell.el.classList.toggle("rest", entry.lane === "done");
    cell.el.classList.toggle("calls", entry.lane === "needs");
    (cell.el.querySelector(".dot") as HTMLElement).style.background = entry.color;
    (cell.el.querySelector(".agent-name") as HTMLElement).textContent = n == null ? who : `${who} ·${n}`;
    (cell.el.querySelector(".agent-state") as HTMLElement).textContent = state;
    // One mark at its corner: the decision's comes before the plain "unseen".
    cell.mark.hidden = !(entry.unseen || entry.decision);
    cell.mark.classList.toggle("decide", entry.decision);
    cell.el.title = `${labelOf(entry).path}\n${doing}`.trim();

    clear(cell.kids);
    for (const r of running.slice(0, MAX_CHILD_DOTS)) {
      cell.kids.append(h("i", { class: r.asking ? "asking" : "", style: `--c:${subagentColor(r.asking)}` }));
    }
    if (running.length > MAX_CHILD_DOTS) cell.kids.append(h("small", { text: `+${running.length - MAX_CHILD_DOTS}` }));
  }

  /** A chip that leaves fades where it stands, out of the row's flow, while the others close up. */
  function dropCell(id: string, cell: Cell) {
    cells.delete(id);
    if (!cell.el.isConnected || !el.classList.contains("on")) return cell.el.remove();
    const r = cell.el.getBoundingClientRect();
    const base = chips.getBoundingClientRect();
    cell.el.style.position = "absolute";
    cell.el.style.left = `${r.left - base.left}px`;
    cell.el.style.top = `${r.top - base.top}px`;
    cell.el.style.pointerEvents = "none";
    chips.append(cell.el);
    const gone = cell.el.animate(
      [{ opacity: getComputedStyle(cell.el).opacity, transform: "none" }, { opacity: 0, transform: "scale(0.7)" }],
      { duration: 420, easing: "ease-in", fill: "forwards" },
    );
    gone.onfinish = () => cell.el.remove();
    gone.oncancel = () => cell.el.remove();
  }

  /** From where it was to where it is, on the island's curve. */
  function slide(node: HTMLElement, from: DOMRect | undefined) {
    if (!from) return;
    const to = node.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: SPRING });
  }

  function showOrder(live: Entry[]): Entry[] {
    const order = [...live];
    if (pointerInRow) {
      const at = (e: Entry) => lastIndex.get(e.id) ?? Number.POSITIVE_INFINITY;
      order.sort((a, b) => a.rank - b.rank || at(a) - at(b) || a.since - b.since);
    }
    lastIndex = new Map(order.map((e, i) => [e.id, i]));
    return order;
  }

  /** The chips: the sessions the card is not about, all of them, in the order they are most urgent. */
  function drawChips(shown: Entry[], also: boolean) {
    chips.hidden = shown.length === 0;
    alsoLabel.hidden = !also;
    alsoLabel.textContent = also ? t("home.also") : "";
    // The row is laid out again only when who stands where has changed.
    const nextOrder = shown.map((e) => e.id).join("|");
    const moved = nextOrder !== orderKey;
    orderKey = nextOrder;
    const on = el.classList.contains("on");

    // Where everything stands now, to move it from there to where it goes.
    const before = new Map<string, DOMRect>();
    if (moved && on) for (const [id, cell] of cells) before.set(id, cell.el.getBoundingClientRect());

    for (const [id, cell] of [...cells]) {
      if (!shown.some((e) => e.id === id)) dropCell(id, cell);
    }
    for (const entry of shown) {
      let cell = cells.get(entry.id);
      const fresh = !cell;
      if (!cell) {
        cell = makeCell(entry);
        cells.set(entry.id, cell);
      }
      updateCell(cell, entry);
      if (moved || fresh) row.append(cell.el);
      if (fresh && on) cell.el.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: SPRING });
    }
    if (moved && on) for (const [id, cell] of cells) slide(cell.el, before.get(id));

    // The way to turn Claude's usage on, while it is off: the header shows it once it is.
    const off = shown.length > 0 && State.usageInstalled === false;
    turnOn.hidden = !off;
    if (off) {
      turnOn.textContent = t("home.usage.turnOn");
      turnOn.title = t("home.usage.off");
    }
    edge();
  }

  /** How long ago, in the words a line of the card says it. */
  function howLong(since: number, now: number): string {
    const minutes = Math.floor((now - since) / 60_000);
    return minutes < 1 ? t("time.justNow") : t("home.since", { span: span(now - since) });
  }

  /** The line under the card's title when nothing waits: what the one at work is doing, or the last that finished. */
  function subOf(live: Entry[], working: Entry[], now: number): string {
    if (working.length === 1) return doingOf(working[0]);
    const done = live.filter((e) => e.lane === "done" && e.session && e.session.restedAt > 0).sort((a, b) => b.since - a.since)[0];
    return done ? t("home.sum.finished", { name: labelText(done), when: howLong(done.since, now) }) : "";
  }

  function show(node: HTMLElement, on: boolean) {
    node.hidden = !on;
  }

  function drawMain(front: Entry | null, tracked: number, live: Entry[], now: number) {
    frontId = front?.session?.id ?? "";
    card.classList.toggle("opens", frontId !== "");
    if (!front) return drawEmpty(tracked);
    emptyKey = "";
    show(emptyBtn, false);

    const resting = front.lane === "done";
    const wash = resting && front.decision ? "indigo" : resting && !front.unseen ? "soft" : (WASH[front.state] ?? (front.unseen ? "green" : "soft"));
    card.style.setProperty("--wash", washRGBA(wash));

    const session = front.session;
    const approval = session?.approval ?? null;
    const question = session?.question ?? null;

    if (front.lane === "needs") {
      // Allowed from here only when it is the request the island itself holds, and it can be read whole:
      // an edit is read as its diff, which has its own card, and a request too long has no Allow at all.
      const allowHere = approval != null && question == null && approval.proposal == null && !approval.tooLong && session?.id === State.frontId;
      mode = allowHere ? "allow" : question || approval ? "review" : "error";
      const request = question ?? approval;
      dot.style.background = front.color;
      name.textContent = labelText(front);
      name.title = labelOf(front).path;
      words.textContent = question ? t("views.asking") : stateWords(front);
      ago.textContent = `· ${howLong(front.since, now)}`;
      code.textContent = question
        ? question.questions[0]?.question ?? t("views.aQuestion")
        : approval
          ? approval.proposal ? `${approval.tool} · ${approval.proposal.path}` : approval.command || approval.tool || "…"
          : doingOf(front);
      code.title = "";
      // A request that is on the card for the first time takes clicks a moment later.
      const next = allowHere && approval ? approval.requestId : "";
      if (next !== askedId) {
        askedId = next;
        armedAt = performance.now() + REQUEST_ARM_MS;
      }
      allowLabel.textContent = t("views.allow");
      denyLabel.textContent = t("views.deny");
      goLabel.textContent = request ? (question ? t("home.answer") : t("home.review")) : t("views.seeSession");
      seeLabel.textContent = t("views.seeSession");
    } else {
      mode = "calm";
      askedId = "";
      const working = live.filter((e) => e.lane === "working");
      title.textContent = working.length > 1
        ? t("home.sum.working", { count: working.length })
        : working.length === 1 ? t("home.sum.workingOne", { name: labelText(working[0]) }) : t("home.sum.calm");
      sub.textContent = subOf(live, working, now);
      sub.title = sub.textContent;
    }

    const needs = mode !== "calm";
    show(head, needs);
    show(code, needs && code.textContent !== "");
    show(title, !needs);
    show(sub, !needs && sub.textContent !== "");
    show(allow, mode === "allow");
    show(deny, mode === "allow");
    show(see, mode === "allow");
    show(go, (mode === "review" || mode === "error") && frontId !== "");
    show(buttons, needs);
  }

  /** No session on show: one message, and the way out of it. */
  function drawEmpty(tracked: number) {
    mode = "empty";
    askedId = "";
    const missing = !State.settings.hooksInstalled && tracked === 0;
    card.style.setProperty("--wash", washRGBA("soft"));
    for (const node of [head, code, allow, deny, go, see]) show(node, false);
    show(title, true);
    show(buttons, true);
    const key = `${missing}:${tracked}:${currentLang()}`;
    if (key === emptyKey) return;
    emptyKey = key;
    if (missing) {
      title.textContent = t("home.empty.noHooks");
      sub.textContent = t("home.empty.noHooksSub");
      emptyLabel.textContent = t("home.openSettings");
      emptyAct = () => actions.openSettingsWindow();
    } else if (tracked > 0) {
      // Sessions are still followed: they have only been at rest long enough to leave the view.
      title.textContent = t("home.empty.noActive");
      sub.textContent = t("home.empty.resting", { count: tracked });
      emptyLabel.textContent = t("home.empty.show", { count: tracked });
      emptyAct = () => { actions.blip(); actions.openSessions(); };
    } else {
      title.textContent = t("home.empty.none");
      sub.replaceChildren(t("home.empty.runPre"), h("code", { class: "code", text: "claude" }), t("home.empty.runPost"));
      emptyLabel.textContent = "";
      emptyAct = null;
    }
    show(sub, true);
    show(emptyBtn, emptyAct != null);
  }

  /** How tall the island is for what is on the card: its own height and the chips', on a top or bottom dock. */
  function fit() {
    const next = sideDock(Room.dock) || home.offsetHeight === 0 ? undefined : homeFitted(home.offsetHeight);
    if (next === fitted) return;
    fitted = next;
    onResize();
  }
  new ResizeObserver(fit).observe(home);

  return {
    el,
    get height() {
      return fitted;
    },
    arm() {
      armedAt = performance.now() + REQUEST_ARM_MS;
    },
    sync() {
      const now = Date.now();
      const { live, faded } = roster(now);
      const order = showOrder(live);
      entries = new Map(order.map((e) => [e.id, e]));
      // The card speaks for the most urgent one, whatever the pointer holds in place in the row.
      const front = live[0] ?? null;
      drawMain(front, faded, live, now);
      // While the card is about one that needs the user, the chips are the others.
      if (front != null && front.lane === "needs") drawChips(order.filter((e) => e.id !== front.id), true);
      else drawChips(order, false);
      fit();
    },
  };
}
