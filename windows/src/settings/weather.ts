import { currentLang, t } from "../core/i18n";
import type { WeatherLocation } from "../core/state";
import { h } from "../views/dom";

const GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";

export function weatherPicker(select: (location: WeatherLocation | null) => void) {
  const input = h("input", {
    class: "sp-search-input", type: "search", placeholder: t("s.wx.placeholder"),
    "aria-label": t("s.wx.placeholder"), required: true, minlength: 2, maxlength: 100,
  });
  const search = h("button", { class: "sp-btn primary", type: "submit", text: t("s.wx.search") });
  const remove = h("button", { class: "sp-btn quiet", type: "button", text: t("s.wx.off") });
  const current = h("p", { class: "sp-help", role: "status" });
  const feedback = h("p", { class: "sp-help", role: "status" });
  const results = h("ul", { class: "sp-weather-results", "aria-label": t("s.wx.found") });
  const form = h("form", { class: "sp-weather-form" }, input, search);
  const el = h("div", {}, current, form, feedback, results, remove);
  let request: AbortController | null = null;

  function paint(location: WeatherLocation | null) {
    current.textContent = location ? t("s.wx.current", { label: location.label }) : t("s.wx.isOff");
    remove.hidden = !location;
  }

  function commit(location: WeatherLocation | null) {
    request?.abort();
    request = null;
    input.value = "";
    feedback.textContent = "";
    results.replaceChildren();
    paint(location);
    select(location);
    input.focus();
  }
  remove.addEventListener("click", () => commit(null));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    results.replaceChildren();
    feedback.textContent = t("s.wx.searching");
    const url = new URL(GEOCODING);
    url.search = new URLSearchParams({ name, count: "8", language: currentLang() }).toString();
    try {
      const response = await fetch(url, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error("Error al buscar ubicaciones");
      const data = await response.json();
      if (request !== controller) return;
      const entries: unknown[] = Array.isArray(data?.results) ? data.results : [];
      for (const item of entries) {
        if (!item || typeof item !== "object") continue;
        const { name, admin1, country, latitude, longitude } = item as Record<string, unknown>;
        if (typeof name !== "string" || typeof latitude !== "number" || typeof longitude !== "number"
          || !Number.isFinite(latitude) || !Number.isFinite(longitude)
          || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
        const label = [...new Set([name, admin1, country].filter((part): part is string => typeof part === "string" && !!part.trim()))].join(", ");
        if (!label || [...label].length > 160) continue;
        results.append(h("li", {}, h("button", {
          class: "sp-btn quiet", type: "button", text: label,
          onclick: () => commit({ label, latitude, longitude }),
        })));
      }
      feedback.textContent = results.childElementCount ? t("s.wx.pick") : t("s.wx.noResults");
    } catch {
      if (request === controller) feedback.textContent = t("s.wx.failed");
    } finally {
      window.clearTimeout(timeout);
      if (request === controller) request = null;
    }
  });

  return { el, paint };
}
