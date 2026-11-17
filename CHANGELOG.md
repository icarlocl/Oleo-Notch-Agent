# Changelog

## 0.2.3

A redesign of the island, Settings and the agents list, on one scale: five
type sizes, three greys for text and four corner radii, in both themes and in
English, Spanish and Portuguese.

- Home puts what needs you first: the card of the request with its buttons,
  and the other sessions in a row under it. When all is calm it is Durazno, one
  line that sums it up and the chips. The usage limits stay in the header.
  Allow and Deny appear on Home only for a plain command of the session in
  front; an edit, a question or a request of another session opens the session
  with Review or Answer, and a click right after a request appears is ignored.
- Permission and question cards continue the Home card: who is asking is said
  in words, the first six lines of an edit are shown whole with "See all N
  changes", and a question's options are a list with what each one does.
- A session is one column: a row of sessions, a header with the title, state,
  model and files, filters by kind of step and the journal. Subagents launched
  together are one block of the journal, with a line each, and the time is said
  once per block. Left and Right no longer fold subagents: there is no tree.
- The Widgets tab is a mosaic. What has something going on is a card, up to
  three side by side; every other widget is a shortcut under them. The order in
  Settings decides who goes first. The mirror and the projects are shortcuts
  only.
- Settings: Widgets in two columns with the names whole; Settings → About puts
  each path on a line of its own with an "Open folder" button; the preview in
  Island follows "Folded island" (the line, in the colour you chose, or the
  capsule); shortcut keys are named in your language ("Espacio", "Espaço") and
  a shortcut that works says nothing, while a refusal or a clash says why; the
  sidebar has one mark of selection.
- The agents list, when empty, says so with Durazno and tells you when agents
  will show up there.
- The folded island can be one line near the edge that turns amber when a
  session needs you. A language setting (follow the system, English, Spanish
  or Portuguese) covers the island, Settings, the agents list and the tray.

## 0.2.2

- Codex's sessions in the island, with Allow / Deny for what Codex asks
  permission for. Hooks installed from Settings into `~/.codex/hooks.json`
  with a diff, a dated backup and a click; Codex runs them once they are
  trusted with `/hooks`. "Show Codex sessions" in Settings.
- Reply to a session from the island once its turn is over: a line to type in
  on the finished card and under the session panel's journal, for Claude Code
  and Codex. Oleo types the reply into the terminal the session runs in and
  sends it, so the conversation carries on there; for the Claude Code panel of
  VS Code or Cursor it opens the session with the reply in its prompt, for you
  to send. The box is there only while that window can be found. When Oleo
  cannot be sure of the place — another tab is showing, the terminal runs as
  administrator — the reply is not sent anywhere, and what you typed stays in
  the box with the reason.
- An update check you switch on yourself: Settings → About has "Check for
  updates every day" (off by default) and "Check now". When a newer version
  is out, Settings and the island's header say so and open its download.
  It is the only time Oleo uses the internet, and it sends nothing about you.
- Settings → Connect is grouped by tool — Claude Code, Cursor, Codex — each
  with its mark.
- The usage limits no longer disappear or go back to older numbers when
  several Claude Code sessions are open: each window keeps its newest report.
- A line of Oleo's log no longer shows two timestamps when two things are
  logged in the same second.

## 0.2.1

- The uninstaller and the installer pages now use the Oleo icon and artwork: the
  uninstall window, its header logo and the welcome and finish pages no longer
  show the default installer art (in 0.2.0 only the installer file's own icon
  was Oleo's).
- The install guide shows the release page with the installer and
  `SHA256SUMS.txt`.
- The open island no longer hides on its own when you click outside it.
  Opened with a shortcut, it now folds to the compact island, which then
  follows "Hide the compact island after". "Hide during full-screen apps" no
  longer mistakes the Start menu, Search, the notification centre, Alt+Tab,
  the lock screen or the moment of switching windows for a full-screen app.

## 0.2.0

- Cursor's agent sessions in the island, next to Claude Code's, for their
  status only (no approvals). Hooks installed from Settings into
  `~/.cursor/hooks.json` with a diff, a dated backup and a click.
- Every session shows which tool it belongs to: a mark (Claude Code's sparkle,
  Cursor's cube) in the session list, the home view, the cards and the folded
  island, and an All / Claude Code / Cursor filter.
- "Show Cursor sessions" in Settings.
- Dock the island to the top, bottom, left or right of the screen. On the
  sides, Home, the Shelf and the compact island stand upright. It sits inside
  the work area, above the taskbar.
- An optional agents list window: one row per project with its status, elapsed
  time and context size. It stays on top and on every virtual desktop, can be
  resized, fades when idle, and a click goes to that session. Rows carry the
  Claude Code or Cursor mark.
- A global shortcut (Ctrl+Alt+N) and a tray item to hide and show the island.
  While it is hidden, it pops up for a request and hides again.
- A context meter for each session, green, amber or red, read from the Claude
  Code transcript. Cursor sessions show none.
- Reading protection: an agent that finishes no longer takes over what you are
  reading. The jump-to-end button, or the agent's row in the sidebar, wiggles
  instead. Permission requests and questions still appear at once.
- The expanded session view stays at the end of the conversation, and a small
  jump-to-end button appears when you scroll up.
- Settings reorganised into eight plain pages with coloured icons, a search and
  a reset for each section. Writing the Claude Code hooks is unchanged: a diff
  preview, a dated backup and an explicit click.
- The installer uses the Oleo icon.
- Fixed: the island no longer ends up shifted after it is hidden and shown
  again.
## 0.1.0

First release of Oleo, a fork of Coucou for Windows.

- An island at the top of the screen that folds to a thin pill, opens on hover
  or when a session needs you, and rests between beats.
- Claude Code sessions on one page, with their state, last message and
  subagents, and a button that goes to the window each one runs in.
- Permission requests and questions answered from the island, with a real diff
  for edits. No approval without a click; if nobody answers, Claude Code asks
  in the terminal.
- A relay (`oleo-hook`) that Claude Code runs on each hook event. It never
  blocks Claude Code, checks it is talking to Oleo (same user, `oleo.exe`, no
  lower integrity level) and talks only over a named pipe that only the current
  user can open.
- Hooks installed and removed from Settings with a diff preview, a dated backup
  and a click.
- Claude usage limits and CPU, GPU and RAM in the header.
- Gullu, Oleo's own buddy, with reactions to the pointer and to status.
- The Shelf: To-do, Timer, Reminders, Media, Mirror and Projects widgets.
- Three configurable global shortcuts, auto-hide in full-screen apps, and
  paging by swipe.
- No telemetry and no network calls.
- Own sounds, synthesized from plain tones; none of Coucou's art or sounds.
- Builds for Linux from the same code.
