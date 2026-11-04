# Jarvis installed build: recovered files

This folder was recovered from the installed `C:\Program Files\Jarvis` build. The installed copy was left unchanged.

- `app/` contains the bundled Next.js/React TypeScript and CSS application source.
- `public/` contains its UI assets and 3D model library.
- `scripts/` contains Python source and wake-word model files. The packaged PyInstaller executables are not included.
- `dist-electron/*.js` are formatted, editable JavaScript runtime files extracted from `resources/app.asar`; the matching `*.readable.js` snapshots and source maps are retained for reference.
- `package.json` and the Next.js/PostCSS/TypeScript configuration were restored from the installed build metadata and generated standalone server configuration.

This is an editable local development project, not the original full development repository. The Electron source maps list original TypeScript filenames but have no embedded `sourcesContent`, so the original TypeScript for the main process, preload, wake-word, touch-input and social-view modules could not be recovered. Original packaging scripts and signing configuration were also omitted by the installer. See `README.md` for setup and development commands.
