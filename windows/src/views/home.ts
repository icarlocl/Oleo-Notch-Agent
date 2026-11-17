// The home view (plans/design-plan.md §1, plans/subagents-plan.md §7): three
// columns — the bot, speaking for the session that most needs attention; a
// mini bot per session, in lanes; the machine and Claude's usage limits. On a
// side dock the three stand one above the other (style.css, layout.ts
// SIDE_LAYOUTS): the same elements, laid out by the stylesheet.
//
// The island's own bot is not drawn here: island.ts places it over the stage
// the left card keeps for it (layout.ts VIEW_LAYOUTS.overview). Nothing here
// runs on its own either: the view is drawn when the state changes, the
// gauges when a sample comes, and what depends on the time passing — a
// session fading, "updated 3 min ago" — when the island's slow timer says so.

import { HOME_SIDE_BOT_H, HOME_SIDE_SESSIONS_H, HOME_STAGE, MAX_VISIBLE, washRGBA, type BotStateName, type Wash } from "../core/layout";
import { decisionWords, State, USAGE_OLD_MS, usageSourceWords, usageLevel, usageShown } from "../core/state";
import { clear, h, svg } from "./dom";
import { currentLang, t } from "../core/i18n";
import { ICONS } from "./icons";
import { LUCIDE, lucide } from "./iconset";
import { TOOL_NAME, toolMark } from "./tool";
import { wear } from "./palette";
import {
  MAX_CHILD_DOTS, doingOf, labelOf, labelText, roster, runningSubagents, span, stateWords, subagentColor,
  subagentWords, type Entry, type Lane,
} from "./roster";
import type { ViewActions, ViewHost } from "./views";

/** The island's entrance curve (.view.on in style.css): what moves, moves like this. */
const SPRING = "cubic-bezier(0.3, 1.2, 0.4, 1)";

const LANES: { key: Lane; title: () => string }[] = [
  { key: "needs", title: () => t("home.lane.needs") },
  { key: "working", title: () => t("home.lane.working") },
  { key: "done", title: () => t("home.lane.done") },
];

const WASH: Partial<Record<BotStateName, Wash>> = {
  approval: "amber", question: "cyan", error: "red", finished: "green",
};

interface Cell {
  el: HTMLButtonElement;
  kids: HTMLElement;
  mark: HTMLElement;
  /** What it was last drawn for: nothing is touched when that has not changed. */
  key: string;
  state: BotStateName | null;
}

/** The icons of the resources column, at the size of its words. */
const RES_ICON = 12;

export function buildHome(actions: ViewActions): ViewHost {
  // ── Left: the bot's card ────────────────────────────────────────────────────
  /** The tool the session is in — its mark and its name — before the project's. */
  const whoTool = h("span", { class: "who-tool" });
  const whoName = h("b", { class: "name" });
  const whoModel = h("span", { class: "model" });
  const whoState = h("span", { class: "words" });
  /** What the bot says, in a sentence: the one thing that most needs the user's eye. */
  const say = h("div", { class: "hb-say" });
  const doing = h("div", { class: "hb-doing" });
  /** The session the card speaks for: what its button goes to. */
  let frontId = "";
  // Built once: rebuilt between a mouse-down and its mouse-up, it would swallow the click.
  const reviewLabel = h("span");
  const review = h("button", { class: "btn primary", onclick: () => frontId && actions.reviewRequest(frontId) }, reviewLabel);
  const actionsRow = h("div", { class: "hb-actions" }, review);
  const botCard = h(
    "div", { class: "card wash home-bot" },
    h("div", { class: "hb-stage" }),
    say,
    h("div", { class: "hb-who" }, whoTool, whoName, whoModel, whoState),
    doing,
    actionsRow,
  );
  botCard.addEventListener("click", (e) => {
    if (!frontId || (e.target as Element).closest("button")) return;
    open(frontId);
  });

  // ── Middle: the lanes ───────────────────────────────────────────────────────
  const lanes = new Map<Lane, { el: HTMLElement; count: HTMLElement; bots: HTMLElement }>();
  for (const { key, title } of LANES) {
    const count = h("i");
    const bots = h("div", { class: "lane-bots" });
    lanes.set(key, { el: h("div", { class: `lane ${key}` }, h("div", { class: "lane-h" }, title, " ", count), bots), count, bots });
  }
  const more = h("button", { class: "hs-more", onclick: (e: Event) => { e.stopPropagation(); toggleList(); } });
  const laneRow = h("div", { class: "hs-lanes" }, ...LANES.map((l) => lanes.get(l.key)!.el), more);
  const foot = h("div", { class: "hs-foot" });
  const empty = h("div", { class: "hs-empty" });
  const list = h("div", { class: "hs-list" });
  const sessHead = h("div", { class: "lane-h hs-head" });
  const sessionsCard = h("div", { class: "card home-sessions" }, sessHead, laneRow, empty, foot, list);

  // ── Right: resources. Every line is built once and only its words change, so nothing moves. ──
  const usageRows = ([["5 h", LUCIDE.timer], ["7 d", LUCIDE.calendarDays]] as const).map(([label, icon]) => {
    const resets = h("span", { class: "res-sub" });
    const value = h("span", { class: "res-value" });
    const fill = h("i");
    const el = h(
      "div", { class: "res-row" },
      h("div", { class: "res-head" }, lucide(icon, RES_ICON), h("b", { text: label }), resets, value),
      h("div", { class: "res-bar" }, fill),
    );
    return { el, resets, value, fill };
  });
  const noUsage = h("div", { class: "res-none" });
  const noUsageBtn = h("button", { class: "btn primary", text: () => t("home.turnOn"), onclick: () => actions.openSettingsWindow() });
  const usageBox = h("div", { class: "res-usage", title: usageSourceWords }, usageRows[0].el, usageRows[1].el, noUsage);
  const ageWhat = h("span", { class: "what", text: () => t("home.usageAge") });
  const ageWhen = h("span", { class: "when" });
  const usageAge = h("div", { class: "res-age" }, ageWhat, ageWhen);
  const resCard = h(
    "div", { class: "card home-res" },
    h("div", { class: "lane-h", text: () => t("home.usageHead") }),
    usageBox,
    usageAge,
  );

  // The lanes and the resources: two more columns at the top and bottom (the
  // wrapper has no box of its own there); on a side, what scrolls under the
  // bot's card when the window is too short for all three (style.css `.home-rest`).
  const rest = h("div", { class: "home-rest" }, sessionsCard, resCard);
  const el = h("div", { class: "view" }, h("div", { class: "home" }, botCard, rest));
  // Home upright on a side: its cards' heights and the stage's width, said once (layout.ts), read by the stylesheet.
  el.style.setProperty("--home-side-bot", `${HOME_SIDE_BOT_H}px`);
  el.style.setProperty("--home-side-sessions", `${HOME_SIDE_SESSIONS_H}px`);
  el.style.setProperty("--hb-side-stage", `${HOME_STAGE.column.w}px`);
  el.style.setProperty("--hb-stage-h", `${HOME_STAGE.column.h}px`);

  // ── What is on show ─────────────────────────────────────────────────────────
  const cells = new Map<string, Cell>();
  let entries = new Map<string, Entry>();
  let hoverId: string | null = null;
  let listOpen = false;
  /** Where each stood last time: nothing reshuffles in a lane under the pointer. */
  let lastIndex = new Map<string, number>();
  let pointerInRow = false;
  let orderKey = "";
  let footKey = "";
  let listKey = "";
  let emptyKey = "";

  laneRow.addEventListener("pointerenter", () => { pointerInRow = true; });
  laneRow.addEventListener("pointerleave", () => { pointerInRow = false; State.notify(); });
  // A click anywhere else puts the list away.
  el.addEventListener("click", (e) => {
    if (listOpen && !list.contains(e.target as Node)) {
      listOpen = false;
      State.notify();
    }
  });

  /** A session's panel — or, when it is waiting for an answer, the card that asks. Another agent's pill has neither. */
  function open(id: string) {
    const entry = entries.get(id);
    if (!entry?.session) return;
    listOpen = false;
    actions.openSessionOf(id);
  }

  function makeCell(entry: Entry): Cell {
    // A result nobody has opened: a dot — or, when its reply waits on a decision, a "!" in that colour.
    const mark = h("i", { class: "unseen" }, svg(ICONS.bang, 9));
    const kids = h("span", { class: "kids" });
    const dot = h("i", { class: "dot" });
    const name = h("span", { class: "agent-name" });
    // Which tool it is, at the corner: the chip's colour says what it does, never whose it is.
    const tool = entry.session ? toolMark(entry.session.agent, 9) : null;
    if (tool) tool.classList.add("corner");
    const cell = h("button", { class: "agent" }, dot, name, mark, kids, tool);
    const id = entry.id;
    cell.addEventListener("pointerenter", () => { hoverId = id; drawFoot(); });
    cell.addEventListener("pointerleave", () => { if (hoverId === id) hoverId = null; drawFoot(); });
    cell.addEventListener("click", (e) => { e.stopPropagation(); open(id); });
    // A click does not leave it with the focus: the keyboard is the panel's.
    cell.addEventListener("mousedown", (e) => e.preventDefault());
    return { el: cell, kids, mark, key: "", state: null };
  }

  function updateCell(cell: Cell, entry: Entry) {
    const running = entry.session ? runningSubagents(entry.session) : [];
    const { name, n } = labelOf(entry);
    const key = [entry.state, entry.lane, entry.unseen, entry.decision, entry.color, name, n, running.map((r) => (r.asking ? "a" : "r")).join(""), currentLang()].join("~");
    if (key === cell.key) return;
    cell.key = key;
    cell.state = entry.state;
    cell.el.classList.toggle("rest", entry.lane === "done");
    cell.el.classList.toggle("calls", entry.lane === "needs");
    (cell.el.querySelector(".dot") as HTMLElement).style.background = entry.color;
    (cell.el.querySelector(".agent-name") as HTMLElement).textContent = n == null ? name : `${name} ·${n}`;
    // One mark at its corner: the decision's comes before the plain "unseen".
    cell.mark.hidden = !(entry.unseen || entry.decision);
    cell.mark.classList.toggle("decide", entry.decision);
    cell.el.title = entry.decision ? decisionWords() : "";

    clear(cell.kids);
    for (const r of running.slice(0, MAX_CHILD_DOTS)) {
      cell.kids.append(h("i", { class: r.asking ? "asking" : "", style: `--c:${subagentColor(r.asking)}` }));
    }
    if (running.length > MAX_CHILD_DOTS) cell.kids.append(h("small", { text: `+${running.length - MAX_CHILD_DOTS}` }));
  }
  function release(cell: Cell) {
    cell.el.remove();
  }

  /** A cell that leaves fades where it stands, out of the row's flow, while the others close up. */
  function dropCell(id: string, cell: Cell) {
    cells.delete(id);
    if (!cell.el.isConnected || !el.classList.contains("on")) return release(cell);
    const r = cell.el.getBoundingClientRect();
    const base = sessionsCard.getBoundingClientRect();
    cell.el.style.position = "absolute";
    cell.el.style.left = `${r.left - base.left}px`;
    cell.el.style.top = `${r.top - base.top}px`;
    cell.el.style.pointerEvents = "none";
    sessionsCard.append(cell.el);
    const gone = cell.el.animate(
      [{ opacity: getComputedStyle(cell.el).opacity, transform: "none" }, { opacity: 0, transform: "scale(0.7)" }],
      { duration: 420, easing: "ease-in", fill: "forwards" },
    );
    gone.onfinish = () => release(cell);
    gone.oncancel = () => release(cell);
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

  function drawLanes(visible: Entry[], hidden: Entry[]) {
    // The row is laid out again only when who stands where has changed.
    const nextOrder = `${visible.map((e) => `${e.id}:${e.lane}`).join("|")}#${hidden.length}`;
    const moved = nextOrder !== orderKey;
    orderKey = nextOrder;
    const shown = el.classList.contains("on");

    // Where everything stands now, to move it from there to where it goes.
    const before = new Map<string, DOMRect>();
    let moreBefore: DOMRect | null = null;
    if (moved && shown) {
      for (const [id, cell] of cells) before.set(id, cell.el.getBoundingClientRect());
      moreBefore = more.hidden ? null : more.getBoundingClientRect();
    }

    for (const [id, cell] of [...cells]) {
      if (!visible.some((e) => e.id === id)) dropCell(id, cell);
    }

    let first = true;
    for (const { key } of LANES) {
      const lane = lanes.get(key)!;
      const mine = visible.filter((e) => e.lane === key);
      lane.el.hidden = mine.length === 0;
      lane.el.classList.toggle("sep", !first && mine.length > 0);
      if (mine.length) first = false;
      lane.count.textContent = String(mine.length);
      for (const entry of mine) {
        let cell = cells.get(entry.id);
        const fresh = !cell;
        if (!cell) {
          cell = makeCell(entry);
          cells.set(entry.id, cell);
        }
        updateCell(cell, entry);
        if (moved) lane.bots.append(cell.el);
        if (fresh && shown) {
          cell.el.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: SPRING });
        }
      }
    }

    // "+N" wears the colour of the most urgent session it hides: a hidden request is never silent.
    more.hidden = hidden.length === 0;
    if (hidden.length) {
      more.textContent = t("home.more", { n: hidden.length });
      wear(more, hidden[0].color);
      more.classList.toggle("calls", hidden[0].rank === 0);
      more.title = t("home.moreTitle", { n: hidden.length });
    } else {
      listOpen = false;
    }

    if (moved && shown) {
      for (const [id, cell] of cells) slide(cell.el, before.get(id));
      if (!more.hidden) slide(more, moreBefore ?? undefined);
    }
  }

  /** The bot's sentence: fixed templates, the most urgent thing first. No model, no network. */
  function sayOf(front: Entry, live: Entry[]): string {
    const who = labelOf(front).name;
    const needs = live.filter((e) => e.lane === "needs");
    if (needs.length > 1) return t("home.say.needsMany", { n: needs.length });
    if (needs.length === 1) return front.session?.question ? t("home.say.question", { who }) : t("home.say.permission", { who });
    if (front.state === "error") return t("home.say.error", { who });
    const working = live.filter((e) => e.lane === "working");
    if (working.length > 1) return t("home.say.workingMany", { n: working.length });
    if (working.length === 1) return t("home.say.workingOn", { name: labelOf(working[0]).name });
    const done = live.filter((e) => e.lane === "done").length;
    return t("home.say.calm", { count: done });
  }

  function drawMain(front: Entry | null, tracked: number, live: Entry[]) {
    frontId = front?.session?.id ?? "";
    botCard.classList.toggle("opens", frontId !== "");
    if (!front) {
      const missing = !State.settings.hooksInstalled && tracked === 0;
      botCard.style.setProperty("--wash", washRGBA("soft"));
      whoTool.replaceChildren();
      whoName.textContent = "Durazno";
      say.textContent = missing ? t("home.say.noHooks") : t("home.say.none");
      whoName.title = "";
      whoModel.textContent = "";
      whoState.textContent = "";
      doing.textContent = missing ? t("home.notReaching") : "";
      doing.title = "";
      review.style.display = "none";
      return;
    }
    const resting = front.lane === "done";
    const wash = resting && front.decision ? "indigo" : resting && !front.unseen ? "soft" : (WASH[front.state] ?? (front.unseen ? "green" : "soft"));
    botCard.style.setProperty("--wash", washRGBA(wash));
    const tool = front.session?.agent;
    if (tool) whoTool.replaceChildren(toolMark(tool, 11), TOOL_NAME[tool] + " ·");
    else whoTool.replaceChildren();
    whoName.textContent = "Durazno";
    say.textContent = `«${sayOf(front, live)}»`;
    whoName.title = labelOf(front).path;
    // The model it runs on, when it said: nothing is shown for one that did not.
    const model = "";
    whoModel.textContent = model;
    whoModel.title = front.session?.model?.id ?? "";
    whoModel.hidden = !model;
    whoState.textContent = "";
    const what = doingOf(front);
    doing.textContent = what;
    doing.title = what;
    // No Allow here: this card cannot show a request whole, and Allow allows
    // all of it. The button goes to the request's own card, which can — and
    // which arms its buttons from the moment it is on show.
    const asks = front.session?.question ? t("home.answer") : front.session?.approval ? t("home.review") : "";
    review.style.display = asks ? "" : "none";
    reviewLabel.textContent = asks;
  }

  function drawEmpty(none: boolean, tracked: number) {
    empty.hidden = !none;
    laneRow.hidden = none;
    foot.hidden = none;
    const missing = !State.settings.hooksInstalled && tracked === 0;
    const key = none ? `${missing}:${tracked}:${currentLang()}` : "";
    if (key === emptyKey) return;
    emptyKey = key;
    clear(empty);
    if (!none) return;
    if (missing) {
      empty.append(
        h("div", { class: "title", text: t("home.empty.noHooks") }),
        h("div", { class: "sub", text: t("home.empty.noHooksSub") }),
        h("button", { class: "btn secondary", onclick: () => actions.openSettingsWindow() }, svg(ICONS.gear, 12), t("home.openSettings")),
      );
    } else if (tracked > 0) {
      // Sessions are still followed: they have only been at rest long enough to leave the view.
      empty.append(
        h("div", { class: "title", text: t("home.empty.noActive") }),
        h("div", { class: "sub", text: t("home.empty.resting", { count: tracked }) }),
        h("button", { class: "btn secondary", text: t("home.empty.show", { count: tracked }), onclick: () => { actions.blip(); actions.openSessions(); } }),
      );
    } else {
      empty.append(
        h("div", { class: "title", text: t("home.empty.none") }),
        h("div", { class: "sub" }, t("home.empty.runPre"), h("code", { class: "code", text: "claude" }), t("home.empty.runPost")),
      );
    }
  }

  function drawFoot() {
    const entry = hoverId ? entries.get(hoverId) : null;
    const key = entry
      ? [entry.id, entry.session?.agent, labelText(entry), entry.session?.model?.label, stateWords(entry), entry.color, entry.session ? subagentWords(entry.session) : "", doingOf(entry)].join("~")
      : "";
    if (key === footKey && foot.firstChild) return;
    footKey = key;
    clear(foot);
    if (!entry) {
      foot.classList.add("quiet");
      return;
    }
    foot.classList.remove("quiet");
    const { name, n, path } = labelOf(entry);
    const model = entry.session?.model;
    const subs = entry.session ? subagentWords(entry.session) : "";
    const what = doingOf(entry);
    foot.append(
      h("div", { class: "hf-who" },
        h("i", { class: "dot", style: `width:6px;height:6px;background:${entry.color}` }),
        entry.session ? toolMark(entry.session.agent, 10) : null,
        h("b", { text: name, title: path }),
        n == null ? null : h("em", { text: `·${n}` }),
        model ? h("span", { class: "model", text: model.label, title: model.id }) : null,
        h("span", { text: entry.task ? t("home.agentState", { state: stateWords(entry) }) : stateWords(entry) }),
        subs ? h("span", { class: "subs", text: subs }) : null),
      h("div", { class: "hf-doing", text: what, title: what }),
    );
  }

  function drawList(hidden: Entry[], now: number) {
    list.hidden = !listOpen || hidden.length === 0;
    const key = list.hidden ? "" : hidden.map((e) => [e.id, labelText(e), stateWords(e), e.color, span(now - e.since)].join("~")).join("|");
    if (key === listKey) return;
    listKey = key;
    clear(list);
    if (list.hidden) return;
    for (const entry of hidden) {
      const { name, n, path } = labelOf(entry);
      const id = entry.id;
      list.append(h(
        "button", { class: "gh-row", title: `${path}\n${doingOf(entry)}`.trim(), onclick: (e: Event) => { e.stopPropagation(); open(id); } },
        h("i", { class: "dot", style: `width:7px;height:7px;background:${entry.color}` }),
        h("span", { class: "gh-row-title" }, name, n == null ? null : h("em", { text: ` ·${n}` })),
        h("span", { class: "gh-row-where", text: stateWords(entry) }),
        h("span", { class: "int-ago", text: span(now - entry.since) }),
      ));
    }
  }

  function toggleList() {
    listOpen = !listOpen;
    actions.blip();
    State.notify();
    if (listOpen) {
      list.animate([{ opacity: 0, transform: "translateY(7px) scale(0.985)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: SPRING });
    }
  }

  // ── Resources ───────────────────────────────────────────────────────────────

  /** The machine: written when a sample comes, and at no other time. */
  function drawGauges() {
    // CPU and GPU need two readings: "—" in the same cell until the first real
    // one — and, for the GPU, for good on a machine that does not report it.
    drawUsage(Date.now());
  }

  /** Claude's limits: how much of each window is used, when it starts again, and how old that is. */
  function drawUsage(now: number) {
    const usage = State.usage;
    const windows = usage ? [usage.fiveHour, usage.sevenDay] : [];
    usageRows.forEach((row, i) => {
      // What the window shows now (state.ts `usageShown`): past its reset, 0 % and the words for it.
      const w = usageShown(windows[i], usage?.updatedAt ?? now, now);
      row.el.style.visibility = w ? "visible" : "hidden";
      if (!w) return;
      const used = w.percent;
      row.value.textContent = `${used}%`;
      row.resets.textContent = w.countdown;
      row.resets.title = w.countdown;
      row.value.dataset.level = w.state === "reset" ? "" : usageLevel(used);
      row.el.classList.toggle("dim", w.state !== "fresh");
      row.fill.style.width = `${used}%`;
      // The share of the bar's gradient the fill shows (style.css `.res-usage .res-bar i`).
      row.fill.style.setProperty("--used", String(used / 100));
    });

    noUsage.hidden = usage != null;
    if (!usage) {
      const off = State.usageInstalled !== true;
      const why = State.usageInstalled === false
        ? t("home.usage.off")
        : t("home.usage.later");
      const key = `${off}:${why}`;
      if (noUsage.dataset.why !== key) {
        noUsage.dataset.why = key;
        clear(noUsage);
        noUsage.append(h("b", { text: t("home.usage.none") }), h("span", { text: why }));
        if (off && State.usageInstalled === false) noUsage.append(noUsageBtn);
      }
    }
    // How old the numbers are, said as what they are: Claude Code's last word. Ticks with the home view's slow timer.
    const age = usage ? now - usage.updatedAt : 0;
    const when = !usage ? "" : age < 60_000 ? t("home.ageNow") : t("home.ageAgo", { span: span(age) });
    usageAge.style.visibility = usage ? "visible" : "hidden";
    usageAge.classList.toggle("old", usage != null && age > USAGE_OLD_MS);
    if (ageWhen.textContent !== when) ageWhen.textContent = when;
    const whole = usage ? `${ageWhat.textContent}${when}. ${usageSourceWords()}` : "";
    if (usageAge.title !== whole) usageAge.title = whole;
  }

  State.onGauges(drawGauges);
  drawGauges();

  return {
    el,
    sync() {
      const now = Date.now();
      const { live, faded } = roster(now);
      const order = showOrder(live);
      const visible = order.slice(0, MAX_VISIBLE);
      const hidden = order.slice(MAX_VISIBLE);
      entries = new Map(order.map((e) => [e.id, e]));

      drawLanes(visible, hidden);
      drawEmpty(live.length === 0, faded);
      // The bot speaks for the most urgent one, whatever the pointer holds in place.
      sessHead.textContent = t("home.sessions", { n: live.length });
      sessHead.hidden = live.length === 0;
      drawMain(live[0] ?? null, faded, live);
      drawList(hidden, now);
      if (hoverId && !visible.some((e) => e.id === hoverId)) hoverId = null;
      drawFoot();
      drawUsage(now);
    },
  };
}
