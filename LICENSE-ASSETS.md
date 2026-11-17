# Oleo: name, character and artwork

Oleo is built on Nook's code, itself built on Coucou's (both MIT, see
[LICENSE](LICENSE) and [NOTICE](NOTICE)). None of Coucou's reserved assets are
in this repository: its name, the Mochi character, its app and menu bar icons,
its sounds and its images and videos belong to Louis Raillé and are not used
here. Nook's character, Gullu, and the icons drawn from it are not used either.

What Oleo ships as its own:

- **Durazno**, Oleo's mascot, designed by Franco Ruiz: the picture
  `windows/src/bot/mascots/durazno.png`, and its face, drawn live over it by
  `windows/src/bot/engine.ts`;
- **the app icons** in `windows/src-tauri/icons/`, drawn from Durazno by the
  engine (`windows/dev/icon-export.html`, written out by
  `windows/scripts/gen-icons.mjs`), and the website pictures
  `site/assets/img/durazno-*.png` made from them;
- **the installer artwork**, `windows/src-tauri/nsis/header.bmp` and
  `sidebar.bmp`, drawn from Durazno on a canvas by
  `windows/scripts/make-installer-art.mjs`.

From Nook, under its MIT licence:

- **the sounds** in `windows/sounds/`, synthesized from plain sine and triangle
  tones by `windows/scripts/make-sounds.mjs`; nothing in them is sampled;
- **the wallpapers** of the screenshot stage,
  `windows/dev/stage/wallpapers/oleo-dark.jpg` and `oleo-light.jpg`, drawn
  procedurally by the shader in `windows/dev/stage/wallpaper-gen/` and rendered
  by `windows/scripts/make-wallpaper.mjs`.

The interface icons come from Lucide and Simple Icons under their own licences
(see [NOTICE](NOTICE)).

Oleo's own artwork (Durazno, the app icons and the installer artwork) is
© 2026 Franco Ruiz and is released under this repository's MIT License, like the
code.

What the MIT License does not give is the use of the names "Oleo" and "Oleo
Notch Agent", or of Durazno as the brand of another product. A fork or a derived
product should have its own name and its own mascot, and must not suggest that
it is the original or that Oleo endorses it.

Oleo is not affiliated with or endorsed by Nook's or Coucou's authors, or by
Anthropic.
