# VideoHub V2

**A local review studio and render queue for videos that Claude Code writes as code.**
You ask Claude Code for a video; it builds the film as a web page that draws every frame in code. VideoHub plays that
film straight from its code — no render — so you can watch it, step through frames, draw on a frame and write what is
wrong. One click sends your notes to Claude, Claude fixes the code, the open preview reloads by itself, and only when
you are happy do you render — once, in a queue that keeps your PC usable, and later re-rendering only the seconds that
changed. It is for people who make explainers, shorts and animations with Claude Code and are tired of rendering a
whole film to check one fix.

> **VideoHub V2** continues [TensaikunYT/Videohub](https://github.com/TensaikunYT/Videohub) (MIT, © VideoHub contributors) as its own project:
> a native macOS version (Electron app, Finder/Trash/Notification Center, VideoToolbox), smooth playback for heavy films, Focus mode, a
> better Scan, a direct Claude connection (MCP) and an AI review for realism and physics. Windows keeps working.

> **Windows 10/11 and macOS.** This fork adds a native macOS port of the original Windows-only VideoHub: the same hub, review
> editor and queue, with Finder, the Trash, Notification Center, `launchd` and Apple's VideoToolbox encoder in place of
> Explorer, the Recycle Bin, toasts, the start-up registry key and NVENC/AMF/QSV. See [Mac](#mac-macos-12-or-newer) below.
> The Windows scripts (`SETUP.cmd`, `setup.ps1` …) are unchanged and still work.

![Live preview with a note on a frame](docs/screenshots/review-live-preview.png)

## Features
- **Projects** — every film in your watched folders with its videos, versions, notes and disk use; a live cover for
  films that have no video yet.
- **Live preview, no render** — plays a film from its page (`window.renderOut(t)`), frame-accurate, with its sound,
  scenes and narration on a timeline. Changing the code reloads the open preview in place.
- **Smooth playback** — a heavy film (3D, post effects) can need 100 ms or more per frame, so drawing it live crawls however
  fast the computer is. VideoHub times the film once; if it cannot draw at full speed it draws every frame once in the
  background (only while you are not using the preview, nearest the playhead first), keeps them as small pictures and plays
  from those at the screen's full speed. The pill says *saving 40%* then *smooth*; paused frames, notes and captures always
  use the film's own exact frame; a code change drops the pictures. The ⚡ Smooth button turns it off.
- **Review notes** — click or draw on any frame (or pick a frame range), type what is wrong. **Send to Claude** copies
  a short message; Claude reads the notes (time, frame, chunk, a close-up picture of your drawing) with `hub_notes`.
- **Auto scan** — no render, no tokens: checks a live film frame by frame (black, white and very dark frames, flicker,
  one-frame pops, freezing, hard cuts, the 3D engine's camera and character checks), its sound (silence in the middle,
  clipping, a level far too quiet or loud, a length that does not match the picture) and its scene list (gaps, overlaps).
  Findings are sorted into errors, warnings and info, you can ignore the ones that are on purpose, and the next scan says
  how many are fixed or new. **Fix all** makes one note per error and warning and copies the message for Claude: one paste.
- **Claude connection (MCP)** — no pasting: with the `videohub` MCP server connected, **Send to Claude** delivers the notes
  straight to a Claude that is waiting for them (`hub_wait_for_notes`); a line above the button says whether Claude is
  *waiting*, *connected* or *not connected*, and **Connect** registers the tools with one click (or shows the command to copy).
  Without a connection the button copies the message to paste, as before.
- **AI review (MCP)** — `hub_review` lets Claude review its own film before you see it: it plays the film in a hidden browser and
  checks for shaking, snapping, wobbling, swimming or morphing textures, lighting jumps, falls that look wrong and, when the film
  reports its objects (`window.VH_BODIES`), exact physics: objects passing through each other, sinking, hovering, wrong gravity,
  teleporting, jitter. It returns errors/warnings with times and fixes, a contact sheet and pictures of the worst moments for
  Claude to look at; `hub_frames` shows any moment; `hub_realism_guide` is the guide for real physics that still looks like a
  cartoon. The same checks run in the review page's Scan panel.
- **Check fixes** — a tour through the notes Claude marked fixed, with before/after; "Still there" sends one back.
- **Render queue** — one render at a time on the PC, waits for renders started elsewhere, progress and ETA, a
  render dialog with size/fps/workers/encoder, a copy to any folder, a Windows notification when it is done.
- **Partial re-render** — a film rendered in 2-second chunks re-renders only the chunks your notes touched, joins the
  film again and saves `film_vN.mp4` with the changed ranges; **Watch only the changes** plays just those.
- **Render protection** (optional agent) — see below.
- **Recent renders & outputs folder** — every finished render, newest first; each one also hard-linked into one
  outputs folder (a folder per day, no extra disk space).
- **Disk cleanup** — what can safely go (old chunks, silent copies, browser profiles, check frames, old versions) and
  why; always to the Recycle Bin or the archive, never deleted outright, always with your approval.
- **Sound** — mute/solo/levels per stem, remove the music, duck it under a range, add sounds from your library or
  disk on the timeline; renders use the rebuilt mix.
- **Thumbnail Studio** — sketch a thumbnail (posed mannequins, objects, text, camera/depth/light), send the brief to
  Claude, which makes the variants; annotate a variant, add the final text in code.
- **Claude tools (MCP)** — `hub_live`, `hub_notes`, `hub_note_update`, `hub_render`, `hub_job`, `hub_project`, `hub_workspace`,
  `hub_register_version`, `hub_cleanup`, `hub_thumb_*`; the same tools work from a shell (`node server/cli.js`).

![Projects](docs/screenshots/projects.png)

### Render protection and speed
Built into the VideoHub server (plain Node and Windows' own tools, no extra program), it keeps long renders from
freezing the PC:
- **CPU limit** — every render VideoHub starts runs on a share of the processor cores (default 90 %) and at low
  priority; Windows passes both on to the Chrome and ffmpeg processes the render starts. Presets *Full power /
  Balanced / Quiet*, or "full power for 1–8 h".
- **RAM slow mode** — when free RAM falls below a threshold, the newest render slows down to a few cores at the lowest
  priority instead of being killed (the oldest keeps going unless RAM is critical) and speeds up again when RAM frees.
- **Slow down / Normal speed / Stop** per render on the Renders page, or for all of them at once.
- **One render at a time**, and the queue waits while another session is rendering; the Renders page also lists
  programs holding a lot of RAM (it never closes anything).
- **Partial re-renders** of only the fixed chunks, and per-render workers / encoder and fps options.
- **Faster renders, same quality** — the film template reads frames straight from the canvas (lossless, no JPEG) and
  encodes on the graphics card when the PC has one (NVIDIA NVENC, AMD AMF, Intel Quick Sync; else x264). On the test PC
  the example film rendered ~1.3× faster. Settings → *Render speed*; details and measurements:
  [docs/RENDER-SPEED.md](docs/RENDER-SPEED.md).
All thresholds are sliders on the Renders page (the RAM range scales with your machine's memory). Without the agent
VideoHub works the same; renders just run unprotected.

![Renders](docs/screenshots/renders.png)

## Requirements
Windows 10/11 or macOS 12+ (Apple Silicon or Intel).
- Windows 10 or 11
- [Node.js 22+](https://nodejs.org) — `winget install -e --id OpenJS.NodeJS.LTS`
- ffmpeg on PATH — `winget install -e --id Gyan.FFmpeg`
  (setup checks both and tells you the exact command to paste if one is missing; then run SETUP.cmd again)
- Microsoft Edge (built in) or Google Chrome — renders drive it headless
- [Claude Code](https://claude.com/claude-code) — for the Claude side
- Optional: the .NET Framework 4 C# compiler (ships with Windows) for the render protection agent
- Optional: a graphics card with a video encoder (most NVIDIA, AMD and Intel ones) for faster renders

### Mac (macOS 12 or newer)
- [Node.js 22+](https://nodejs.org) and ffmpeg through [Homebrew](https://brew.sh): `brew install node ffmpeg`
- Google Chrome, Microsoft Edge, Brave or Chromium: `brew install --cask google-chrome`. Renders draw every frame in one of them invisibly; the VideoHub window itself is the Electron app, not a browser window
- [Claude Code](https://claude.com/claude-code), for the Claude side
- Nothing else: macOS' own VideoToolbox does the hardware video encoding (Apple Silicon and Intel Macs)

Install: `git clone https://github.com/caydenchapple/VideoHub-V2.git VideoHub`, then double-click **`SETUP.command`** (or run
`./setup.sh` in Terminal; the first time, right-click → Open if macOS asks about an unidentified developer). It asks the
same plain questions as the Windows setup, builds **VideoHub.app** in `~/Applications` (an Electron app: a native window around the hub with its own Dock icon;
Launchpad and Spotlight find it; a one-time ~150 MB Electron download) and can start VideoHub at login (a LaunchAgent). Every option is also a flag: `./setup.sh --yes --workspace ~/Movies/VideoHub --startup no`;
`./setup.sh --dry-run` prints every step and changes nothing. Open VideoHub from Launchpad/Spotlight, or with `OPEN.command` / `./open.sh`
(they open the app, or your browser when it is not built). Rebuild the app alone with `node scripts/build-mac-app.mjs`. The app finds the hub
through `Contents/Resources/app/hub.json`: do not move the VideoHub folder after setup (run setup again if you do). Update with `./update.sh` (or `git pull` + `./setup.sh`), uninstall with `./uninstall.sh` (`--dry-run` first).

What is different on a Mac:
- **Render protection** — renders run at low priority (`nice 10`, passed on to Chrome and ffmpeg); in RAM slow mode they
  move to the background class (`taskpolicy -b`). macOS has no processor-affinity API, so there is no "% of the cores"
  limit and the CPU sliders are hidden. Free RAM is counted the way Activity Monitor does (free + inactive + purgeable).
- **Render speed** — *Automatic* uses VideoToolbox (`h264_videotoolbox`, quality 70, about the same PSNR as x264 -crf 16
  on a test clip) and falls back to x264.
- **Focus** — on the Renders page, tick the programs (browsers, chat, music, anything big) to slow down while a render runs. They
  keep running in the background class (`taskpolicy -b`: lowest CPU, disk and network priority), nothing is closed, and they
  go back to normal speed when the render ends, when you switch it off or when VideoHub quits (also after a crash). *Slow them
  now* does it without a render; *Keep the Mac awake* holds off sleep while a render runs (`caffeinate`). Not available on Windows.
- **Cleanup** — deleted files go to the **Trash** through Finder (so *Put Back* works). The first time, macOS asks whether
  VideoHub may control Finder (System Settings → Privacy & Security → Automation).
- **Windows, folders, notifications** — the folder picker, "Open folder" (Finder), the "render finished" notification
  and the app window (Chrome `--app=`) use the native macOS ones. macOS may ask once for access to Documents / Desktop.
- **Files** — `~/Documents/VideoHub` is the default workspace; paths in settings and tools use `/`.

## Install
### The easy way: let Claude Code install it
1. Download the ZIP (or `git clone <this repository> VideoHub`) and unpack it anywhere you like.
2. Open that folder in [Claude Code](https://claude.com/claude-code) and say: **"Install VideoHub for me."**
3. Claude checks what your PC has, asks you a few plain questions in its own window (where your video work should
   live, whether to use the graphics card, whether to add the example film …), then runs the setup once with your
   answers and tells you what to do next. You approve each command it runs; you never type one yourself.
4. Open **VideoHub** from the Desktop shortcut and start a **new** Claude Code session so it sees the tools.

### By hand (3 steps)
1. `git clone <this repository> VideoHub` anywhere you like (or download the ZIP and unpack it).
2. Double-click **`SETUP.cmd`**. It checks the requirements, installs the packages, builds the agent, registers the
   `videohub` MCP server for Claude Code and installs the `videohub` skill, then asks a few plain questions — press
   Enter for the recommended answer:
   - **Where should your video work live?** One workspace folder (default `Documents\VideoHub`) with `films`,
     `outputs` (every finished render), `sounds`, `thumbnails` and `archive`, and a `README.txt` saying what each is.
   - Video folders it found on your Desktop / in Documents: watch them too? (default no; Settings can turn them on later)
   - Your graphics card can encode video: use it for renders? (default yes; only asked when it can)
   - Add the review-before-render rule to `~/.claude/CLAUDE.md`? · Desktop shortcut? · Start with Windows? (default no)
     · Add the example film?
   It ends with what to do next. Running it again keeps every answer and never moves or overwrites your folders or
   settings. `setup.ps1 -Yes` takes every recommended answer, each question also has a parameter (see the top of
   `setup.ps1`, e.g. `-Workspace D:\Videos\VideoHub`), and `setup.ps1 -DryRun` prints every step without changing
   anything.
3. Open **VideoHub** from the Desktop shortcut. Start a new Claude Code session so it sees the tools.

## Your first film
1. If setup added the example film, its card is on the Projects page. Otherwise the page shows **Welcome to
   VideoHub** with your workspace and films folder (`<workspace>\films`): click **▶ Add the example film**.
2. Click its card: it opens in the **live preview**. Press Space, step with ← →, click on the video to leave a note.
3. Press **🎬 Render** → *Full film*: the queue renders 5 two-second chunks and saves `hello-film_v1.mp4` with sound.
4. Leave a note on a frame, change `film.js` (e.g. a colour), then **🎬 Render** → *Only the fixed parts*: only the
   touched chunks are rendered again → `hello-film_v2.mp4`, and **Watch only the changes** plays them.
What a film folder must contain for each feature: [docs/PROJECT-CONTRACT.md](docs/PROJECT-CONTRACT.md). New films start
from [templates/new-film](templates/new-film).

## How working with Claude goes
1. **Ask** Claude Code for a video. It builds the film as code from the template (the `videohub` skill tells it how).
2. **Preview** — when it plays, Claude calls `hub_live`: VideoHub jumps to the film. Claude stops and waits; it does
   not render.
3. **Notes** — you watch, leave notes on frames, press **Send to Claude** and paste the message into the chat.
4. **Fix** — Claude reads them with `hub_notes`, fixes the code (your open preview updates by itself) and marks each
   note fixed with a one-line reply. Repeat 3–4 as often as you like.
5. **Render** — when you say so, Claude renders once through `hub_render` (or you press 🎬 Render). Later fixes
   re-render only the changed chunks. You check them with *Watch only the changes* and the *Check fixes* tour.
If the MCP tools are not loaded in a session, Claude uses `node <VideoHub>\server\cli.js <tool> "<json>"`.

## Optional integrations
| Feature | Needs | Without it |
|---|---|---|
| Ready-made sound effects | a 3D studio engine with `engine/audio/synth.js` (`studioDir` in Settings) | your own sound folder and files from disk |
| Scene editor / 2D layers in the preview | the page includes the hooks from `engine-hooks/` | those editors are hidden |
| Snipp export status | Snipp writing `.renders\*.json` in a watched folder | not shown |
Settings → *Optional parts on this computer* shows what was found.

## Security
VideoHub is a local tool. The server listens on **127.0.0.1 only** and refuses requests with a foreign Host, cross-site
requests from other web pages and writes with a foreign Origin. Its render queue can run shell commands for your
projects, so **never expose port 7788** (no port forwarding, no tunnels, no `0.0.0.0` proxies). It only serves files
inside your watched folders, the archive and its own folders.

## Uninstall
On a Mac run `./uninstall.sh` (`--dry-run` first); it removes the same things (MCP server, skill, rule block, the Desktop icon and the login item).
On Windows run `powershell -ExecutionPolicy Bypass -File uninstall.ps1` (`-DryRun` first to see what it would do). It stops this
install's server and agent, removes the MCP server, the skill and the rule block it added (only if they belong to this
install), the Desktop shortcut and the start-up entry. Your films, their notes, the outputs folder and this folder stay;
delete them yourself if you want.

## Troubleshooting
- **The page is blank** — open it in a browser and look at the console; a missing Node 22 or a broken update are the
  usual causes. Restart with the Desktop shortcut.
- **Claude does not see `hub_*` tools** — start a new Claude Code session; `claude mcp list` should show `videohub`.
  Run SETUP.cmd (SETUP.command on a Mac) again if not.
- **"This folder is not a project VideoHub knows"** — put the film inside a watched folder or add its parent folder
  in Settings → Watched folders.
- **"The live preview could not open"** — the page lacks `window.renderOut(t)` / `window.READY`; see
  PROJECT-CONTRACT.md. The message says what is missing.
- **Partial renders refused** — the render script is not chunked (family A) or the film length is unknown:
  `hub_project({set:{render:{env:{DUR:"…"}}}})`.
- **Renders fail at once** — ffmpeg or Edge/Chrome missing (Settings → Tools), or `puppeteer-core` missing for a
  film's render script (VideoHub ships one; run `npm install` in VideoHub's folder).
- **Port 7788 is taken** — set `"port"` in `data/config.json` (`data\config.json` on Windows).
- **Coming from an older (Turkish) build** — see [docs/MIGRATING.md](docs/MIGRATING.md).

## Development
`npm test` runs the suites; see [CLAUDE.md](CLAUDE.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License
[MIT](LICENSE) © 2026 VideoHub contributors.
