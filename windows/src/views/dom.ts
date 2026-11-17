// Minimal DOM helpers — no framework, as specified.

import { onLangChange, t } from "../core/i18n";

/**
 * Words that follow the language: a function in place of a string — `text`,
 * `title`, an aria-label, a child — is asked again whenever the language
 * changes. For what is built once and never written again; what a view writes
 * on each sync is written in the language on show anyway.
 */
export type Words = () => string;
type Attrs = Record<string, string | number | boolean | EventListener | Words | undefined>;
type Child = Node | string | Words | null | undefined | false;

const bound: { node: WeakRef<Node>; apply: (node: Node) => void }[] = [];
onLangChange(() => {
  for (let i = bound.length - 1; i >= 0; i--) {
    const node = bound[i].node.deref();
    if (node) bound[i].apply(node);
    else bound.splice(i, 1);
  }
});

/** Runs `apply` now, and again on every change of language while `node` lives. */
export function follow<T extends Node>(node: T, apply: (node: T) => void): T {
  apply(node);
  bound.push({ node: new WeakRef(node), apply: apply as (node: Node) => void });
  return node;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (typeof v === "function") {
      const words = v as Words;
      follow(el, (node) => (k === "text" ? (node.textContent = words()) : node.setAttribute(k, words())));
    } else if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === "function") el.append(follow(document.createTextNode(""), (node) => (node.textContent = c())));
    else el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg(path: string, size = 14, opts: { fill?: string; stroke?: number } = {}): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  if (opts.stroke) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", String(opts.stroke));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  } else {
    p.setAttribute("fill", opts.fill ?? "currentColor");
  }
  el.append(p);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Card dot used in every "who" row. */
export function dot(color: string, size = 7): HTMLElement {
  return h("i", {
    class: "dot",
    style: `width:${size}px;height:${size}px;background:${color}`,
  });
}

/**
 * Plays an element's entrance again: the class that carries the animation is
 * taken off and put back, with a look at the layout between the two so the
 * browser sees it go.
 */
export function replay(el: HTMLElement, animation: string) {
  el.classList.remove(animation);
  void el.offsetWidth;
  el.classList.add(animation);
}

/** Same shape as the Swift `timeAgo` computed properties. */
export function timeAgo(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return t("time.justNow");
  if (diff < 3600) return t("time.m", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.h", { n: Math.floor(diff / 3600) });
  return t("time.d", { n: Math.floor(diff / 86400) });
}
