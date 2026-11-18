# Nerevar Hub — Frontend

One document for the whole browser side of `nerevar-hub-test`: how the panel
is built, how it looks, and how to extend it. Backend details are limited to
the endpoints the frontend calls.

---

## 1. Files and boot order

| File | Responsibility |
|---|---|
| `index.html` | markup for every window, all CSS, the WindowMaker skin block |
| `config.js` | `window.CONFIG` — every user-facing setting |
| `app.js` | all behaviour: windows, views, polling, terminal, layout |
| `openstep.html` | redirect to `index.html?skin=wm` |
| `dock.json` | dock icon map for the WindowMaker skin |

No build step, no framework, no modules. `app.js` is a classic script with
top-level declarations and one async boot IIFE at the end.

```
1. <head>   base <style>, then <style id="openstep-skin" media="not all">
            inline bootstrap script applies ?skin=/?wm= and the stored
            theme/skin/wmtheme/font before first paint
2. <body>   all windows exist in markup; most are hidden
3. config.js
4. app.js
5. boot:  layoutWindows(true) → focus services → fit ASCII
          startMonitor/startNet/startDl
          loadArt + initPicture for each viewer
          layoutWindows(true) again (content sizes are known now)
          loadSavedLayout + applySavedLayout
          termStart for each terminal, focus the active one
```

Rules: `config.js` must load before `app.js`; DOM lookups at the top of
`app.js` assume the node is already in the document; the pre-paint theme
script stays inline to avoid a light-theme flash.

---

## 2. Visual model

The page is a fixed desktop, not a document: `body{overflow:hidden}`,
`.scene` is the canvas, and every feature is a window.

```
menubar  File / View / Favorites
scene    .appwindow sections, absolutely positioned, overlapping
taskbar  one .task button per window + two-line clock
```

Window anatomy:

```
.appwindow              2px raised bevel, 3px padding, no radius
  .titlebar             drag handle, 30px, blue gradient
    .titleleft          .appicon + title
    .window-controls    .winbtn _ □ ×
  .winbody              2px inset well, scrolls internally
  .resize-grip          bottom-right diagonal ribs
```

State lives in the DOM, there is no window registry:

| State | Representation |
|---|---|
| closed/hidden | `hidden` attribute |
| position / size | inline `left` / `top` / `width` / `height` |
| stacking | inline `z-index` from `zCounter` |
| focus | `.active` on the window and its `.task` |
| maximised | `data-maximized="1"`, previous geometry in `data-prev*` |
| manually placed | `data-manual="1"` (auto-placement skips it) |

`focusWindow()` raises and activates exactly one window. `showWindow()` is
the only supported open/close path: it updates the task button, runs
placement, adjusts viewers and schedules a layout save.

Windows in the markup: `winServers`, `winArt`(+2…6), `winMonitor`,
`winMusic`, `winTerm`(+2…6), `winNetwork`, `winDownloads`, `winTelegram`.
Extra viewers and consoles are cloned from the existing markup according to
`CONFIG.viewers` and `CONFIG.term.count`.

---

## 3. Look and feel

Design target: the memory of Windows 9x / NeXTSTEP, not a pixel clone.
Physicality over polish — hard 2px bevels, offset shadows, no border radius,
springy motion.

Colour comes from CSS custom properties only:

```
:root                          light Win9x palette
html[data-theme=dark]          dark palette (default in config.js)
<style id="openstep-skin">     WindowMaker skin: shape + palettes
html[data-wmtheme=steel|dark]  WindowMaker colour schemes
```

Key roles: `--desktop`, `--gray` (window body), `--blue`/`--blue-2`
(title bar), `--text`, `--dim…`, `--surface` (inputs/gauges), `--card`,
`--active`, `--hover`, `--warn`, `--crit`, `--ok`, `--error`, `--muted`.
A new component must use a token, never a hex; a new token must be added to
both base themes and the skin reset.

Typography: `--ui-font` (default Tahoma/Verdana), 13px body, 12px menus,
10px uppercase filled section headers, monospace for numbers, gauges and the
terminal. There is one weight above regular: bold. No italics in chrome.

Geometry: borders 2px, window padding 3px, titlebar 30px, window control
22×20, taskbar 36px, gauge 17px, grip 16×16, minimum window 260×160.
Spacing values are 2/3/5/7/9/14 — no 8px grid.

Themes may change colour, font and chrome; they must not change layout
order or interaction. Anything that needs theme-specific code belongs in a
token.

---

## 4. Interaction

| Gesture | Behaviour |
|---|---|
| click in a window | focus: raise, activate titlebar and task button |
| drag titlebar | move, clamped so 40px stays visible |
| drag grip | resize within `min-width`/`min-height` |
| `_` | minimise: the window vanishes and its outline hops to the taskbar (§5) |
| `×` | hide instantly |
| `□` | maximise / restore |
| task button | focus; click the active one to minimise, click a minimised one to restore |
| View → Layout constructor… | choose open windows and visible service cards |

`pointerdown` on the titlebar writes the current geometry to inline styles,
then `pointermove` (on `window`) updates `left`/`top`; the same global
handlers serve the skinned player, which starts a drag from its canvas.

---

## 5. Minimise: stepping outline (Win9x/XP style)

The window itself never scales. On minimise it disappears at once and a
hollow dashed rectangle travels from its old rect to its taskbar button in
**discrete steps** — the "show window contents while dragging off" look.

```
from = rectOf(window)        // viewport coordinates
to   = rectOf(task button)
box  = fixed <div class="min-outline"> appended to <body>
place(t): left/top/width/height interpolated linearly
8 positions (7 jumps) × 40 ms (~0.28 s) → box removed → done
```

The window stays where it is for the whole flight and is hidden only in
the `done` callback; `.win-anim` (pointer-events:none) keeps it from
reacting to clicks meanwhile. Restore is the same path in reverse: the
window is shown with `visibility:hidden` so it already occupies its final
geometry, the outline grows out of the button, and the window becomes
visible on the last step.

Details:

* `.min-outline` is `position:fixed`, `z-index:900`, `pointer-events:none`,
  2 px dashed black with a 1 px white halo — readable on any desktop and
  able to leave the scene and cross the taskbar (the scene itself clips).
* Nothing is scaled or repainted during the flight; `left/top/width/height`
  and the layout saver are untouched, and the window disappears only after
  the outline lands.
* `data-animating` blocks a second minimise/restore from the taskbar during
  the ~0.28 s; `data-minimized` distinguishes a minimised window (animated
  restore) from a closed one (instant open, no outline).
* Close (`×`) stays instant and clears `data-minimized`.
* `prefers-reduced-motion: reduce` removes the outline entirely; the
  window simply shows/hides.
* Tempo is controlled by two constants next to the code: `MIN_STEPS` (8,
  including start and finish) and `MIN_STEP_MS` (40), not by `config.js`.

---

## 6. Layout persistence

Two layers:

1. **Automatic** — `layoutWindows()` packs visible windows without overlap on
   boot; `placeMonitor`, `placeTerm`, `placeExtra` find free spots.
2. **Saved** — the Layout constructor stores open/hidden state, geometry,
   maximised flags, hidden service cards, theme and font via
   `GET/POST/DELETE /api/layout`, mirrored in `localStorage`
   (`nerevar-hub.layout`). Geometry is stored as fractions of the scene, so
   another screen size gets the same arrangement.

`scheduleLayoutSave()` is a debounced writer guarded by `layoutReady` (boot
finished) and `layoutApplying` (a restore is in progress). Saving happens
only after user gestures; auto-placement is never persisted.
`CONFIG.rememberLayout = false` disables the mechanism; Reset returns to
`config.js` defaults.

Theme, skin, WindowMaker scheme and font are stored separately in
`localStorage` (`nerevar-hub.theme`, `.skin`, `.wmtheme`, `.font`) and also
travel inside the saved layout.

---

## 7. Terminal

Three registries in `app.js`:

| Registry | Role |
|---|---|
| `TERM_MAN` | `man` pages: `{n: name, s: synopsis, d: [lines]}` |
| `TERM_CMDS` | command name → implementation |
| `TERMS` | live instances: window, output, input, history, queue, game state |

One line flows through `termJob(t, () => termRun(line))` — a per-terminal
promise queue, so a command waiting on the network cannot eat input meant
for the next line and never writes into another window's output.

While a game is active, `termRun` routes input to `BJ` (blackjack),
`SL` (slots) or `VIZ` (spectrum); otherwise it looks up `TERM_CMDS`, prints
`command not found` for unknown names, and prints thrown errors as `term-err`.

Commands follow three rules: output is English, data is real (`fetch`, `df`,
`free`, `uname`, `uptime`, `ss` read `/api/stats` and `/proc`-backed
endpoints), and jokes never fabricate system state.

`batek` is the house joke: a normal registry entry that ignores its arguments
and prints one of a few fixed refusals. It has a `TERM_MAN` page, a line in
`help`, and is the template for adding a command:

1. implement it in `TERM_CMDS` and add a `help` line;
2. add `TERM_MAN` metadata (picked up by `man` automatically);
3. use `term-ok` / `term-err` / `term-hint` for semantics;
4. mention it in `README.md`.

All printers (`termPrint`, `termPrintHtml`, `termEcho`, `termClear`) accept
an optional output element; by default they print to the instance bound to
the current job.

---

## 8. Data windows and polling

| Window | Endpoint | Behaviour |
|---|---|---|
| System Monitor | `/api/stats` | CPU/RAM/Load gauges, Storage rows (75%/90% thresholds), RAID rows with `● ○ ×` disks and recovery bars |
| Picture Viewer | `/api/pics`, `/pics/…` | ASCII art and images, fitted without distortion, zoom per viewer |
| Audio Player | `/api/music`, `/music/…`, `/api/skins` | HTML5 audio, playlist, `.wsz` skins parsed in the browser |
| Network | `/api/network` | two live rates, one-minute graph, listening sockets |
| Download Manager | `/api/downloads` | job list, speed/ETA, cancel/remove |
| Telegram | `/tg/…` | lazily loaded frame around the server proxy |
| Font dialog | `/api/fonts` | installed families with previews and search |

Every polling window degrades explicitly: "N/A — host unreachable" with grey
gauges, never an empty state and never a thrown error in the console.

Player skins (`.wsz`/`.zip`) are a local layer: parsed in the browser, they
replace the player chrome only and never leave the machine.

---

## 9. Config contract

`config.js` is the only place for user data. `app.js` reads it once through
`applyConfig()`; later changes go through `localStorage`/layout and
re-rendering rather than mutating `CONFIG`.

* every field has a Russian comment in `config.js` and a row in README;
* optional blocks (`viz`, `slots`, `downloads`, `telegram`) must
  tolerate absence — the frontend supplies defaults;
* window ids referenced from config (`win: 'winNetwork'`) must match markup;
* `CONFIG.services`, `CONFIG.term.*` shapes are consumed directly — keep
  them stable.

---

## 10. Conventions

* Comments in `app.js` are Russian; all user-visible strings are English.
* `app.js` uses one space per indentation level and dense one-liners;
  CSS is one rule per line.
* Naming: `init*/start*` = boot, `place*/layout*` = positioning,
  `render*` = rebuild DOM, `term*` = console, `dl*` = downloads,
  `bj*`/`sl*` = games.
* No hardcoded hex in components, no colour-only state, no scrollable page.
* Changing `app.js` requires `node --check app.js`; `server.py` changes need
  `python3 -m py_compile server.py`.

---

## 11. Smoke checklist

Run `python3 server.py --port 8080`, open the panel, then:

* open, close, minimise and maximise each window;
* minimise a window with `_` — a stepping outline lands on its taskbar button;
* reload — the saved layout, theme, skin and font come back;
* toggle both base themes and all three WindowMaker schemes;
* run `fetch`, `man batek`, `batek`, `wget` a small file;
* load a `.wsz` skin and switch back;
* stop the server — every data window shows "N/A — host unreachable".
