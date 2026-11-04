"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const os_1 = require("os");
const wake_word_1 = require("./wake-word");
const touch_input_1 = require("./touch-input");
const social_views_1 = require("./social-views");
const isDev = !electron_1.app.isPackaged;
const PORT = 3000;
const HTTPS_PORT = 3443;
// Global safety net: ECONNRESET / EPIPE are harmless connection-level errors
// that happen when a phone/tablet disconnects mid-request (iOS tab kill, screen
// lock, navigation). Without this handler they surface as an uncaught exception
// and crash the entire Electron main process, which restarts the app and reloads
// every connected client. We swallow them here; all other errors are re-thrown.
process.on('uncaughtException', (err) => {
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        console.warn('[jarvis] Swallowed uncaught', err.code, '— client disconnected mid-request.');
        return;
    }
    throw err;
});
process.on('unhandledRejection', (reason) => {
    const code = reason?.code;
    if (code === 'ECONNRESET' || code === 'EPIPE') {
        console.warn('[jarvis] Swallowed unhandledRejection', code);
        return;
    }
    console.error('[jarvis] Unhandled rejection:', reason);
});
/** Lets the Next.js UI load local PDFs from absolute paths inside an iframe. */
electron_1.protocol.registerSchemesAsPrivileged([
    {
        scheme: 'jarvis-pdf',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
]);
function registerJarvisPdfProtocol() {
    electron_1.protocol.registerFileProtocol('jarvis-pdf', (request, callback) => {
        try {
            const marker = 'jarvis-pdf://';
            if (!request.url.startsWith(marker)) {
                callback({ error: -2 });
                return;
            }
            let encoded = request.url.slice(marker.length);
            while (encoded.startsWith('/'))
                encoded = encoded.slice(1);
            const filePath = path_1.default.normalize(decodeURIComponent(encoded));
            if (!filePath.toLowerCase().endsWith('.pdf')) {
                callback({ error: -6 });
                return;
            }
            if (!fs_1.default.existsSync(filePath)) {
                callback({ error: -6 });
                return;
            }
            callback({ path: filePath });
        }
        catch {
            callback({ error: -2 });
        }
    });
}
// Set Dock icon in dev mode (packaged builds use electron-builder.yml icon)
if (isDev && process.platform === 'darwin' && electron_1.app.dock) {
    electron_1.app.dock.setIcon(path_1.default.join(__dirname, '..', 'buildfiles', 'icon.png'));
}
let mainWindow = null;
let desktopVisualWindow = null;
let desktopHitboxWindow = null;
let nextServer = null;
let wakeWordService = null;
let touchInputService = null;
let socialViewsService = null;
// Set to true only after the Next.js server is confirmed ready and the first
// window has been created. Guards activate/reopen handlers from firing early.
let appReady = false;
let desktopModeEnabled = false;
let normalWindowBounds = null;
let desktopPanelPosition = 'bottom-right';
const DESKTOP_VISUAL_SIZE = 184;
const DESKTOP_PANEL_MARGIN = 24;
const DESKTOP_LOGO_HITBOX_SIZE = 104;
function getDesktopDisplay() {
    const existingWindow = desktopVisualWindow ?? desktopHitboxWindow;
    return existingWindow
        ? electron_1.screen.getDisplayMatching(existingWindow.getBounds())
        : electron_1.screen.getDisplayNearestPoint(electron_1.screen.getCursorScreenPoint());
}
function getVisualBounds(position) {
    const area = getDesktopDisplay().workArea;
    const x = position === 'top-left' || position === 'bottom-left'
        ? area.x + DESKTOP_PANEL_MARGIN
        : area.x + area.width - DESKTOP_VISUAL_SIZE - DESKTOP_PANEL_MARGIN;
    const y = position === 'top-left' || position === 'top-right'
        ? area.y + DESKTOP_PANEL_MARGIN
        : area.y + area.height - DESKTOP_VISUAL_SIZE - DESKTOP_PANEL_MARGIN;
    return { x, y, width: DESKTOP_VISUAL_SIZE, height: DESKTOP_VISUAL_SIZE };
}
function getHitboxBounds(position) {
    const visual = getVisualBounds(position);
    const offset = Math.round((DESKTOP_VISUAL_SIZE - DESKTOP_LOGO_HITBOX_SIZE) / 2);
    return {
        x: visual.x + offset,
        y: visual.y + offset,
        width: DESKTOP_LOGO_HITBOX_SIZE,
        height: DESKTOP_LOGO_HITBOX_SIZE,
    };
}
function createDesktopWindow(kind) {
    const win = new electron_1.BrowserWindow({
        ...(kind === 'visual'
            ? getVisualBounds(desktopPanelPosition)
            : getHitboxBounds(desktopPanelPosition)),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        title: kind === 'visual' ? 'Jarvis Desktop Visual' : 'Jarvis Desktop Hitbox',
        icon: path_1.default.join(__dirname, '..', 'buildfiles', 'icon.png'),
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
        },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    return win;
}
function getCircularHitboxRects() {
    const rects = [];
    const radius = DESKTOP_LOGO_HITBOX_SIZE / 2;
    const step = 4;
    for (let y = 0; y < DESKTOP_LOGO_HITBOX_SIZE; y += step) {
        const yFromCenter = y + step / 2 - radius;
        const halfWidth = Math.sqrt(Math.max(0, radius * radius - yFromCenter * yFromCenter));
        rects.push({
            x: Math.round(radius - halfWidth),
            y,
            width: Math.round(halfWidth * 2),
            height: step,
        });
    }
    return rects;
}
function applyDesktopHitbox(win) {
    if (process.platform !== 'darwin' && typeof win.setShape === 'function') {
        win.setShape(getCircularHitboxRects());
    }
    if (process.platform === 'darwin') {
        win.setIgnoreMouseEvents(true, { forward: true });
    }
}
function hitboxHtml(muted = false) {
    return encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: grid;
        place-items: center;
        user-select: none;
        -webkit-user-select: none;
      }
      button {
        width: ${DESKTOP_LOGO_HITBOX_SIZE}px;
        height: ${DESKTOP_LOGO_HITBOX_SIZE}px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <button id="hitbox" aria-label="${muted ? 'Unmute Jarvis' : 'Mute Jarvis'}"></button>
    <script>
      const button = document.getElementById('hitbox');
      let passthrough = true;
      const setPassthrough = (next) => {
        if (next === passthrough) return;
        passthrough = next;
        window.electron?.setDesktopPanelMousePassthrough?.(next);
      };
      if (navigator.platform.toLowerCase().includes('mac')) {
        window.electron?.setDesktopPanelMousePassthrough?.(true);
        window.addEventListener('mousemove', (event) => {
          const rect = button.getBoundingClientRect();
          const x = event.clientX - (rect.left + rect.width / 2);
          const y = event.clientY - (rect.top + rect.height / 2);
          setPassthrough(Math.hypot(x, y) > rect.width * 0.49);
        });
        window.addEventListener('mouseleave', () => setPassthrough(true));
      }
      button.addEventListener('click', () => window.electron?.overlayClick?.());
      window.electron?.onDesktopPanelMuted?.((muted) => {
        button.setAttribute('aria-label', muted ? 'Unmute Jarvis' : 'Mute Jarvis');
      });
    </script>
  </body>
</html>`);
}
function loadDesktopContent(logo, muted) {
    const params = new URLSearchParams({
        logo: logo ?? 'logo',
        muted: muted ? '1' : '0',
    });
    desktopVisualWindow?.loadURL(`http://127.0.0.1:${PORT}/desktop-overlay?${params.toString()}`);
    desktopHitboxWindow?.loadURL(`data:text/html;charset=utf-8,${hitboxHtml(muted)}`);
}
function createDesktopOverlay(logo, muted) {
    if (!desktopVisualWindow) {
        desktopVisualWindow = createDesktopWindow('visual');
        desktopVisualWindow.setIgnoreMouseEvents(true, { forward: true });
        desktopVisualWindow.on('closed', () => {
            desktopVisualWindow = null;
        });
    }
    if (!desktopHitboxWindow) {
        desktopHitboxWindow = createDesktopWindow('hitbox');
        applyDesktopHitbox(desktopHitboxWindow);
        desktopHitboxWindow.on('closed', () => {
            desktopHitboxWindow = null;
        });
    }
    loadDesktopContent(logo, muted);
    desktopVisualWindow.once('ready-to-show', () => {
        desktopVisualWindow?.showInactive();
    });
    desktopHitboxWindow.once('ready-to-show', () => {
        desktopHitboxWindow?.showInactive();
        desktopHitboxWindow?.moveTop();
    });
    return { visual: desktopVisualWindow, hitbox: desktopHitboxWindow };
}
function setDesktopOverlayBounds(position) {
    desktopVisualWindow?.setBounds(getVisualBounds(position));
    desktopHitboxWindow?.setBounds(getHitboxBounds(position));
    if (desktopHitboxWindow)
        applyDesktopHitbox(desktopHitboxWindow);
}
function animateWindowTo(win, to) {
    const from = win.getBounds();
    const startedAt = Date.now();
    const duration = 320;
    const timer = setInterval(() => {
        if (win.isDestroyed()) {
            clearInterval(timer);
            return;
        }
        const t = Math.min(1, (Date.now() - startedAt) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        win.setBounds({
            x: Math.round(from.x + (to.x - from.x) * eased),
            y: Math.round(from.y + (to.y - from.y) * eased),
            width: to.width,
            height: to.height,
        });
        if (t >= 1)
            clearInterval(timer);
    }, 16);
}
function animateDesktopOverlayTo(position) {
    desktopPanelPosition = position;
    if (desktopVisualWindow)
        animateWindowTo(desktopVisualWindow, getVisualBounds(position));
    if (desktopHitboxWindow)
        animateWindowTo(desktopHitboxWindow, getHitboxBounds(position));
}
function closeDesktopOverlay() {
    desktopVisualWindow?.close();
    desktopVisualWindow = null;
    desktopHitboxWindow?.close();
    desktopHitboxWindow = null;
}
function setDesktopMode(options) {
    if (!mainWindow)
        return { success: false, error: 'Main window is not ready.' };
    if (options.position)
        desktopPanelPosition = options.position;
    if (options.enabled) {
        if (!desktopModeEnabled) {
            normalWindowBounds = mainWindow.getBounds();
        }
        desktopModeEnabled = true;
        mainWindow.hide();
        const overlay = createDesktopOverlay(options.logo, options.muted);
        setDesktopOverlayBounds(desktopPanelPosition);
        overlay.visual.setAlwaysOnTop(true, 'screen-saver');
        overlay.hitbox.setAlwaysOnTop(true, 'screen-saver');
        overlay.visual.showInactive();
        overlay.hitbox.showInactive();
        overlay.hitbox.moveTop();
        return { success: true, enabled: true, position: desktopPanelPosition };
    }
    desktopModeEnabled = false;
    closeDesktopOverlay();
    if (normalWindowBounds) {
        mainWindow.setBounds(normalWindowBounds);
    }
    mainWindow.show();
    mainWindow.focus();
    return { success: true, enabled: false };
}
function setupDesktopModeIpc() {
    electron_1.ipcMain.handle('desktop-mode:set', (_event, options) => {
        return setDesktopMode(options);
    });
    electron_1.ipcMain.handle('desktop-mode:move', (_event, position) => {
        desktopPanelPosition = position;
        animateDesktopOverlayTo(position);
        return { success: true, position };
    });
    electron_1.ipcMain.on('desktop-mode:overlay-clicked', () => {
        mainWindow?.webContents.send('desktop-mode:overlay-click');
    });
    electron_1.ipcMain.on('desktop-mode:muted', (_event, muted) => {
        desktopVisualWindow?.webContents.send('desktop-mode:muted', muted);
        desktopHitboxWindow?.webContents.send('desktop-mode:muted', muted);
    });
    electron_1.ipcMain.on('desktop-mode:mouse-passthrough', (_event, passthrough) => {
        if (process.platform !== 'darwin')
            return;
        desktopHitboxWindow?.setIgnoreMouseEvents(passthrough, { forward: true });
    });
    electron_1.ipcMain.handle('get-audio-source-id', async () => {
        try {
            const sources = await electron_1.desktopCapturer.getSources({ types: ['screen'] });
            return sources[0]?.id ?? null;
        }
        catch {
            return null;
        }
    });
}
function waitForServer(retries = 40, delay = 500) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            const req = http_1.default.get(`http://127.0.0.1:${PORT}`, () => {
                req.destroy();
                resolve();
            });
            req.on('error', () => {
                if (n >= retries) {
                    reject(new Error(`Next.js server did not start after ${retries} attempts`));
                }
                else {
                    setTimeout(() => attempt(n + 1), delay);
                }
            });
            req.end();
        };
        attempt(0);
    });
}
function startNextServer() {
    return new Promise((resolve, reject) => {
        const appDir = path_1.default.join(process.resourcesPath, 'app');
        const serverPath = path_1.default.join(appDir, 'server.js');
        let settled = false;
        const fail = (err) => {
            if (settled)
                return;
            settled = true;
            try {
                nextServer?.kill();
            }
            catch {
                /* ignore */
            }
            reject(err);
        };
        // utilityProcess is flaky on some Windows installs; run Node via Electron's binary.
        nextServer = (0, child_process_1.spawn)(process.execPath, [serverPath], {
            cwd: appDir,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                PORT: String(PORT),
                HOSTNAME: '127.0.0.1',
                NODE_ENV: 'production',
                NEXT_MANUAL_SIG_HANDLE: 'true',
                // Per-user writable location for runtime secrets (Bambu token, server
                // settings). Without this the server writes them next to server.js —
                // i.e. inside the (shared, read-only, distributable) app bundle — which
                // leaks the packager's credentials to everyone who installs the app.
                JARVIS_DATA_DIR: electron_1.app.getPath('userData'),
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        nextServer.stdout?.on('data', (chunk) => {
            if (isDev)
                console.log('[next]', chunk.toString());
        });
        nextServer.stderr?.on('data', (chunk) => {
            console.error('[next]', chunk.toString());
        });
        nextServer.on('error', (err) => fail(err));
        nextServer.on('exit', (code) => {
            if (settled)
                return;
            const crashed = typeof code === 'number' ? code !== 0 : true;
            if (crashed) {
                fail(new Error(`Next.js server exited unexpectedly (code: ${String(code)}). If the app never loaded, check Windows Firewall / antivirus for localhost:${PORT} — or run the installer from a local folder (not a network drive).`));
            }
        });
        waitForServer()
            .then(() => {
            if (settled)
                return;
            settled = true;
            resolve();
        })
            .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });
}
async function requestMediaPermissions() {
    if (process.platform !== 'darwin')
        return;
    try {
        await electron_1.systemPreferences.askForMediaAccess('microphone');
        await electron_1.systemPreferences.askForMediaAccess('camera');
    }
    catch {
        // Permissions may already be granted or unavailable in sandbox
    }
}
function requestAccessibilityAndScreenRecording() {
    if (process.platform !== 'darwin')
        return;
    // Screen recording — triggers the system prompt the first time.
    // The app needs this for the computer-use screenshot feature (mss).
    const screenStatus = electron_1.systemPreferences.getMediaAccessStatus('screen');
    if (screenStatus !== 'granted') {
        // Open System Settings directly to the Screen Recording pane so the
        // user can add Jarvis without hunting through menus.
        electron_1.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    // Accessibility — needed by pyautogui for mouse/keyboard control.
    // isTrustedAccessibilityClient(true) shows the system prompt requesting trust.
    const trusted = electron_1.systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
        electron_1.systemPreferences.isTrustedAccessibilityClient(true);
        // Also open System Settings as a fallback in case the prompt is missed.
        electron_1.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
}
function getLanIp() {
    for (const ifaces of Object.values((0, os_1.networkInterfaces)())) {
        for (const iface of ifaces ?? []) {
            if (iface.family === 'IPv4' && !iface.internal)
                return iface.address;
        }
    }
    return null;
}
let httpsServer = null;
async function startHttpsProxy() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const selfsigned = require('selfsigned');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const httpProxy = require('http-proxy');
        const certPath = path_1.default.join(electron_1.app.getPath('userData'), 'jarvis-tls.json');
        let pems;
        // Reuse cached cert so browsers only need to accept it once
        if (fs_1.default.existsSync(certPath)) {
            pems = JSON.parse(fs_1.default.readFileSync(certPath, 'utf-8'));
        }
        else {
            const generated = await selfsigned.generate([{ name: 'commonName', value: 'jarvis.local' }], { days: 3650 });
            pems = generated;
            fs_1.default.writeFileSync(certPath, JSON.stringify(pems));
        }
        const proxy = httpProxy.createProxyServer({
            target: `http://127.0.0.1:${PORT}`,
            ws: true,
            changeOrigin: true,
        });
        // Swallow all proxy-level errors (ECONNRESET, ECONNREFUSED, etc.)
        proxy.on('error', (err, _req, res) => {
            const code = err.code ?? '';
            if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE')
                return;
            console.error('[jarvis] Proxy error:', err.message);
            // Try to send a 502 if the response is still writable
            try {
                if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
                    res.writeHead(502);
                    res.end();
                }
            }
            catch { /* already sent */ }
        });
        httpsServer = https_1.default.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
            proxy.web(req, res);
        });
        // Handle socket-level errors on every incoming TLS connection.
        // When a phone disconnects mid-request (iOS tab kill, screen lock, navigation)
        // the TLS socket throws ECONNRESET. Without this handler it reaches Node.js as
        // an uncaught exception and crashes the entire Electron main process.
        httpsServer.on('connection', (socket) => {
            socket.on('error', (err) => {
                if (err.code === 'ECONNRESET' || err.code === 'EPIPE')
                    return;
                console.error('[jarvis] HTTPS socket error:', err.message);
            });
        });
        httpsServer.on('upgrade', (req, socket, head) => {
            socket.on('error', (err) => {
                if (err.code === 'ECONNRESET' || err.code === 'EPIPE')
                    return;
                console.error('[jarvis] HTTPS upgrade socket error:', err.message);
            });
            // Intercept Next.js HMR WebSocket upgrades and silently accept them
            // without forwarding to the dev server. LAN clients (phones/tablets)
            // can't establish a real WSS connection over the self-signed cert, so
            // the HMR socket fails repeatedly → Next.js calls location.reload().
            // By completing the WebSocket handshake ourselves and keeping the socket
            // open-but-silent, Next.js thinks it's connected and stops retrying.
            // No HMR messages are ever sent, so no reloads ever fire.
            if (req.url && (req.url.includes('webpack-hmr') || req.url.includes('_next/webpack'))) {
                const key = req.headers['sec-websocket-key'];
                if (key) {
                    const accept = crypto_1.default
                        .createHash('sha1')
                        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                        .digest('base64');
                    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                        'Upgrade: websocket\r\n' +
                        'Connection: Upgrade\r\n' +
                        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
                    // Keep the socket alive but never send any HMR frames.
                    socket.on('data', () => { });
                }
                else {
                    socket.destroy();
                }
                return;
            }
            proxy.ws(req, socket, head);
        });
        httpsServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`[jarvis] HTTPS proxy already running on port ${HTTPS_PORT}, skipping.`);
            }
            else {
                console.error('[jarvis] HTTPS server error:', err.message);
            }
        });
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            const ip = getLanIp();
            if (ip)
                console.log(`[jarvis] LAN HTTPS: https://${ip}:${HTTPS_PORT}`);
        });
    }
    catch (err) {
        console.error('[jarvis] HTTPS proxy failed to start:', err);
    }
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'Jarvis',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#00000000',
        transparent: true,
        show: false,
        icon: path_1.default.join(__dirname, '..', 'buildfiles', 'icon.png'),
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
            // Social Media dashboard embeds Instagram/TikTok/Facebook/YouTube
            // in Chromium <webview> guests with persistent login partitions.
            webviewTag: true,
        },
    });
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        if (isDev) {
            mainWindow?.webContents.openDevTools();
        }
    });
    // Open external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        closeDesktopOverlay();
    });
}
function setupPermissions() {
    const isJarvisOrigin = (url) => url.startsWith('http://127.0.0.1') ||
        url.startsWith('http://localhost') ||
        url.startsWith('https://127.0.0.1') ||
        url.startsWith('https://localhost');
    electron_1.session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const url = webContents.getURL();
        if (isJarvisOrigin(url) &&
            ['media', 'microphone', 'camera', 'display-capture', 'speechRecognition', 'speech'].includes(permission)) {
            callback(true);
            return;
        }
        callback(false);
    });
    electron_1.session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        if (!webContents)
            return false;
        const url = webContents.getURL();
        if (isJarvisOrigin(url) && ['media', 'microphone', 'camera', 'speechRecognition', 'speech'].includes(permission)) {
            return true;
        }
        return false;
    });
}
electron_1.app.whenReady().then(async () => {
    // Default BrowserWindow title is "Electron"; menu / Dock name in dev follows the binary unless set here.
    electron_1.app.setName('Jarvis');
    registerJarvisPdfProtocol();
    setupPermissions();
    setupDesktopModeIpc();
    await requestMediaPermissions();
    requestAccessibilityAndScreenRecording();
    if (isDev) {
        createWindow();
        startHttpsProxy();
    }
    else {
        try {
            await startNextServer();
            startHttpsProxy();
            createWindow();
        }
        catch (err) {
            console.error('Failed to start Next.js server:', err);
            const message = err instanceof Error
                ? err.message
                : typeof err === 'string'
                    ? err
                    : JSON.stringify(err);
            electron_1.dialog.showMessageBoxSync({
                type: 'error',
                title: 'Jarvis — could not start',
                message: 'The local web server did not start, so Jarvis cannot load its interface.',
                detail: message,
            });
            electron_1.app.quit();
            return;
        }
    }
    appReady = true;
    wakeWordService = new wake_word_1.WakeWordService();
    wakeWordService.setCallbacks(() => {
        console.log('[WakeWord] Jarvis detected!');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hey-jarvis:detected');
        }
        if (desktopModeEnabled) {
            mainWindow?.show();
            mainWindow?.focus();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hey-jarvis:status', {
                enabled: wakeWordService.enabled,
                listening: wakeWordService.listening,
            });
        }
    }, (error) => {
        console.error('[WakeWord] Error:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hey-jarvis:error', error);
        }
    });
    // Wake word will be started by the renderer via IPC when settings load
    electron_1.ipcMain.on('hey-jarvis:set-enabled', (_event, enabled) => {
        if (enabled) {
            wakeWordService.start();
        }
        else {
            wakeWordService.stop();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hey-jarvis:status', {
                enabled: wakeWordService.enabled,
                listening: wakeWordService.listening,
            });
        }
    });
    electron_1.ipcMain.on('hey-jarvis:set-sensitivity', (_event, sensitivity) => {
        wakeWordService.setSensitivity(sensitivity);
    });
    electron_1.ipcMain.on('hey-jarvis:mic-in-use', (_event, inUse) => {
        wakeWordService.setMicInUse(inUse);
    });
    // USB touch-screen (ILITEK IR film) — reads raw HID touch reports and
    // replays them into the window as clicks/drags. Idle when not plugged in.
    touchInputService = new touch_input_1.TouchInputService(() => mainWindow, (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('touch-input:status', status);
        }
    });
    touchInputService.start();
    electron_1.ipcMain.handle('touch-input:get-status', () => touchInputService?.status ?? { connected: false });
    // Transparent windows blank out guest views on macOS. Social Command flips
    // the main window opaque while open so the four WebContentsViews can paint.
    electron_1.ipcMain.handle('window:set-opaque', (_event, opaque) => {
        if (!mainWindow || mainWindow.isDestroyed())
            return { success: false };
        try {
            mainWindow.setBackgroundColor(opaque ? '#020814' : '#00000000');
            return { success: true, opaque: !!opaque };
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'failed' };
        }
    });
    // Social Command — four WebContentsView browser panes over the main UI
    socialViewsService = new social_views_1.SocialViewsService(() => mainWindow);
    electron_1.ipcMain.handle('social:start', () => socialViewsService.start());
    electron_1.ipcMain.handle('social:stop', () => socialViewsService.stop());
    electron_1.ipcMain.handle('social:set-bounds', (_e, all) => socialViewsService.setAllBounds(all ?? {}));
    electron_1.ipcMain.handle('social:navigate', (_e, id, url) => socialViewsService.navigate(id, url));
    electron_1.ipcMain.handle('social:navigate-all', (_e, url) => socialViewsService.navigateAll(url));
    electron_1.ipcMain.handle('social:reload', (_e, id) => socialViewsService.reload(id));
    electron_1.ipcMain.handle('social:home', (_e, id) => socialViewsService.goHome(id));
    electron_1.ipcMain.handle('social:get-url', (_e, id) => socialViewsService.getUrl(id));
    electron_1.ipcMain.handle('social:capture-html', (_e, id) => socialViewsService.captureHtml(id));
    electron_1.ipcMain.handle('social:exec', (_e, id, code) => socialViewsService.executeJavaScript(id, code));
    electron_1.ipcMain.handle('social:post-reply', (_e, id, author, commentText, reply, options) => socialViewsService.postReply(id, author, commentText, reply, options));
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        nextServer?.kill();
        electron_1.app.quit();
    }
});
// On macOS, clicking the dock icon re-opens the window. Only allowed once
// the full startup sequence (server + first window) has completed.
electron_1.app.on('activate', () => {
    if (!appReady)
        return;
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
electron_1.app.on('before-quit', () => {
    socialViewsService?.stop();
    wakeWordService?.stop();
    touchInputService?.stop();
    nextServer?.kill();
    httpsServer?.close();
});
