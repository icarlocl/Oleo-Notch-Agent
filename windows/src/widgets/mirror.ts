// Mirror: the camera, as a mirror. Small: a button, "Turn camera on", and
// nothing else — there is no camera here, ever. Expanded: a large rounded
// preview, mirrored, with no audio.
//
// The camera runs only while Mirror is expanded. It is stopped — every track
// stopped, the video emptied — the moment Mirror closes, the Shelf is left, the
// island folds or hides, or a card that asks something takes over (the Shelf
// tells every widget `stop`). It does not come back by itself: it is turned on
// again by a press. Nothing is recorded, nothing is saved, no frame is read.

import { t, type Key } from "../core/i18n";
import { h } from "../views/dom";
import { camera, resetCamera, startCamera, stopCamera } from "./camera";
import { notifyShelf } from "./core";
import { frame, mark, mini, shared, type Widget, type WidgetContext } from "./ui";

/** The Mirror's one video element. */
const video = h("video", { class: "mirror-video", muted: true, playsinline: true, "aria-label": () => t("w.cam.preview") });
video.muted = true;

camera.onChange = () => notifyShelf();
// The page is hidden or closed: whatever the island holds, the camera is let go.
window.addEventListener("pagehide", () => stopCamera(video, "the page was closed"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera(video, "the page was hidden");
});

const MESSAGES: Record<string, [Key, Key]> = {
  denied: ["w.cam.denied", "w.cam.deniedHow"],
  missing: ["w.cam.missing", "w.cam.missingHow"],
  busy: ["w.cam.busy", "w.cam.busyHow"],
  error: ["w.cam.error", "w.cam.errorHow"],
};

export function buildMirror(ctx: WidgetContext): Widget {
  // Small: one button. It expands Mirror and starts the camera there.
  const sNote = h("div", { class: "wmini-note", text: () => t("w.cam.smallNote") });
  const sStart = shared(h("button", { class: "btn secondary wmini-btn", text: () => t("w.cam.turnOn"), onclick: () => ctx.expand("mirror", { camera: true }) }), "mirror-start");
  const small = mini("mirror", h("div", { class: "wbody-mirror" }, sNote, sStart));

  // Expanded: the large preview.
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  const start = shared(h("button", { class: "btn primary", onclick: () => {
    resetCamera();
    void startCamera(video);
  } }), "mirror-start");
  const placeholder = h("div", { class: "mirror-ph" }, h("span", { class: "mirror-ph-mark" }, mark("mirror", 30)), title, sub, start);

  const body = h("div", { class: "mirror" }, video, placeholder);
  const card = frame("mirror", body, ctx.back);
  card.classList.add("bare");

  function paint() {
    const s = camera.state;
    body.classList.toggle("live", s === "on");
    start.style.display = s === "starting" || s === "on" ? "none" : "";
    switch (s) {
      case "on":
        break;
      case "starting":
        title.textContent = t("w.cam.waiting");
        sub.textContent = camera.slow
          ? t("w.cam.slow")
          : t("w.cam.asking");
        break;
      case "off":
        title.textContent = t("w.cam.off");
        sub.textContent = t("w.cam.offSub");
        start.textContent = t("w.cam.turnOn");
        break;
      default: {
        const [heading, how] = MESSAGES[s] ?? MESSAGES.error;
        title.textContent = t(heading);
        sub.textContent = t(how);
        start.textContent = t("views.error.retry");
      }
    }
  }

  return {
    id: "mirror",
    small,
    card,
    paint,
    opened: (opts) => {
      resetCamera();
      if (opts.camera) void startCamera(video);
    },
    stop: (why) => stopCamera(video, why),
  };
}
