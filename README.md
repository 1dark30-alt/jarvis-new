# Jarvis V5 — editable recovery

This folder is an editable recovery of the installed Jarvis 1.1.0 app. The installed copy at `C:\Program Files\Jarvis` has not been changed.

## Run it

1. Install Node.js (the project uses Next.js 16 and Electron 36) and Git LFS.
2. Clone the repository with Git LFS enabled, then run `npm install` from this folder.
3. Run `npm run dev` to start the Next.js app and open its Electron desktop window.
4. To run the web UI only, use `npm run build` followed by `npm start`.

The recovered package metadata and core configuration were restored from the installed build. The React/Next application in `app/` and assets in `public/` are the original bundled files. Electron's original TypeScript sources were not shipped in the installer; `dist-electron/*.js` are the actual editable Electron runtime (formatted from the compiled JavaScript). Their original source maps and formatted snapshots are kept beside them for reference.

## Local LLM chat

Open **Settings → Jarvis → Local Model Service** and choose Ollama or Olares Router, then open **Local Chat**. For Ollama, Jarvis reads locally installed model names and filters out Ollama cloud models. For Olares, copy the **Devices in LAN** Base URL from Router, create a Router API key, and enter both in Settings; select `default-chat` or a listed local Olares model. Jarvis sends requests to Olares Router's OpenAI-compatible API. On the same LAN, use the HTTPS Devices in LAN URL or the HTTP `.olares.local` URL provided by LarePass host mappings. This adds local text chat; the existing OpenAI/ElevenLabs voice engines remain separate.

Large 3D model assets under `public/models/` are stored with Git LFS. The local `jarvis-server-settings.json` file contains private credentials and is intentionally ignored by Git.

The original packaging scripts and signing/build pipeline were not included, so this recovery is set up for editing and local development; it does not reproduce the vendor's installer pipeline. Python support scripts and models are under `scripts/`.
