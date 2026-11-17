import { h, svg } from "./dom";
import { formatNumber, t, type Key } from "../core/i18n";
import type { WeatherLocation } from "../core/state";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000;
const conditions = new Map<number, Key>([
  [0, "wx.clear"], [1, "wx.mostlyClear"], [2, "wx.partly"], [3, "wx.overcast"],
  [45, "wx.fog"], [48, "wx.rimeFog"], [51, "wx.drizzle"], [53, "wx.drizzle"], [55, "wx.drizzleHeavy"],
  [56, "wx.freezingDrizzle"], [57, "wx.freezingDrizzle"], [61, "wx.rainLight"], [63, "wx.rain"],
  [65, "wx.rainHeavy"], [66, "wx.freezingRain"], [67, "wx.freezingRain"], [71, "wx.snowLight"],
  [73, "wx.snow"], [75, "wx.snowHeavy"], [77, "wx.snowGrains"], [80, "wx.showers"],
  [81, "wx.showers"], [82, "wx.showersHeavy"], [85, "wx.snowShowers"], [86, "wx.snowShowers"],
  [95, "wx.thunder"], [96, "wx.hail"], [99, "wx.hail"],
]);
const cloud = "M6 18a4 4 0 1 1 1.1-7.85A5.5 5.5 0 0 1 18 11a3.5 3.5 0 0 1 .5 7Z";
const icons = {
  cloud,
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.9 13.3A9 9 0 1 1 10.7 3.1a7 7 0 0 0 10.2 10.2Z",
  rain: "M6 15a4 4 0 1 1 1.1-7.85A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 .5 7M8 17l-1 3m5-3-1 3m5-3-1 3",
};

export function buildWeather() {
  const icon = h("span", { class: "weather-icon", "aria-hidden": "true" }, svg(cloud, 14, { stroke: 1.75 }));
  const value = h("span", { class: "weather-value", "aria-hidden": "true", text: "—" });
  const status = h("span", { class: "weather-status", role: "status" });
  const el = h("div", { class: "weather", hidden: true }, icon, value, status);
  let location: WeatherLocation | null = null;
  let request: AbortController | null = null;
  let nextFetch = 0;
  let lastWeather: string | null = null;

  async function sync(next: WeatherLocation | null, expanded: boolean) {
    if (location?.label !== next?.label || location?.latitude !== next?.latitude || location?.longitude !== next?.longitude) {
      request?.abort();
      request = null;
      location = next;
      nextFetch = 0;
      lastWeather = null;
      value.textContent = "—";
      icon.replaceChildren(svg(cloud, 14, { stroke: 1.75 }));
      el.title = status.textContent = next ? `${next.label} · ${t("wx.loading")}` : "";
    }
    el.hidden = !next;
    if (!next || !expanded || request || Date.now() < nextFetch) return;

    const controller = new AbortController();
    request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    const url = new URL(FORECAST);
    url.search = new URLSearchParams({
      latitude: String(next.latitude),
      longitude: String(next.longitude),
      current: "temperature_2m,weather_code,is_day",
      temperature_unit: "celsius",
    }).toString();
    try {
      const response = await fetch(url, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error("weather request failed");
      const data = await response.json();
      const current = data?.current;
      if (!Number.isFinite(current?.temperature_2m) || !Number.isInteger(current?.weather_code)) {
        throw new Error("weather response incomplete");
      }
      if (request !== controller) return;
      const code = current.weather_code;
      const shape = code <= 1 ? (current.is_day === 0 ? icons.moon : icons.sun) : code >= 51 ? icons.rain : icons.cloud;
      value.textContent = `${formatNumber(current.temperature_2m, { maximumFractionDigits: 0 })} °C`;
      const said = conditions.get(code);
      lastWeather = `${next.label} · ${value.textContent} · ${said ? t(said) : t("wx.unknown")}`;
      icon.replaceChildren(svg(shape, 14, { stroke: 1.75 }));
      el.title = status.textContent = lastWeather;
      nextFetch = Date.now() + REFRESH_MS;
    } catch {
      if (request !== controller) return;
      el.title = status.textContent = lastWeather ? `${lastWeather} ${t("wx.stale")}` : `${next.label} · ${t("wx.unavailable")}`;
      nextFetch = Date.now() + RETRY_MS;
    } finally {
      window.clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }

  return { el, sync };
}
