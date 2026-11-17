// The session panel — a Claude Code session, followed from the island.
//
// One column. On top, the sessions followed, a chip each — the row Home has,
// the one in front lit: how one goes from a session to another. Under it a
// card: a header with the bot, the session's title and where it is at (its
// state, its model, the files it changed, where it runs), then the journal of
// what is picked, read like a conversation: what was asked, then each thing
// Claude did in the order it did it — a file read, an edit with its diff,
// typed as it lands, a command, a question with what was picked, a permission
// with what was decided — and what Claude said to end its turn. Above the
// journal, chips that keep one kind of step. The time is said once above each
// block of steps ("Now", "3 min ago"), not on every line. Subagents launched
// one after the other are one block of the journal, where they were, with a
// line each; a line opens the subagent's own journal, ending on what it
// came back with. Behind the journal, the files the session
// has changed and each one's whole diff. It is for watching: to answer, there
// is Claude Code.
//
// The panel has two sizes: its normal one, and a large one (the expand button
// in the island's bar; Escape goes back) where a command is shown whole and
// what each step gave back is under it.
//
// Windows only for now. Nothing here is fetched: it is all in the hooks Claude Code already sends.
// An edit is shown the moment Claude Code says it is done, so the typing is a
// replay of it, a second behind. The session itself stays where it runs — the
// Claude app, VS Code, a terminal.

import { h, svg, clear, dot, replay, timeAgo } from "./dom";
import { currentLang, locale, t, type Key } from "../core/i18n";
import { diffLine, extBadge, fileKind, plusMinus, readPatch, splitPath, type FileKind } from "./code";
import { ICONS } from "./icons";
import { COLOR } from "./palette";
import { collapses, reply as replyView, type PathOpener, type ReplyFold } from "./markdown";
import { Bridge } from "../core/bridge";
import {
  decisionWords, quietWords, State, isQuestion, isQuiet, isTool, repliedWords, requestsOf, stepsApart, subagentKind, subagentName, subagentStanding, subagentTask, subagentTook, targetTip, targetWords,
  type ChangedFile, type ClaudeSession, type ModelInfo, type SessionStep, type StepKind, type Subagent,
} from "../core/state";
import { targetIcon } from "./target";
import { TOOL_NAME, toolMark } from "./tool";
import { buildReplyBox } from "./reply-box";
import type { SessionAgent } from "../core/state";
import { stepIcon, stepName, stepPreview, type ToType } from "./step";
import { botGlowColor, SessionRoom } from "../core/layout";
import { contextUse } from "../core/context";
import { Reader } from "../core/reading";
import type { ViewActions, ViewHost } from "./views";

/** What a session is called until it has a project or a title to go by. */
const UNNAMED = "Claude Code";
/** An edit is typed out when it reached the island less than this ago; older, it is just shown. */
const FRESH_MS = 4_000;
/** However long the edit, typing it takes about this long, a tick at a time. */
const TYPE_MS = 1_800;
const TICK_MS = 16;

/**
 * Lines of what a step did that its entry of the journal shows: fewer at the
 * panel's normal size, where only an edit shows any; an edit's whole diff is
 * behind **N files**.
 */
const JOURNAL_LINES = { normal: 6, large: 14 };
/** This close to the journal's end, it is being followed: what comes next is scrolled to. */
const FOLLOW_PX = 24;
/** Further than this above its end, the journal shows the way back down. */
const JUMP_PX = 120;
/** A wiggle (the jump button's, a line's) is not repeated sooner than this: a run of finishes is one shake, not a constant one. */
const WIGGLE_GAP_MS = 1_500;
/** A reply brought into view starts this far under the journal's top edge. */
const REVEAL_GAP = 6;
/** The window is asked for the keyboard; this long later it has it, and a row can take the focus. */
const FOCUS_MS = 120;

/**
 * What is on screen: a session's journal, the journal of one of its subagents,
 * the list of its changes, or one file's diff.
 */
type Screen =
  | { kind: "live" }
  | { kind: "agent"; session: string; id: string }
  | { kind: "list" }
  | { kind: "file"; path: string };
let screen: Screen = { kind: "live" };
/** Bumped by every action: what the view shows has changed. */
let stamp = 0;

/** The kind of step the journal keeps; "all" keeps everything, what was said included. */
type Filter = "all" | "edit" | "command" | "read" | "search";
const FILTERS: readonly (readonly [Filter, Key])[] = [
  ["all", "sess.f.all"], ["edit", "sess.f.edit"], ["command", "sess.f.command"], ["read", "sess.f.read"], ["search", "sess.f.search"],
];
let filter: Filter = "all";

function go(next: Screen) {
  screen = next;
  filter = "all";
  stamp++;
  State.notify();
}

/**
 * Into the panel: on the session's journal, at its end, or on the list of its
 * changes. The sessions to choose from are the row above the card, whatever is on show.
 */
export function enterSessionPanel(on: "journal" | "changes" | "sessions" = "journal", whole = false) {
  screen = { kind: on === "changes" ? "list" : "live" };
  filter = "all";
  wantWhole = whole;
  stamp++;
}

/**
 * A very long reply is cut until it is asked for whole. Which form each
 * is in, by the journal's step — or, for what a subagent came back with, by
 * the subagent: remembered while the session lives, and saved nowhere.
 */
const replyFolds = new WeakMap<object, boolean>();
/** Whether each reply is long enough to be cut (markdown.ts `CUT_OVER`): worked out once. */
const longReplies = new WeakMap<SessionStep, boolean>();
/** The panel was entered to read the reply ("Read reply", a session that waits on a decision): its last one opens whole. */
let wantWhole = false;

function isLong(step: SessionStep): boolean {
  let long = longReplies.get(step);
  if (long == null) longReplies.set(step, (long = collapses(step.target ?? "")));
  return long;
}

/** What a session said last, as its journal holds it. */
function lastReply(session: ClaudeSession): SessionStep | null {
  for (let i = session.steps.length - 1; i >= 0; i--) {
    if (session.steps[i].kind === "reply" && session.steps[i].target) return session.steps[i];
  }
  return null;
}

/**
 * The way to open the files a session's replies name: only for a session that
 * runs in an editor — VS Code, Cursor. Any other has none, and its paths stay
 * the code they are: no editor is guessed.
 */
function openerOf(session: ClaudeSession): PathOpener | null {
  const { kind, label } = session.target;
  if (!session.id || (kind !== "vscode" && kind !== "cursor")) return null;
  return {
    tip: t("sess.openIn", { app: label }),
    open: (path, line) => Bridge.openSessionFile(session.id, path, line),
    exists: (path) => fileExists(session.id, path),
  };
}

// ── Is a bare name a file? (markdown.ts `bareName`) ───────────────────────────
// Asked of Rust, which answers yes or no by the rule it opens files by. The
// answers are kept by session and name, so a journal drawn again asks nothing;
// the questions of one drawing go out together, a moment after the first.

/** How long a "no" is believed: the file may be written a moment later. A "yes" is kept. */
const NO_FILE_FOR_MS = 30_000;
/** The questions of one drawing are gathered for this long, and sent as one. */
const FILE_ASK_MS = 40;
/** As many as Rust looks at in one call (openfile.rs `MAX_CHECKS`). */
const FILE_ASK_MAX = 20;

const fileKnown = new Map<string, { there: boolean; at: number }>();
const fileAsked = new Map<string, Promise<boolean>>();
let fileQueue: { sessionId: string; path: string; settle: (there: boolean) => void }[] = [];
let fileTimer: number | null = null;
const fileKey = (sessionId: string, path: string) => `${sessionId}\n${path}`;

function flushFileQuestions() {
  fileTimer = null;
  const queue = fileQueue;
  fileQueue = [];
  const bySession = new Map<string, typeof queue>();
  for (const question of queue) bySession.set(question.sessionId, [...(bySession.get(question.sessionId) ?? []), question]);
  for (const [sessionId, questions] of bySession) {
    for (let i = 0; i < questions.length; i += FILE_ASK_MAX) {
      const batch = questions.slice(i, i + FILE_ASK_MAX);
      void Bridge.sessionFilesExist(sessionId, batch.map((q) => q.path)).then((answers) => {
        batch.forEach((q, n) => {
          const there = answers?.[n] === true;
          fileKnown.set(fileKey(sessionId, q.path), { there, at: Date.now() });
          fileAsked.delete(fileKey(sessionId, q.path));
          q.settle(there);
        });
      });
    }
  }
}

function fileExists(sessionId: string, path: string): boolean | Promise<boolean> {
  const key = fileKey(sessionId, path);
  const known = fileKnown.get(key);
  if (known && (known.there || Date.now() - known.at < NO_FILE_FOR_MS)) return known.there;
  const asked = fileAsked.get(key);
  if (asked) return asked;
  const answer = new Promise<boolean>((settle) => fileQueue.push({ sessionId, path, settle }));
  fileAsked.set(key, answer);
  if (fileTimer == null) fileTimer = window.setTimeout(flushFileQuestions, FILE_ASK_MS);
  return answer;
}

/** Out of a subagent's view, back to its session's journal. False when no subagent was on show. */
export function leaveSubagent(): boolean {
  if (screen.kind !== "agent") return false;
  go({ kind: "live" });
  return true;
}

const counted = (count: number, what: "sess.n.session" | "sess.n.subagent" | "sess.n.file") => t(what, { count });

// ── Several sessions ──────────────────────────────────────────────────────────

/** A session by its name: the conversation's title, or untitled, the folder it works in. */
export const sessionName = (session: ClaudeSession) => session.title ?? session.project;

/** Where a session is at, as a colour and in words: what its chip in the row shows and says. */
function standing(session: ClaudeSession): { color: string; words: string; quiet?: boolean } {
  if (session.question) return { color: COLOR.cyan, words: t("views.asking") };
  if (session.approval) return { color: COLOR.amber, words: t("views.needsPermission") };
  if (session.news === "error" || session.state === "error") return { color: COLOR.red, words: t("sess.stoppedError") };
  // Its last reply waits on a decision: said after a request and an error, before "finished".
  if (session.decision) return { color: COLOR.purple, words: decisionWords().toLowerCase() };
  // It replied while its subagents still run, and nobody has looked yet: said as that, not as finished.
  if (session.news === "finished" && repliedWords(session)) return { color: COLOR.green, words: repliedWords(session)!.toLowerCase() };
  if (session.news === "finished" || session.state === "finished") return { color: COLOR.green, words: t("views.finished") };
  if (session.state === "question") return { color: COLOR.cyan, words: t("sess.waitingForYou") };
  if (session.state === "idle" || session.state === "sleeping") return { color: COLOR.grey, words: t("sess.atRest") };
  // At work, and nothing heard from it for a long while: it says so, quietly. Its state is not touched.
  if (isQuiet(session)) return { color: botGlowColor(session.state), words: quietWords(), quiet: true };
  return { color: botGlowColor(session.state), words: session.state === "thinking" ? t("sess.thinking") : t("sess.atWork") };
}

/** What the quiet word means, for whoever hovers it. */
const quietTip = () => t("sess.quietTip");

/** What the mark of a reply that waits on a decision means, for whoever hovers it. */
const decisionTip = () => t("sess.decisionTip");

/** Something a session wants looked at: it is waiting for an answer, or has news nobody has seen. */
const calls = (session: ClaudeSession) => session.news != null || session.question != null || session.approval != null || session.decision || session.attention;

/** What the mark of a turn that ended while the panel was being read says. */
const attentionWords = () => t("sess.attention");

/**
 * The way to the sessions, where a session is shown: a chip that says how
 * many there are, kept in step by the function it returns. It is there only
 * with more than one, and takes the colour of a session behind the one on
 * show that wants looking at.
 */
export function sessionsChip(onOpen: () => void): { el: HTMLElement; sync(): void } {
  const el = h("button", { class: "sess-chip", onclick: onOpen });
  return {
    el,
    sync() {
      const count = State.sessions.length;
      el.style.display = count > 1 ? "" : "none";
      el.textContent = counted(count, "sess.n.session");
      const calling = State.sessions.find((s) => s.id !== State.frontId && calls(s));
      el.classList.toggle("calls", calling != null);
      el.style.setProperty("--c", calling ? standing(calling).color : "currentColor");
      el.title = calling ? `${sessionName(calling)} ${standing(calling).words}${calling.attention ? ` — ${attentionWords().toLowerCase()}` : ""}` : t("sess.everySession");
    },
  };
}

/** A session by its folder; two in the same folder are told apart by a number. */
function folderOf(session: ClaudeSession): string {
  // Told apart within a tool: the same folder in Claude Code and in Cursor is told by the mark.
  const same = State.sessions.filter((s) => s.project === session.project && s.agent === session.agent);
  return same.length > 1 ? `${session.project} ·${same.indexOf(session) + 1}` : session.project;
}

/** What happened to the file: "edited" in grey, "new" in green. */
function statusWord(file: ChangedFile): HTMLElement {
  const word = h("span", { class: "gh-file-status", text: file.created ? t("sess.file.new") : t("sess.file.edited") });
  if (file.created) word.style.color = COLOR.green;
  return word;
}

function fileRow(file: ChangedFile): HTMLElement {
  const { dir, base } = splitPath(file.path);
  return h(
    "button",
    { class: "gh-row gh-file", title: file.path, onclick: () => go({ kind: "file", path: file.path }) },
    h("i", { class: "gh-row-icon" }, extBadge(file.path)),
    h("span", { class: "gh-row-title", text: base }),
    h("span", { class: "gh-row-where", text: dir }),
    h("span", { class: "gh-right" }, statusWord(file), plusMinus(file.additions, file.deletions), h("span", { class: "int-ago", text: timeAgo(file.at) })),
  );
}

/** A quiet line across a diff: lines skipped, or the start of another edit. */
function diffBreak(text: string): HTMLElement {
  return h("div", { class: "gh-diff-line hunk" }, h("span", { class: "n", text: "⋯" }), h("span", { class: "s" }), h("span", { class: "t", text }));
}

/** Every edit to the file, oldest first, a quiet break between two of them. */
function diffView(file: ChangedFile, kind: FileKind): HTMLElement {
  const diff = h("div", { class: "gh-diff" });
  const several = file.edits.length > 1;
  file.edits.forEach((edit, i) => {
    let first = true;
    for (const line of readPatch(edit.patch)) {
      if ("hunk" in line) {
        // Between two edits, which one this is; inside one, where lines were skipped.
        const label = first && several ? t("sess.editOf", { i: i + 1, n: file.edits.length, ago: timeAgo(edit.at) }) : "";
        if (!first || label) diff.append(diffBreak(label));
        first = false;
        continue;
      }
      diff.append(diffLine(line.new ?? line.old, line.sign, line.text, kind));
    }
    if (edit.truncated) diff.append(diffBreak(t("views.editRest")));
  });
  return h("div", { class: "gh-code" }, diff);
}

// ── Subagents: how each stands ────────────────────────────────────────────────

/** How something stands, as a small round mark: going, done, failed — or waiting for the user. */
const MARKS = {
  running: () => h("i", { class: "sess-mark run" }),
  done: () => h("i", { class: "sess-mark done" }, svg(ICONS.check, 8, { stroke: 3.2 })),
  failed: () => h("i", { class: "sess-mark failed" }, svg(ICONS.xmark, 7)),
  asking: () => h("i", { class: "sess-mark needs" }, svg(ICONS.bang, 9)),
};

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** How long something has been going: kept up to date, a second at a time, by the panel's clock. */
function running(since: number): HTMLElement {
  const el = h("span", { class: "sess-elapsed", text: elapsed(Date.now() - since) });
  el.dataset.since = String(since);
  return el;
}

/**
 * How a subagent that has stopped ended, in words: "done in 1m 16s", "failed
 * after 27s" — and, when its start was not seen, just "done" or "failed": no
 * time is made up for it.
 */
function endedWords(a: Subagent): string {
  const ms = subagentTook(a);
  if (a.state === "failed") return ms == null ? t("sess.failed") : t("sess.failedAfter", { time: elapsed(ms) });
  return ms == null ? t("sess.done") : t("sess.doneIn", { time: elapsed(ms) });
}

/** How a subagent stands, in words: "running 1m 23s" (the time ticks, when its start was seen), or how it ended. */
function statusOf(session: ClaudeSession, a: Subagent): HTMLElement {
  const at = subagentStanding(session, a);
  const el = h("span", { class: `sess-status ${at}` });
  if (at === "asking") el.append(...(a.timed ? [`${t("sess.needsYou")} · `, running(a.startedAt)] : [t("sess.needsYou")]));
  else if (at === "running") el.append(...(a.timed ? [`${t("sess.running")} `, running(a.startedAt)] : [t("sess.running")]));
  else el.append(endedWords(a));
  return el;
}

function statusWords(session: ClaudeSession, a: Subagent): string {
  const at = subagentStanding(session, a);
  return at === "asking" ? t("sess.waitingAnswer") : at === "running" ? t("sess.running") : endedWords(a);
}

/** A subagent's kind and what it is at, as a tooltip says them. */
const fullName = (a: Subagent) => (subagentTask(a) ? `${subagentKind(a)} · ${subagentTask(a)}` : subagentKind(a));

// ── The journal ───────────────────────────────────────────────────────────────

/** When a line of the journal happened, as a clock shows it. */
const clock = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

/**
 * The journal says the time once per block of steps, not on each: a block
 * ends where nothing happened for `BLOCK_GAP_MS`, and never runs past
 * `BLOCK_SPAN_MS`, so a long stretch of steady work is still dated now and then.
 */
const BLOCK_GAP_MS = 2 * 60_000;
const BLOCK_SPAN_MS = 10 * 60_000;

/** How long ago a block began: "Now", "3 min ago", "2 h ago". */
function whenWords(at: number): string {
  const minutes = Math.floor(Math.max(0, Date.now() - at) / 60_000);
  if (minutes < 1) return t("sess.when.now");
  if (minutes < 60) return t("sess.when.m", { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t("sess.when.h", { n: hours }) : t("sess.when.d", { n: Math.floor(hours / 24) });
}

/** The exact moment, for a tooltip. */
const whenTip = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });

/** Several options picked for one question come back as one answer, joined like this. */
const ANSWER_JOIN = ", ";

/** Where a tool's permission request stands, in a word and a colour. */
const PERMISSIONS = {
  asked: { words: "views.needsPermission", color: COLOR.amber },
  allowed: { words: "sess.allowed", color: COLOR.green },
  denied: { words: "sess.denied", color: COLOR.red },
} as const;

function chip(text: string, color: string): HTMLElement {
  const el = h("span", { class: "jr-chip", text });
  el.style.setProperty("--c", color);
  return el;
}

/** A question Claude asked, with its options — and, once it is answered, the ones picked lit. */
function askedView(step: SessionStep): HTMLElement {
  const el = h("div", { class: "jr-asks" });
  for (const q of step.questions ?? []) {
    const answer = step.answers?.[q.question] ?? null;
    const picked = new Set(answer == null ? [] : [answer, ...answer.split(ANSWER_JOIN)]);
    const options = h("div", { class: "jr-options" });
    let matched = false;
    for (const option of q.options) {
      const on = picked.has(option.label);
      matched ||= on;
      options.append(h("span", { class: on ? "jr-option on" : "jr-option", text: option.label, title: option.description ?? "" }));
    }
    // An answer typed rather than picked is none of the options: it is shown as it was written.
    if (answer && !matched) options.append(h("span", { class: "jr-option on typed", text: answer }));
    el.append(h("div", { class: "jr-q" }, h("div", { class: "jr-q-title", text: q.question }), options));
  }
  if (!step.answers) {
    el.append(h("div", { class: "jr-waiting", text: step.state === "running" ? t("sess.q.waiting") : step.state === "failed" ? t("sess.q.unanswered") : t("sess.q.answered") }));
  }
  return el;
}

/**
 * One line of a journal — a session's, or a subagent's: they are drawn the
 * same. Something said is shown as it was said: the user's words in a bubble,
 * Claude's as it wrote them. A tool is its icon, its name and what it was at,
 * then a look at what it did: at the panel's normal size an edit's first
 * lines and nothing else; in the large panel a command whole, and under every
 * step what it gave back. `said` is what a reply is drawn with: the way to the
 * files it names, and which of its two forms a long one is in.
 */
function journalEntry(step: SessionStep, large: boolean, said: Said, typed?: ToType[]): HTMLElement {
  if (step.kind === "prompt") {
    return h("div", { class: "jr jr-asked" }, h("div", { class: "sess-asked", text: step.target ?? "", title: clock(step.at) }));
  }
  if (step.kind === "reply") {
    return h(
      "div",
      { class: "jr jr-reply" },
      h("div", { class: "sess-said", title: clock(step.at) }, dot(COLOR.green, 6), h("b", { text: "Claude" })),
      step.target ? replyView(step.target, said.opener, said.fold(step)) : h("div", { class: "jr-waiting", text: t("sess.noReply") }),
    );
  }
  if (step.kind === "note") {
    return h("div", { class: step.state === "failed" ? "jr jr-note failed" : "jr jr-note", text: step.target ?? "" });
  }

  const command = step.kind === "command";
  const whole = step.target ?? "";
  const head = h(
    "div",
    { class: "jr-head" },
    h("i", {}, stepIcon(step, 11)),
    h("b", { text: stepName(step) }),
    h("span", { class: "at", text: large && command ? whole : whole.split("\n")[0], title: whole }),
    h("div", { class: "grow" }),
  );
  if (step.permission) head.append(chip(t(PERMISSIONS[step.permission].words), PERMISSIONS[step.permission].color));
  else if (step.questions && step.state === "running") head.append(chip(t("sess.waitingAnswer"), COLOR.cyan));
  if (step.state === "running") head.append(MARKS.running());
  else if (step.state === "failed" && !step.questions && !step.permission) head.append(chip(t("sess.failed"), COLOR.red));
  // The time is said once, above a block of steps; here only as a tooltip.
  head.title = clock(step.at);

  const el = h("div", { class: `jr jr-step ${step.state} ${step.kind}` }, head);
  if (step.questions) el.append(askedView(step));
  else {
    let preview: HTMLElement | null = null;
    if (step.patch != null) preview = stepPreview(step, large ? JOURNAL_LINES.large : JOURNAL_LINES.normal, typed);
    // The command is in the head, whole: under it, only what it printed.
    else if (large) preview = stepPreview(step, JOURNAL_LINES.large, undefined, command);
    if (preview) el.append(h("div", { class: "jr-body" }, preview));
  }
  return el;
}

/** What a reply is drawn with. */
interface Said {
  opener: PathOpener | null;
  fold(key: object): ReplyFold;
}

/** What an entry is drawn from: when it changes, the entry is drawn again. */
const entryKey = (step: SessionStep, large: boolean, opener: PathOpener | null) =>
  [
    step.kind, step.state, step.result?.text.length, step.patch?.length, step.permission, step.answers ? Object.values(step.answers).join("|") : "", large,
    // A reply: which form it is in, and whether its paths open — and where.
    ...(step.kind === "reply" ? [replyFolds.get(step) ?? false, opener?.tip ?? ""] : []),
  ].join("~");

/**
 * The model a session or a subagent runs on, as a quiet chip — or nothing:
 * one that no event named is not guessed.
 */
function modelChip(model: ModelInfo | null | undefined): HTMLElement[] {
  return model ? [h("span", { class: "sess-model", text: model.label, title: model.id })] : [];
}

export function buildSession(actions: ViewActions): ViewHost {
  // ── What the panel is made of ───────────────────────────────────────────────

  // The row of sessions, over the card: the one in front lit. It is there
  // only with more than one session (`SessionRoom.strip`: the bot goes down by
  // its height). A row that does not fit goes sideways, fading where there is more.
  // All · Claude Code · Cursor · Codex: there only while sessions of more than one tool are followed.
  let toolFilter: "all" | SessionAgent = "all";
  const toolChips = h("div", { class: "sess-tools", role: "group", "aria-label": () => t("sess.showFrom") });
  toolChips.hidden = true;
  const chipRow = h("div", { class: "hc-row sess-chips", role: "tablist", "aria-label": () => t("sess.chipsLabel") });
  const strip = h("div", { class: "sess-strip" }, toolChips, chipRow);
  strip.hidden = true;
  const fadeChips = () => chipRow.classList.toggle("more", chipRow.scrollLeft + chipRow.clientWidth < chipRow.scrollWidth - 2);
  chipRow.addEventListener("scroll", fadeChips, { passive: true });
  new ResizeObserver(fadeChips).observe(chipRow);

  // The header of the card: the bot (the island draws it, here is its room),
  // the session's title — whole — and under it where it is at. On the right,
  // the way to where the session runs: an editor's window, a terminal's, the
  // Claude app; none for a session nothing says the place of.
  const title = h("b", { class: "sess-title", text: UNNAMED });
  const line = h("div", { class: "sess-line" });
  const goBtn = h("button", { class: "sess-go", type: "button", onclick: () => actions.openTerminal() });
  goBtn.hidden = true;
  const sessHead = h("div", { class: "sess-head" }, h("div", { class: "sess-bot-slot" }), h("div", { class: "sess-who" }, title, line), goBtn);

  /** The chips of the tool filter, drawn again when the kinds followed change. */
  let toolsKey = "";
  function drawToolChips() {
    const kinds = (["claude", "cursor", "codex"] as const).filter((kind) => State.sessions.some((s) => s.agent === kind));
    const both = kinds.length > 1;
    if (!both || (toolFilter !== "all" && !kinds.includes(toolFilter))) toolFilter = "all";
    const key = `${kinds.join()}|${toolFilter}|${currentLang()}`;
    toolChips.hidden = !both;
    if (key === toolsKey) return;
    toolsKey = key;
    clear(toolChips);
    if (!both) return;
    for (const which of ["all", ...kinds] as const) {
      const label = which === "all" ? t("sess.f.all") : TOOL_NAME[which];
      const chip = h("button", { class: `sess-tool${toolFilter === which ? " on" : ""}`, type: "button", "aria-pressed": String(toolFilter === which) },
        which === "all" ? null : toolMark(which, 10), label);
      chip.addEventListener("click", () => {
        toolFilter = which;
        stripKey = "";
        toolsKey = "";
        drawToolChips();
        drawStrip(State.session);
      });
      toolChips.append(chip);
    }
  }

  // Above a journal: the chips that keep one kind of step. Above a
  // subagent's: where one is, and the way back.
  const filters = h("div", { class: "sess-filters" });
  const crumb = h("div", { class: "sess-crumb" });

  // Above the changes and a file's diff: a head like an editor's tab.
  const who = h("b");
  const sub = h("span", { class: "gh-sub" });
  const badge = h("span", { class: "gh-head-badge" });
  const aside = h("span", { class: "gh-head-aside" });
  // One step back: from a file to the changes, from the changes to the journal.
  const backBtn = h("button", { class: "gh-icon sess-back", title: () => t("views.q.return") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const tab = h("div", { class: "gh-tab" }, badge, who);
  const head = h("div", { class: "gh-head" }, backBtn, tab, aside, h("div", { class: "grow" }), sub);
  // The journal, and behind it the changes: one of the two is on screen.
  const journal = h("div", { class: "gh-list sess-journal" });
  const list = h("div", { class: "gh-list" });

  // The way back to the journal's end, from further up. A sibling of the
  // scroller, not a child: the journal is redrawn and fades out at its edge.
  const jumpDot = h("i", { class: "sess-jump-dot" });
  const jump = h("button", { class: "sess-jump", type: "button", "aria-label": () => t("sess.jump"), title: () => t("sess.jump"), hidden: true }, svg(ICONS.chevronDown, 12, { stroke: 2.4 }), jumpDot);
  // Under the journal: a line to answer a session at rest with (views/reply-box.ts).
  // Its height is told to the panel, so the way back to the journal's end stays above it.
  const replyBox = buildReplyBox(actions, "panel", () => {
    main.style.setProperty("--rb-h", `${replyBox.el.offsetHeight}px`);
    if (pinned) journal.scrollTop = journal.scrollHeight;
  });
  const main = h("div", { class: "gh-main" }, sessHead, head, crumb, filters, journal, list, replyBox.el, jump);
  // The panel itself can hold the focus, unseen: keys then reach the island
  // without any chip of the row having been given it.
  const el = h("div", { class: "view gh-view session-view", tabindex: "-1" }, h("div", { class: "gh-card" }, strip, main));

  backBtn.addEventListener("click", () => {
    actions.blip();
    go(screen.kind === "file" ? { kind: "list" } : { kind: "live" });
  });

  for (const scroller of [journal, list]) {
    const fade = () => scroller.classList.toggle("more", scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2);
    scroller.addEventListener("scroll", fade, { passive: true });
    new ResizeObserver(fade).observe(scroller);
  }

  // Where the reader wants the journal: at its end, until they scroll up on
  // purpose. Kept apart from where it is now, because a size change moves the
  // end without a scroll: the panel growing or shrinking, a session's lines
  // drawn longer at the large size. Only a scroll upward, away from the end,
  // lets go of it; one back to the end takes it up again.
  let pinned = true;
  let lastTop = 0;
  /** Something came in under a reader who is further up. */
  let unread = false;
  /** A turn ended under the reader (hooks.ts `hold`): the button shows for it, however near the end they are. */
  let held = false;
  /** The sync under way is one a turn's end was held back for: set by `sync`, for the front session. */
  let holding = false;
  /** The front session's turn ended while its journal was not on show (the changes, a file): its line wears the mark until the journal is back, where the button takes it up. */
  let owed: ClaudeSession | null = null;

  /** `pinned`, told to the one who asks whether the panel is being read (`core/reading.ts`). */
  function pin(on: boolean) {
    pinned = on;
    Reader.away = !on;
  }

  // Whoever touches the panel is reading it, for a while.
  for (const type of ["wheel", "keydown", "pointerdown", "pointermove"]) el.addEventListener(type, () => Reader.touch(), { passive: true, capture: true });

  const gapBelow = () => journal.scrollHeight - journal.scrollTop - journal.clientHeight;

  function placeJump() {
    // Not when the journal has no height (the island folded, the journal hidden): nothing was reached.
    if (journal.clientHeight > 0 && gapBelow() <= FOLLOW_PX) unread = held = false;
    const far = journal.clientHeight > 0 && journal.scrollHeight > journal.clientHeight && gapBelow() > JUMP_PX;
    // Something that ended under a reader who is near the end, though not far
    // from it: the button shows for it, with its dot, until the end is reached.
    const behind = held && journal.clientHeight > 0 && journal.scrollHeight > journal.clientHeight;
    jump.hidden = !(far || behind);
    jump.classList.toggle("fresh", !jump.hidden && unread);
  }

  /** Last time something wiggled, by what: a session's line, or the jump button. */
  const wiggled = new WeakMap<object, number>();

  /** A short shake of `el`, once; not again within `WIGGLE_GAP_MS`. It takes no pointer and no focus. */
  function wiggle(el: HTMLElement, by: object) {
    const now = Date.now();
    if (now - (wiggled.get(by) ?? 0) < WIGGLE_GAP_MS) return;
    wiggled.set(by, now);
    replay(el, "sess-wiggle");
  }
  el.addEventListener("animationend", (e) => (e.target as HTMLElement).classList.remove("sess-wiggle"));

  journal.addEventListener("scroll", () => {
    const top = journal.scrollTop;
    if (gapBelow() <= FOLLOW_PX) pin(true);
    else if (top < lastTop) pin(false);
    lastTop = top;
    placeJump();
  }, { passive: true });

  // Every step of the panel's animation resizes the journal: it is put back at
  // its end each time, so that it is there when the panel settles.
  new ResizeObserver(() => {
    if (pinned && journal.clientHeight > 0) journal.scrollTop = journal.scrollHeight;
    placeJump();
  }).observe(journal);

  jump.addEventListener("click", () => {
    pin(true);
    unread = held = false;
    const still = document.documentElement.dataset.motion === "reduce";
    journal.scrollTo({ top: journal.scrollHeight, behavior: still ? "auto" : "smooth" });
    placeJump();
  });

  /** A session picked in the row: it comes in front, on its journal. The one in front goes back to its journal. */
  function pickSession(id: string) {
    actions.blip();
    if (id !== State.frontId) actions.pickSession(id);
    // One whose last reply waits on a decision is picked to read it: it opens whole.
    wantWhole = State.sessions.find((s) => s.id === id)?.decision === true;
    go({ kind: "live" });
  }

  /** A subagent picked, on the line where it was launched: its own view. */
  function openAgent(sessionId: string, agentId: string) {
    actions.blip();
    if (sessionId !== State.frontId) actions.pickSession(sessionId);
    go({ kind: "agent", session: sessionId, id: agentId });
  }

  // ── The row of sessions ─────────────────────────────────────────────────────
  // The sessions stay in the order they were first heard in: a chip never
  // moves from under the pointer or the keyboard because a request came in.
  //
  // The keyboard. One tab stop (roving tabindex) in the row. Left / Right move
  // along it, Home / End go to the first and the last, Enter picks the session,
  // Ctrl+Enter goes to where it runs, Down goes to the first subagent of the
  // journal (Up, Left or Home come back to the row), and on the lines of the
  // subagents Up / Down / Home / End move, and Enter opens the subagent.
  // Space is not the row's: it is the panel's size, wherever the focus is
  // (island.ts). It works once the island has the keyboard, which a click in
  // the row, opening the panel, or the panel going large, asks for. No chip
  // is given the focus by any of those: the panel holds it, and the first
  // arrow pressed puts it on the row's tab stop.

  const sessionKey = (sessionId: string) => `s:${sessionId}`;
  const domId = (key: string) => `sess-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

  /** The chip the keyboard is on. */
  let focusKey = "";
  /** The last thing used was the keyboard: the chip with the focus wears its ring. */
  let byKeyboard = false;
  /** What the row last drew: drawn again only when it changes, so a click is never lost between its down and its up. */
  let stripKey = "";

  const stops = () => [...chipRow.querySelectorAll<HTMLElement>(".sess-sc")];
  /** The lines of the journal that open a subagent. */
  const launches = () => [...journal.querySelectorAll<HTMLElement>("[data-sub]")];

  /** The chip, brought into view along the row — never by `scrollIntoView`, which would move the island's own clip. */
  function revealChip(chip: HTMLElement | undefined) {
    if (!chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < chipRow.scrollLeft) chipRow.scrollLeft = left - 8;
    else if (right > chipRow.scrollLeft + chipRow.clientWidth) chipRow.scrollLeft = right - chipRow.clientWidth + 8;
  }

  function moveTo(chip: HTMLElement | undefined) {
    if (!chip) return;
    for (const other of stops()) other.tabIndex = other === chip ? 0 : -1;
    focusKey = chip.dataset.key!;
    chip.focus({ preventScroll: true });
    revealChip(chip);
  }

  function focusLaunch(line: HTMLElement | undefined) {
    if (!line) return;
    line.focus({ preventScroll: true });
    // Inside the journal's own scroller: nothing above it moves.
    const room = line.getBoundingClientRect();
    const at = journal.getBoundingClientRect();
    if (room.top < at.top) journal.scrollTop -= at.top - room.top + REVEAL_GAP;
    else if (room.bottom > at.bottom) journal.scrollTop += room.bottom - at.bottom + REVEAL_GAP;
  }

  function drawStrip(front: ClaudeSession) {
    const onAgent = screen.kind === "agent";
    const kinds = new Set(State.sessions.map((s) => s.agent));
    const lines = State.sessions.filter((s) => toolFilter === "all" || s.agent === toolFilter).map((session) => ({ session, at: standing(session) }));
    const next = lines
      .map(({ session, at }) =>
        [
          session.id, session.agent, folderOf(session), session.title, at.words, at.color, targetTip(session), session.target.kind, session.model?.label, session.decision, session.attention,
          contextUse(session.contextTokens, session.contextWindow, session.model?.id)?.percent,
        ].join("~"))
      .concat(front.id, String(onAgent), owed?.id ?? "", String(kinds.size > 1), currentLang())
      .join("|");
    if (next === stripKey) return;
    stripKey = next;

    const hadFocus = chipRow.contains(document.activeElement);
    const scroll = chipRow.scrollLeft;
    clear(chipRow);
    for (const { session, at } of lines) {
      const inFront = session === front;
      const key = sessionKey(session.id);
      const folder = folderOf(session);
      const mark = dot(at.color, 8);
      const asks = session.question != null || session.approval != null;
      if (asks) mark.classList.add("calls");
      mark.style.setProperty("--c", at.color);

      const chip = h("div", {
        class: `agent sess-sc${inFront ? " on" : ""}${asks ? " calls" : ""}`,
        id: domId(key),
        role: "tab",
        "aria-selected": String(inFront),
      });
      chip.dataset.key = key;
      chip.dataset.session = session.id;
      if (kinds.size > 1) chip.append(toolMark(session.agent, 10));
      chip.append(h("span", { class: "agent-name", text: folder }), h("span", { class: "agent-state", text: at.words }));
      chip.prepend(mark);

      // A turn of its ended while the panel was being read: not said by sound or card, but here, until it is opened.
      const attends = (session.attention && !inFront) || session === owed;
      if (attends) {
        chip.classList.add("attn");
        chip.append(h("i", { class: "sess-new", role: "img", "aria-label": attentionWords(), title: attentionWords() }));
      }
      // How full its context is, for the one to go and /compact: a cue, as Oleo cannot do it.
      const use = contextUse(session.contextTokens, session.contextWindow, session.model?.id);
      chip.title = [
        `${TOOL_NAME[session.agent]} — ${folder} — ${session.title ?? TOOL_NAME[session.agent]}`,
        session.model?.label,
        at.words,
        at.quiet ? quietTip() : null,
        session.decision ? decisionTip() : null,
        use ? t("sess.context", { n: use.percent }) : null,
        attends ? attentionWords().toLowerCase() : null,
      ].filter(Boolean).join(" — ");
      chip.addEventListener("click", () => pickSession(session.id));
      chipRow.append(chip);
    }

    // One chip holds the tab stop: the one the keyboard was on, or the lit one.
    const all = stops();
    const holder = all.find((r) => r.dataset.key === focusKey) ?? all.find((r) => r.classList.contains("on")) ?? all[0];
    for (const r of all) r.tabIndex = r === holder ? 0 : -1;
    if (holder) focusKey = holder.dataset.key!;
    chipRow.scrollLeft = scroll;
    // The one in front is never out of sight.
    revealChip(all.find((r) => r.classList.contains("on")));
    if (hadFocus && holder) holder.focus({ preventScroll: true });
    fadeChips();
  }

  /** Puts the focus on the row's tab stop, once the window has the keyboard: the arrows then move along it. */
  function focusStrip() {
    window.setTimeout(() => {
      if (chipRow.contains(document.activeElement)) return;
      stops().find((r) => r.tabIndex === 0)?.focus({ preventScroll: true });
    }, FOCUS_MS);
  }

  /**
   * The panel opens, or goes large: the panel itself takes the focus, once the
   * window has the keyboard — never a chip of the row, which would then take
   * the next key for itself and wear a ring nobody asked for. Whatever in the
   * panel has the focus already keeps it.
   */
  function focusPanel() {
    window.setTimeout(() => {
      if (State.mode !== "expanded" || State.view !== "session") return;
      const active = document.activeElement;
      if (active && active !== document.body && el.contains(active)) return;
      el.focus({ preventScroll: true });
    }, FOCUS_MS);
  }

  // The first arrow pressed with the focus on the panel, not in the row or on
  // a subagent: the row's tab stop takes it — with no row, the first subagent —
  // and wears its ring from then on.
  const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);
  el.addEventListener("keydown", (e) => {
    if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (chipRow.contains(target) || target.closest("[data-sub]") || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const stop = strip.hidden ? undefined : stops().find((r) => r.tabIndex === 0);
    const first = launches()[0];
    if (!stop && !first) return;
    e.preventDefault();
    byKeyboard = true;
    chipRow.classList.add("kbd");
    if (stop) moveTo(stop);
    else focusLaunch(first);
  });

  // A click in the row is asking to use it: the island takes the keyboard,
  // which its window never has on its own, so the arrows work from then on.
  chipRow.addEventListener("mousedown", () => {
    byKeyboard = false;
    chipRow.classList.remove("kbd");
    actions.panelKeyboard();
    focusStrip();
  });
  chipRow.addEventListener("focusin", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".sess-sc");
    if (chip?.dataset.key) focusKey = chip.dataset.key;
  });
  chipRow.addEventListener("keydown", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".sess-sc");
    if (!chip) return;
    const session = State.sessions.find((s) => s.id === chip.dataset.session);
    if (!session) return;
    // Ctrl+Enter on a session's chip: to where it runs, as the button of its header does.
    if (e.key === "Enter" && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (targetTip(session)) actions.goToSession(session.id);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = stops();
    const i = all.indexOf(chip);
    let handled = true;
    switch (e.key) {
      case "ArrowRight": moveTo(all[i + 1]); break;
      case "ArrowLeft": moveTo(all[i - 1]); break;
      case "Home": moveTo(all[0]); break;
      case "End": moveTo(all[all.length - 1]); break;
      case "ArrowDown": {
        const first = launches()[0];
        if (first) focusLaunch(first);
        else handled = false;
        break;
      }
      case "Enter": pickSession(session.id); break;
      default: handled = false;
    }
    if (!handled) return;
    byKeyboard = true;
    chipRow.classList.add("kbd");
    e.preventDefault();
  });

  // On the lines of the journal that open a subagent.
  journal.addEventListener("keydown", (e) => {
    const line = (e.target as HTMLElement).closest<HTMLElement>("[data-sub]");
    if (!line || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const all = launches();
    const i = all.indexOf(line);
    const stop = strip.hidden ? undefined : stops().find((r) => r.tabIndex === 0);
    let handled = true;
    switch (e.key) {
      case "ArrowDown": if (all[i + 1]) focusLaunch(all[i + 1]); else handled = false; break;
      case "ArrowUp":
        if (all[i - 1]) focusLaunch(all[i - 1]);
        else if (stop) moveTo(stop);
        else handled = false;
        break;
      case "Home": focusLaunch(all[0]); break;
      case "End": focusLaunch(all[all.length - 1]); break;
      case "ArrowLeft":
        if (stop) moveTo(stop);
        else handled = false;
        break;
      default: handled = false;
    }
    if (!handled) return;
    byKeyboard = true;
    chipRow.classList.add("kbd");
    e.preventDefault();
  });

  // ── Typing ──────────────────────────────────────────────────────────────────

  let typing: number | null = null;
  /** Shows at once whatever the typing under way has left to type. */
  let finishTyping: (() => void) | null = null;

  function stopTyping() {
    if (typing != null) window.clearInterval(typing);
    typing = null;
    finishTyping?.();
    finishTyping = null;
  }

  /**
   * Types the new lines of an edit one after the other, a caret at the end,
   * each line taking its colours once it is whole. Out of sight — the island
   * folded, another view up — it has nobody to type for and ends at once.
   */
  function type(lines: ToType[], kind: FileKind) {
    stopTyping();
    if (lines.length === 0) return;
    const total = lines.reduce((n, l) => n + l.text.length + 1, 0);
    const perTick = Math.max(1, Math.ceil(total / (TYPE_MS / TICK_MS)));
    const caret = h("span", { class: "sess-caret" });
    let at = 0;
    let letters = 0;

    const finish = (line: ToType) => line.row.replaceWith(diffLine(line.number, "+", line.text, kind));
    const begin = (line: ToType) => {
      line.row.classList.remove("untyped");
      // Only for one who follows the end: a reader who is further up keeps their place.
      if (pinned || gapBelow() <= FOLLOW_PX) line.row.scrollIntoView({ block: "nearest" });
    };
    begin(lines[0]);
    finishTyping = () => lines.slice(at).forEach(finish);

    typing = window.setInterval(() => {
      const seen = State.mode === "expanded" && State.view === "session" && lines[at].row.isConnected;
      let budget = seen ? perTick : total;
      while (budget > 0 && at < lines.length) {
        const line = lines[at];
        const step = Math.min(budget, line.text.length - letters);
        letters += step;
        budget -= step;
        if (letters < line.text.length) break;
        // The end of a line costs a letter: the pause of a carriage return.
        finish(line);
        budget -= 1;
        at++;
        letters = 0;
        if (at < lines.length) begin(lines[at]);
      }
      if (at >= lines.length) {
        stopTyping();
        if (pinned || gapBelow() <= FOLLOW_PX) journal.scrollTop = journal.scrollHeight;
        return;
      }
      const cell = lines[at].row.querySelector(".t");
      if (cell) {
        cell.textContent = lines[at].text.slice(0, letters);
        cell.append(caret);
      }
    }, TICK_MS);
  }

  // ── A journal: the session's, or a subagent's ───────────────────────────────

  /** Each step's entry, kept: only one that changed is drawn again, and a scroll or a selection stays. */
  const entries = new WeakMap<SessionStep, { el: HTMLElement; key: string }>();
  /** The edits typed already: an edit is typed once. */
  const typedSteps = new WeakSet<SessionStep>();
  const empty = h("div", { class: "int-empty" });
  /** What the journal was last opened on: another session or subagent, or the panel entered again, starts at its end. */
  let opened = "";
  let shown = "";
  let shownSession = "";

  /**
   * A subagent, on its line of the block where it was launched: what it is
   * at, quieter its kind and its model, and how it stands. A click opens its
   * own view.
   */
  function launchRow(session: ClaudeSession, a: Subagent): HTMLElement {
    const stands = subagentStanding(session, a);
    const task = subagentTask(a);
    // With nothing said of what it is at, its kind is the line.
    const meta = (task ? [subagentKind(a), a.model?.label] : [a.model?.label]).filter(Boolean).join(" · ");
    const row = h(
      "button",
      {
        class: `jr sess-launch ${stands}`,
        title: `${fullName(a)} — ${statusWords(session, a)}. ${t("sess.openSteps")}`,
        onclick: () => openAgent(session.id, a.id),
      },
      MARKS[stands](),
      h("span", { class: "sess-launch-task", text: task || subagentKind(a) }),
      meta ? h("span", { class: "sess-launch-meta", text: meta, title: a.model?.id }) : null,
      h("span", { class: "grow" }),
      statusOf(session, a),
      h("i", { class: "sess-launch-go" }, svg(ICONS.chevronRight, 9, { stroke: 2.8 })),
    );
    // What the arrows reach from the row of sessions (and from each other).
    row.dataset.sub = a.id;
    return row;
  }

  /** The line that dates a block of the journal, kept for the step that begins the block. */
  const whens = new WeakMap<SessionStep, HTMLElement>();
  function whenLabel(step: SessionStep): HTMLElement {
    let label = whens.get(step);
    if (!label) {
      label = h("div", { class: "jr jr-when" });
      whens.set(step, label);
    }
    // The clock of the panel (tick) writes the words again from this.
    label.dataset.at = String(step.at);
    const words = whenWords(step.at);
    if (label.textContent !== words) label.textContent = words;
    label.title = whenTip(step.at);
    return label;
  }

  interface SubsBlock {
    el: HTMLElement;
    head: HTMLElement;
    list: HTMLElement;
    key: string;
  }
  const subsBlocks = new WeakMap<SessionStep, SubsBlock>();

  /**
   * Subagents launched one after the other, where they were: one block with
   * how many, how they stand (the one that needs the user first), and a line
   * for each. Kept for the step that begins it, so its lines are not rebuilt
   * under a click.
   */
  function subsBlock(session: ClaudeSession, first: SessionStep, agents: Subagent[], rows: HTMLElement[]): HTMLElement {
    let found = subsBlocks.get(first);
    if (!found) {
      const head = h("div", { class: "jr-subs-h" });
      const list = h("div", { class: "jr-subs-list" });
      found = { el: h("div", { class: "jr jr-subs" }, head, list), head, list, key: "" };
      subsBlocks.set(first, found);
    }
    const block = found;
    const standing = agents.map((a) => subagentStanding(session, a));
    const of = (what: string) => standing.filter((s) => s === what).length;
    const asking = of("asking");
    const going = of("running");
    const failed = of("failed");
    const key = `${standing.join()}~${currentLang()}`;
    if (block.key !== key) {
      block.key = key;
      const overall = asking > 0 ? "asking" : going > 0 ? "running" : failed > 0 ? "failed" : "done";
      const words =
        asking > 0 ? t("sess.subs.asking", { count: asking })
        : going > 0 ? t("sess.nRunning", { n: going })
        : failed > 0 ? t("sess.subs.failed", { count: failed })
        : t("sess.subs.done", { count: agents.length });
      block.head.replaceChildren(
        MARKS[overall](),
        h("b", { text: t("sess.subs.launched", { count: agents.length }) }),
        h("span", { class: "grow" }),
        h("span", { class: `jr-subs-state ${overall}`, text: words }),
      );
    }
    const same = block.list.children.length === rows.length && rows.every((row, i) => block.list.children[i] === row);
    if (!same) block.list.replaceChildren(...rows);
    return block.el;
  }

  /** What a subagent's view ends on, kept while it says the same: its buttons are not rebuilt under a click. */
  let ended: { key: string; el: HTMLElement; of: Subagent } | null = null;

  /** The reply whose form has just been changed, or that the panel was entered to read: its top is brought into view. */
  let reveal: object | null = null;

  /** A long reply's form, and the way to its other one. `key` is its step, or its subagent. */
  function foldOf(key: object): ReplyFold {
    return {
      open: replyFolds.get(key) ?? false,
      toggle(open) {
        actions.blip();
        replyFolds.set(key, open);
        reveal = key;
        State.notify();
      },
    };
  }

  /**
   * Before a session's journal is drawn: the reply the panel was entered to
   * read opens whole; and a reply that waits on a decision, once it is on show
   * whole — a short one as soon as its journal is, a long one once it has
   * been opened — has been read: its mark goes.
   */
  function settleReply(session: ClaudeSession, agent: Subagent | null) {
    const whole = wantWhole;
    wantWhole = false;
    if (agent || !(whole || session.decision)) return;
    const said = lastReply(session);
    if (!said) return;
    if (whole && isLong(said)) {
      replyFolds.set(said, true);
      reveal = said;
    }
    const shown = State.mode === "expanded" && State.view === "session" && filter === "all";
    if (session.decision && shown && said.target === session.answer && (!isLong(said) || replyFolds.get(said) === true)) session.decision = false;
  }

  /** What a subagent's view ends on: what it came back with — or, while it runs, that it still does. */
  function ending(session: ClaudeSession, a: Subagent): HTMLElement {
    const stands = subagentStanding(session, a);
    const request = requestsOf(session).find((r) => r.agentId === a.id) ?? null;
    // What it came back with opens the files it names in its session's editor.
    const opener = openerOf(session);
    const key = [session.id, a.id, stands, a.result, request?.requestId, a.timed, a.endedAt, replyFolds.get(a) ?? false, opener?.tip ?? ""].join("~");
    if (ended?.key === key) return ended.el;
    let el: HTMLElement;
    if (request) {
      const question = isQuestion(request);
      const what = question ? (request.questions[0]?.question ?? "") : request.command;
      el = h(
        "div",
        { class: "jr sess-end asking" },
        MARKS.asking(),
        h("span", { class: "sess-end-words" }, h("b", { text: question ? t("sess.end.answer") : t("sess.end.permission") }), h("span", { class: "sess-end-what", text: what, title: what })),
        h("button", { class: "sess-end-btn", text: question ? t("sess.end.showQuestion") : t("sess.end.showRequest"), onclick: () => actions.showRequest() }),
      );
    } else if (a.state === "running") {
      el = h("div", { class: "jr sess-end running" }, MARKS.running(), h("span", { class: "sess-end-words" }, h("b", {}, ...(a.timed ? [`${t("sess.end.running")} · `, running(a.startedAt)] : [t("sess.end.running")])), h("span", { text: t("sess.end.later") })));
    } else {
      const failed = a.state === "failed";
      el = h(
        "div",
        { class: `jr sess-result ${a.state}` },
        h("div", { class: "sess-result-h" }, MARKS[a.state](), h("b", { text: failed ? t("sess.end.stopped") : t("sess.end.result") }), h("span", { text: endedWords(a) })),
        replyView(a.result ?? (failed ? t("sess.end.saidNothing") : t("sess.end.noMessage")), opener, foldOf(a)),
      );
    }
    ended = { key, el, of: a };
    return el;
  }

  /** No agent ids on tool events: SubagentStart and SubagentStop still name the subagent, but none of its steps do. */
  const apart = h(
    "div",
    { class: "jr sess-apart" },
    svg(ICONS.bang, 12),
    h(
      "div",
      {},
      h("b", { text: () => t("sess.apart.title") }),
      h("span", { text: () => t("sess.apart.sub") }),
      h("button", { class: "sess-end-btn", text: () => t("sess.apart.open"), onclick: () => go({ kind: "live" }) }),
    ),
  );

  const wanted = (step: SessionStep) => filter === "all" || step.kind === filter;

  function syncJournal(session: ClaudeSession, agent: Subagent | null) {
    const source = `${session.id}/${agent?.id ?? ""}`;
    const entering = opened !== `${source}:${stamp}`;
    opened = `${source}:${stamp}`;
    if (entering) {
      pin(true);
      unread = held = false;
    }
    // A turn ended while this was being read: the journal does not follow its
    // end, nor move at all, until the reader goes down by themselves (the
    // button) — whether they were at the end or further up.
    const keep = holding && !entering;
    if (keep) pin(false);
    const following = entering || (!keep && (pinned || gapBelow() <= FOLLOW_PX));
    const was = journal.scrollHeight;
    const place = journal.scrollTop;
    const large = State.large;
    const told = agent == null || stepsApart(session, agent);

    let toType: { lines: ToType[]; kind: FileKind } | null = null;
    const said: Said = { opener: openerOf(session), fold: foldOf };
    const nodes: HTMLElement[] = [];
    const steps = agent ? agent.steps : session.steps;

    // Subagents launched one after the other are one block, where they were
    // launched; the time is said once above each block of steps.
    let group: { first: SessionStep; agents: Subagent[]; rows: HTMLElement[]; fresh: boolean } | null = null;
    const closeGroup = () => {
      if (!group) return;
      const { first, agents, rows, fresh } = group;
      group = null;
      const isNew = !subsBlocks.has(first);
      const block = subsBlock(session, first, agents, rows);
      // A block that comes in rises as one, not each of its lines.
      if (isNew && fresh) {
        for (const row of rows) row.classList.remove("in", "more");
        block.classList.add("in");
      }
      nodes.push(block);
    };
    let blockFrom = -1;
    let lastAt = 0;

    for (const step of told ? steps.filter(wanted) : []) {
      // Where a subagent was launched: a line in the block, drawn from how the subagent stands.
      const launched = step.kind === "launch" ? session.subagents.find((a) => a.id === step.agentId) : null;
      if (step.kind === "launch" && !launched) continue;
      if (blockFrom < 0 || step.at - lastAt >= BLOCK_GAP_MS || step.at - blockFrom >= BLOCK_SPAN_MS) {
        closeGroup();
        nodes.push(whenLabel(step));
        blockFrom = step.at;
      }
      lastAt = step.at;
      if (!launched) closeGroup();
      const key = launched
        ? [launched.type, subagentTask(launched), subagentStanding(session, launched), launched.endedAt, launched.timed, launched.model?.label].join("~") + currentLang()
        : entryKey(step, large, said.opener) + currentLang();
      let entry = entries.get(step);
      if (!entry || entry.key !== key) {
        const known = entry != null;
        // Typed once, and only while it is news: seen later, the edit is just there.
        const fresh = step.patch != null && !typedSteps.has(step) && !entering && Date.now() - step.at < FRESH_MS;
        if (step.patch != null) typedSteps.add(step);
        const lines: ToType[] = [];
        const drawn = launched ? launchRow(session, launched) : journalEntry(step, large, said, fresh ? lines : undefined);
        // A line that is new comes in; one that got something more — what the
        // tool gave back, what was decided — only brings that in.
        if (!entering) drawn.classList.add(known ? "more" : "in");
        entry?.el.replaceWith(drawn);
        entry = { el: drawn, key };
        entries.set(step, entry);
        if (lines.length > 0) toType = { lines, kind: fileKind(step.target ?? "") };
      }
      if (launched) {
        group ??= { first: step, agents: [], rows: [], fresh: !entering };
        group.agents.push(launched);
        group.rows.push(entry.el);
      } else nodes.push(entry.el);
    }
    closeGroup();
    if (!told) nodes.push(apart);
    else if (nodes.length === 0) {
      empty.textContent =
        filter !== "all" ? t(agent ? (steps.length > 0 ? "sess.empty.kindSub" : "sess.empty.kindSubYet") : (steps.length > 0 ? "sess.empty.kind" : "sess.empty.kindYet"))
        : agent ? t("sess.empty.noStep")
        : session.id ? t("sess.empty.nothing") : t("sess.empty.noSession");
      nodes.push(empty);
    }
    if (agent) nodes.push(ending(session, agent));
    const same = journal.children.length === nodes.length && nodes.every((node, i) => journal.children[i] === node);
    if (!same) journal.replaceChildren(...nodes);
    if (keep) {
      journal.scrollTop = place;
      // No scroll event comes if the end did not move: where the reader stands decides.
      pin(gapBelow() <= FOLLOW_PX);
    }

    // Another session's journal comes in from the side; a subagent's, and the
    // way back from it, rise into place.
    if (entering && source !== shown) {
      if (session.id !== shownSession) {
        if (shownSession) replay(journal, "gh-from-right");
      } else {
        replay(journal, "sess-enter");
      }
      shown = source;
      shownSession = session.id;
    }
    // A reply just opened, or put back as it was, is read from its top: not from the journal's end.
    const revealed = reveal ? (reveal === ended?.of ? ended.el : entries.get(reveal as SessionStep)?.el) : null;
    reveal = null;
    if (toType) type(toType.lines, toType.kind);
    else if (revealed?.isConnected) {
      journal.scrollTop += revealed.getBoundingClientRect().top - journal.getBoundingClientRect().top - REVEAL_GAP;
      // Moved down, the scroll listener would not let go of the end: the panel's
      // next resize would take the reply from its top. Reaching the end by the
      // reader's own scroll pins again.
      if (gapBelow() > FOLLOW_PX) pin(false);
    } else if (following && typing == null) journal.scrollTo({ top: journal.scrollHeight, behavior: entering ? "auto" : "smooth" });
    if (!following && journal.scrollHeight > was) unread = true;
    if (keep) unread = held = true;
    placeJump();
    if (keep && !jump.hidden) wiggle(jump, jump);
  }

  // ── Above the journal ───────────────────────────────────────────────────────

  let topKey = "";

  /** How many steps of a kind the journal has: "all" counts every tool. */
  const counts = (steps: SessionStep[], id: Filter) => steps.filter((s) => isTool(s) && (id === "all" || s.kind === (id as StepKind))).length;

  /**
   * The chips that keep one kind of step, each with how many of them the
   * journal has. A kind with none is not offered — unless it is the one kept.
   */
  function chips(steps: SessionStep[]): HTMLElement[] {
    return FILTERS.filter(([id]) => id === "all" || filter === id || counts(steps, id) > 0).map(([id, label]) => {
      const count = counts(steps, id);
      return h(
        "button",
        {
          class: filter === id ? "sess-f on" : "sess-f",
          "aria-pressed": String(filter === id),
          onclick: () => {
            actions.blip();
            filter = id;
            State.notify();
          },
        },
        t(label), h("b", { text: String(count) }),
      );
    });
  }

  function drawTop(session: ClaudeSession, agent: Subagent | null) {
    const steps = agent ? agent.steps : session.steps;
    const next = [
      session.id, agent?.id, filter, FILTERS.map(([id]) => counts(steps, id)).join(","),
      agent ? [agent.type, subagentTask(agent), subagentStanding(session, agent), agent.endedAt, agent.timed, stepsApart(session, agent), folderOf(session), agent.model?.label].join(":") : "",
      currentLang(),
    ].join("~");
    if (next === topKey) return;
    topKey = next;
    clear(filters);
    clear(crumb);
    if (!agent) {
      filters.append(...chips(steps));
      return;
    }
    const folder = folderOf(session);
    const back = () => {
      actions.blip();
      go({ kind: "live" });
    };
    crumb.append(
      h("button", { class: "sess-crumb-back", title: t("sess.backTo", { folder }), "aria-label": t("sess.backMain"), onclick: back }, svg(ICONS.chevronLeft, 11, { stroke: 2.8 })),
      h("button", { class: "sess-crumb-session", text: folder, title: t("sess.backTo", { folder }), onclick: back }),
      h("span", { class: "sess-crumb-sep", text: "›" }),
      h("span", { class: "sess-crumb-type", text: subagentKind(agent) }),
      ...(subagentTask(agent)
        ? [h("span", { class: "sess-crumb-dot", text: "·" }), h("b", { class: "sess-crumb-task", text: subagentTask(agent)!, title: subagentName(agent) })]
        : []),
      h("span", { class: "grow" }),
      ...modelChip(agent.model),
      MARKS[subagentStanding(session, agent)](),
      statusOf(session, agent),
    );
    // Its chips count its own steps, and nothing else's. With no agent ids there are none to count.
    if (stepsApart(session, agent)) filters.append(...chips(steps));
  }

  // ── The header of the card ──────────────────────────────────────────────────

  let whoKey = "";

  /**
   * The session's title, whole, and under it where it is at: its state, the
   * model it runs on, the files it changed (the way to them) and how full its
   * context is — and, on the right, the way to where it runs.
   */
  function drawHead(session: ClaudeSession) {
    const at = standing(session);
    const files = State.sessionFiles.length;
    const waits = session.question != null || session.approval != null;
    const use = contextUse(session.contextTokens, session.contextWindow, session.model?.id);
    const words = targetWords(session.target);
    const tip = targetTip(session);
    const key = [
      session.id, session.title, folderOf(session), session.agent, at.words, at.color, at.quiet, waits, session.model?.label, files, use?.percent, use?.level,
      session.target.kind, session.target.label, tip, strip.hidden, currentLang(),
    ].join("~");
    if (key === whoKey) return;
    whoKey = key;

    const name = session.id ? (session.title ?? folderOf(session)) : UNNAMED;
    title.textContent = name;
    title.title = name;

    const bits: HTMLElement[] = [];
    if (session.id) {
      // With the row of sessions over the card, which one this is is said there; alone, here.
      if (strip.hidden) bits.push(h("span", { class: "sess-where" }, toolMark(session.agent, 11), session.title ? folderOf(session) : TOOL_NAME[session.agent]));
      // Where it is at; while it waits for an answer, the way to its card.
      const state = h(waits ? "button" : "span", { class: "sess-state", text: at.words });
      state.style.setProperty("--c", at.quiet ? COLOR.grey : at.color);
      if (at.quiet) state.title = quietTip();
      if (waits) {
        state.classList.add("opens");
        state.title = t("sess.seeRequest");
        state.addEventListener("click", () => actions.showRequest());
      }
      bits.push(state);
      if (session.model) bits.push(h("span", { class: "sess-meta", text: session.model.label, title: session.model.id }));
      if (files > 0) {
        bits.push(h("button", {
          class: "sess-files", type: "button", title: t("sess.filesTip"), text: counted(files, "sess.n.file"),
          onclick: () => {
            actions.blip();
            go({ kind: "list" });
          },
        }));
      }
      // How full its context is, for the one to go and /compact: a cue, as Oleo cannot do it.
      if (use) {
        const said = t("sess.context", { n: use.percent });
        bits.push(h("span", { class: "sess-meta sess-use", title: said }, h("i", { class: `sess-ctx ${use.level}` }, h("u", { style: `width:${use.percent}%` })), said));
      }
    }
    line.replaceChildren(...bits.flatMap((bit, i) => (i === 0 ? [bit] : [h("i", { class: "sess-sep", text: "·" }), bit])));

    goBtn.hidden = !(words && tip);
    if (words && tip) {
      goBtn.title = tip;
      goBtn.setAttribute("aria-label", tip);
      goBtn.dataset.target = session.target.kind;
      goBtn.replaceChildren(...[targetIcon(session.target.kind, 11), words].filter((part): part is SVGElement | string => part != null));
    }
  }

  // ── Time that runs ──────────────────────────────────────────────────────────
  // "running 1m 23s" moves a second at a time, on a timer of its own that
  // writes the words and nothing else: it never wakes the island's frame loop.
  // It runs only while the panel is on show with something going in it, and
  // stops itself the moment either is no longer so.

  let clockTimer: number | null = null;

  function tick() {
    const seen = State.mode === "expanded" && State.view === "session";
    const going = seen ? el.querySelectorAll<HTMLElement>(".sess-elapsed") : null;
    for (const span of going ?? []) span.textContent = elapsed(Date.now() - Number(span.dataset.since));
    // "Now", "3 min ago": written only when the words change.
    const dated = seen ? el.querySelectorAll<HTMLElement>(".jr-when") : null;
    for (const label of dated ?? []) {
      const words = whenWords(Number(label.dataset.at));
      if (label.textContent !== words) label.textContent = words;
    }
    if ((going && going.length > 0) || (dated && dated.length > 0)) return;
    if (clockTimer != null) window.clearInterval(clockTimer);
    clockTimer = null;
  }

  /** The session the panel was last drawn for. */
  let followed = "";
  /** How many held-back turn ends of each session the panel has shown. */
  const shownNudges = new WeakMap<ClaudeSession, number>();
  let key = "";
  let headKey = "";
  /** What the list last drew, to keep its scroll when it draws the same again. */
  let drawn = "";
  let wasLarge = false;

  return {
    el,
    // The panel has just come on show.
    arm: focusPanel,
    // Tab and Shift+Tab: the next session along the row, round and round,
    // picked as a click on its chip picks it. A subagent's view is left for
    // the next session's journal. No chip takes the focus, and none wears a
    // ring for it.
    step(by) {
      const all = State.sessions;
      if (all.length < 2) return;
      const at = all.findIndex((s) => s.id === State.frontId);
      const next = all[(Math.max(0, at) + by + all.length) % all.length];
      pickSession(next.id);
      // The row's tab stop follows, so that an arrow pressed next starts from there.
      focusKey = sessionKey(next.id);
    },
    sync() {
      const session = State.session;
      const files = State.sessionFiles;

      // Turns that ended since the last sync, while the panel was being read
      // (hooks.ts `hold`): each session's count is compared with what was shown.
      // A session met for the first time shows nothing for what came before.
      const nudged = State.sessions.filter((s) => s.nudges !== (shownNudges.get(s) ?? s.nudges));
      for (const s of State.sessions) shownNudges.set(s, s.nudges);
      holding = nudged.includes(session);

      // Another session came in front: whatever of the last one was open — a
      // file, a subagent — its journal.
      if (session.id !== followed) {
        // A finish still owed to the one left behind is not lost: its line keeps the mark.
        if (owed && owed !== session) owed.attention = true;
        owed = null;
        followed = session.id;
        if (!(screen.kind === "agent" && screen.session === session.id)) screen = { kind: "live" };
        filter = "all";
        stamp++;
      }
      // A subagent that is no longer among the session's gives way to the main journal.
      const agentId = screen.kind === "agent" ? screen.id : null;
      const agent = agentId ? (session.subagents.find((a) => a.id === agentId) ?? null) : null;
      if (agentId && !agent) screen = { kind: "live" };
      // A file opened and gone since (another session took over): the list.
      const openedFile = screen.kind === "file" ? screen.path : null;
      const picked = openedFile ? (files.find((f) => f.path === openedFile) ?? null) : null;
      if (openedFile && !picked) screen = { kind: "list" };
      const live = screen.kind === "live" || screen.kind === "agent";
      // A finish held back while the journal is not on show: signalled on the line now, on the button when the journal is back.
      if (holding && !live) owed = session;
      else if (live && owed === session) {
        holding = true;
        owed = null;
      }

      // The panel's size: what the large one shows more of is drawn from this.
      el.classList.toggle("large", State.large);
      if (State.large && !wasLarge) focusPanel();
      wasLarge = State.large;

      // The row of sessions, with more than one: the card, and the bot in it, go down by its height.
      const several = State.sessions.length > 1;
      strip.hidden = !several;
      SessionRoom.strip = several;
      drawToolChips();
      // Before the row is drawn: a reply read whole takes its mark off its chip.
      if (live) settleReply(session, agent);
      drawStrip(session);
      chipRow.classList.toggle("kbd", byKeyboard);
      // Another session's turn ended: its chip shakes, if it is on show.
      for (const s of nudged) {
        const chip = s === session && live ? null : stops().find((r) => r.dataset.key === sessionKey(s.id));
        if (chip) wiggle(chip, s);
      }
      // The header of the card: whose session this is, and where it is at.
      drawHead(session);

      journal.style.display = live ? "" : "none";
      list.style.display = live ? "none" : "";
      head.style.display = live ? "none" : "";
      crumb.style.display = agent ? "" : "none";
      const steps = agent ? agent.steps : session.steps;
      filters.style.display = live && (!agent || stepsApart(session, agent)) && steps.some(isTool) ? "" : "none";
      main.classList.toggle("of-agent", agent != null);
      // A reply goes to the session, never to one of its subagents; and not from its changes.
      replyBox.sync(screen.kind === "live" ? session : null);
      if (replyBox.el.hidden) main.style.removeProperty("--rb-h");
      if (!live) stopTyping();

      if (live) {
        main.style.setProperty("--accent", "rgba(0,0,0,0)");
        headKey = "";
        drawTop(session, agent);
        syncJournal(session, agent);
        if (clockTimer == null && State.mode === "expanded" && el.querySelector(".sess-elapsed, .jr-when")) {
          clockTimer = window.setInterval(tick, 1000);
          tick();
        }
        return;
      }

      // The head: a file opened from the changes has its name on the tab, as in an editor.
      const path = picked?.path ?? null;
      const nextHead = [session.id, screen.kind, path, files.length, picked?.edits.length, currentLang()].join("~");
      if (nextHead !== headKey) {
        headKey = nextHead;
        clear(badge);
        clear(aside);
        sub.classList.toggle("path", path != null);
        who.classList.toggle("file", path != null);
        if (path) {
          who.textContent = splitPath(path).base;
          sub.textContent = path;
          badge.append(extBadge(path));
        } else {
          who.textContent = t("sess.changes");
          sub.textContent = files.length > 0 ? counted(files.length, "sess.n.file") : "";
          badge.append(dot(standing(session).color, 7));
        }
        if (picked) aside.append(statusWord(picked), plusMinus(picked.additions, picked.deletions));
        else if (files.length > 0) {
          aside.append(plusMinus(files.reduce((n, f) => n + f.additions, 0), files.reduce((n, f) => n + f.deletions, 0)));
        }
        main.style.setProperty("--accent", picked ? (picked.created ? COLOR.green : COLOR.amber) : "rgba(0,0,0,0)");
      }

      // Rebuilding the rows between a mouse-down and its mouse-up would swallow
      // the click, so only rebuild when something they show has changed.
      const total = files.reduce((n, f) => n + f.edits.length, 0);
      const next = [session.id, stamp, screen.kind, total, files[0]?.path].join("~");
      if (next === key) return;
      key = next;

      const now = `${screen.kind}:${picked?.path ?? ""}`;
      const scroll = now === drawn ? list.scrollTop : 0;
      drawn = now;
      clear(list);
      list.classList.toggle("gh-edge", picked != null);
      if (picked) list.append(diffView(picked, fileKind(picked.path)));
      else if (files.length === 0) list.append(h("div", { class: "int-empty", text: t("sess.noFiles") }));
      else for (const f of files) list.append(fileRow(f));
      list.scrollTop = scroll;
    },
  };
}
