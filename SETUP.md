# JARVIS — Setup Guide

Everything lives in this repo: the Next.js/Electron app, the God's Eye service,
and the helper scripts. What does **not** live here: your credentials (they are
per-machine by design) and the God's Eye Node runtime (gitignored).

## Prerequisites (laptop)

- **Node.js** — 20+ for the app. For the God's Eye service specifically: Node
  **24** (it enforces `>=24.14 <25 || >=26 <27`). Simplest: install Node 24 and
  use it for everything.
- **Git**
- **Python 3.12+** on PATH — used by the Windows notification history reader,
  the Screen Agent actuator, and the computer-use dev fallback
  (`pip install pyautogui` for the Screen Agent)

## Install

```powershell
git clone https://github.com/1dark30-alt/jarvis-new.git
cd jarvis-new
npm install
npm run dev
```

That starts the Next.js dev server on `127.0.0.1:3000` and launches Electron.

## First-run configuration (per machine, by design)

Open **Settings** in the app and enter:

- **Gemini API key** — powers the Gemini Live voice engine and the text ladder
  that missions/background agents run on. Without it, the brain falls back to
  the local model (configure that under the Local Model Service fields).
- Optional: OpenAI Realtime / ElevenLabs / local voice — all engines stay
  selectable; the active one is **Voice Engine** in Settings.
- Optional: Obsidian vault path (say *"set my obsidian vault to …"*), Bambu
  login, Home Assistant URL/token.

Credentials are stored in `jarvis-server-settings.json` (gitignored). To clone
your settings from another machine, copy that one file into the project root —
it carries everything including the Gemini key.

## God's Eye (optional, on demand)

The service lives in `services/gods-eye-view` and starts itself the first time
you open the God's Eye page — but its dependencies install once:

```powershell
cd services\gods-eye-view
npm install
```

If your system Node is not 24, give it the dedicated runtime:

```powershell
cd services\.runtime
curl -LO https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip
Expand-Archive node-v24.21.0-win-x64.zip
ren node-v24.21.0-win-x64 node-v24.21.0-win-x64 2>$null
```

(the folder must end up at `services\.runtime\node-v24.21.0-win-x64\node.exe`)

## Notes

- Memory, routines, missions and the Bounty Hunter league data are
  **per-machine** (they live in `%LOCALAPPDATA%\Jarvis` and browser
  localStorage) — a fresh laptop starts fresh.
- The Screen Agent and notification history need Windows; other OSes degrade
  gracefully.
- `npm run build` + `electron-builder` produce a packaged app if you want an
  installed version rather than `npm run dev`.
