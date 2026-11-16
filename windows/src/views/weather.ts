import { h, svg } from "./dom";
import type { WeatherLocation } from "../core/state";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 60_000;
const conditions = new Map<number, string>([
  [0, "Despejado"], [1, "Mayormente despejado"], [2, "Parcialmente nublado"], [3, "Cubierto"],
  [45, "Niebla"], [48, "Niebla helada"], [51, "Llovizna"], [53, "Llovizna"], [55, "Llovizna intensa"],
  [56, "Llovizna helada"], [57, "Llovizna helada"], [61, "Lluvia ligera"], [63, "Lluvia"],
  [65, "Lluvia intensa"], [66, "Lluvia helada"], [67, "Lluvia helada"], [71, "Nevada ligera"],
  [73, "Nevada"], [75, "Nevada intensa"], [77, "Granos de nieve"], [80, "Chubascos"],
  [81, "Chubascos"], [82, "Chubascos intensos"], [85, "Chubascos de nieve"], [86, "Chubascos de nieve"],
  [95, "Tormenta eléctrica"], [96, "Tormenta con granizo"], [99, "Tormenta con granizo"],
]);
const degrees = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
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
      el.title = status.textContent = next ? `${next.label} · Cargando clima…` : "";
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
      if (!response.ok) throw new Error("No se pudo consultar el clima");
      const data = await response.json();
      const current = data?.current;
      if (!Number.isFinite(current?.temperature_2m) || !Number.isInteger(current?.weather_code)) {
        throw new Error("La respuesta del clima está incompleta");
      }
      if (request !== controller) return;
      const code = current.weather_code;
      const shape = code <= 1 ? (current.is_day === 0 ? icons.moon : icons.sun) : code >= 51 ? icons.rain : icons.cloud;
      value.textContent = `${degrees.format(current.temperature_2m)} °C`;
      lastWeather = `${next.label} · ${value.textContent} · ${conditions.get(code) ?? "Estado desconocido"}`;
      icon.replaceChildren(svg(shape, 14, { stroke: 1.75 }));
      el.title = status.textContent = lastWeather;
      nextFetch = Date.now() + REFRESH_MS;
    } catch {
      if (request !== controller) return;
      el.title = status.textContent = lastWeather ? `${lastWeather} (sin actualizar)` : `${next.label} · Clima no disponible`;
      nextFetch = Date.now() + RETRY_MS;
    } finally {
      window.clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }

  return { el, sync };
}
