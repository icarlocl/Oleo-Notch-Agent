// The words of the interface, in English, Spanish and Portuguese.
//
// Every string a person reads goes through `t(key)`. The tables beside this
// file hold each string once, its three languages side by side, as
// `[es, en, pt]`: Spanish is the reference copy. A plural is two keys,
// `name.one` and `name.other`, asked for as `t("name", { count })`; `{word}`
// in a string is filled from the params.
//
// The language is a setting (`Settings.language`: "system", "en", "es" or
// "pt"). "system" follows the browser's — the OS's — first language: any
// `es-*` is Spanish, any `pt-*` Portuguese, anything else English. The choice
// is also kept in localStorage, so a page that builds its words before the
// settings arrive (the settings window) starts in the right language.

import { AGENTS } from "./agents";
import { ISLAND } from "./island";
import { SETTINGS } from "./settings";
import { WIDGETS } from "./widgets";

export type Lang = "en" | "es" | "pt";
export type LanguageSetting = "system" | Lang;
export const LANGS: readonly Lang[] = ["en", "es", "pt"];
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["system", "en", "es", "pt"];

/** Each language's name, written in that language: the way a person finds their own. */
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", es: "Español", pt: "Português" };

type Row = readonly [es: string, en: string, pt: string];
const TABLE = { ...SETTINGS, ...ISLAND, ...WIDGETS, ...AGENTS } as const satisfies Record<string, Row>;
type Table = typeof TABLE;
export type Key = keyof Table;
/** The keys asked for with a count: `x` for the pair `x.one` / `x.other`. */
type PluralKey = { [K in Key]: K extends `${infer Base}.other` ? Base : never }[Key];

const COLUMN: Record<Lang, 0 | 1 | 2> = { es: 0, en: 1, pt: 2 };
const LOCALES: Record<Lang, string> = { en: "en-US", es: "es-CL", pt: "pt-BR" };
const STORE = "oleo.language";

/** A locale tag as one of the three: es-* and pt-* by their first part, anything else English. */
export function langOf(tag: string | null | undefined): Lang {
  const base = String(tag ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "es" ? "es" : base === "pt" ? "pt" : "en";
}

/** The system's language, as the browser — the WebView, which follows Windows — reports it. */
export function systemLang(): Lang {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return langOf(nav?.languages?.[0] ?? nav?.language);
}

const isSetting = (value: unknown): value is LanguageSetting => (LANGUAGE_SETTINGS as readonly unknown[]).includes(value);
export const resolveLang = (setting: LanguageSetting): Lang => (setting === "system" ? systemLang() : setting);

function stored(): LanguageSetting {
  try {
    const value = localStorage.getItem(STORE);
    return isSetting(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** A dev page's `?lang=en|es|pt`: it holds the language whatever the settings say (screenshots). */
const pinned: Lang | null = (() => {
  if (!import.meta.env.DEV || typeof location === "undefined") return null;
  const asked = new URLSearchParams(location.search).get("lang");
  return asked === "en" || asked === "es" || asked === "pt" ? asked : null;
})();

let setting: LanguageSetting = pinned ?? stored();
let lang: Lang = resolveLang(setting);
const listeners = new Set<() => void>();

/** The language on show. */
export const currentLang = (): Lang => lang;
/** The setting it comes from: "system" or one of the three. */
export const languageSetting = (): LanguageSetting => setting;
/** The locale Intl formats dates and numbers in. Spanish is Chile's. */
export const locale = (): string => LOCALES[lang];

function markPage() {
  if (typeof document !== "undefined") document.documentElement.lang = locale();
}
markPage();

/**
 * The language the settings say: kept, and — when it changes what is on show
 * — every listener told. True when the language on show changed.
 */
export function setLanguage(next: unknown): boolean {
  if (pinned) return false;
  const wanted: LanguageSetting = isSetting(next) ? next : "system";
  setting = wanted;
  try {
    localStorage.setItem(STORE, wanted);
  } catch {
    // Storage may be off: the settings still say it.
  }
  const resolved = resolveLang(wanted);
  if (resolved === lang) return false;
  lang = resolved;
  markPage();
  for (const fn of [...listeners]) fn();
  return true;
}

/** Told when the language on show changes. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Params = Record<string, string | number>;

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;

/**
 * A string in the language on show. With `count` in the params, a pair of
 * plural keys (`key.one`, `key.other`) is picked from.
 */
export function t(key: Key | PluralKey, params?: Params): string {
  const table = TABLE as Record<string, Row>;
  let row = table[key];
  if (params && typeof params.count === "number") {
    row = table[`${key}.${params.count === 1 ? "one" : "other"}`] ?? row;
  }
  if (!row) return key;
  return fill(row[COLUMN[lang]] || row[1], params);
}

/** A number in the locale on show: "1.234" in Spanish, "1,234" in English. */
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale(), options).format(value);
