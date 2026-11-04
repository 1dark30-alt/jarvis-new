"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    platform: process.platform,
    onMenuAction: (callback) => {
        electron_1.ipcRenderer.on('menu-action', (_event, action) => callback(action));
        return () => electron_1.ipcRenderer.removeAllListeners('menu-action');
    },
    setDesktopMode: (options) => electron_1.ipcRenderer.invoke('desktop-mode:set', options),
    moveDesktopPanel: (position) => electron_1.ipcRenderer.invoke('desktop-mode:move', position),
    setDesktopPanelMuted: (muted) => electron_1.ipcRenderer.send('desktop-mode:muted', muted),
    setDesktopPanelMousePassthrough: (passthrough) => electron_1.ipcRenderer.send('desktop-mode:mouse-passthrough', passthrough),
    overlayClick: () => electron_1.ipcRenderer.send('desktop-mode:overlay-clicked'),
    getAudioSourceId: () => electron_1.ipcRenderer.invoke('get-audio-source-id'),
    onDesktopOverlayClick: (callback) => {
        electron_1.ipcRenderer.on('desktop-mode:overlay-click', callback);
        return () => electron_1.ipcRenderer.removeAllListeners('desktop-mode:overlay-click');
    },
    onDesktopPanelMuted: (callback) => {
        electron_1.ipcRenderer.on('desktop-mode:muted', (_event, muted) => callback(muted));
        return () => electron_1.ipcRenderer.removeAllListeners('desktop-mode:muted');
    },
    onHeyJarvis: (callback) => {
        electron_1.ipcRenderer.on('hey-jarvis:detected', callback);
        return () => electron_1.ipcRenderer.removeAllListeners('hey-jarvis:detected');
    },
    onHeyJarvisStatus: (callback) => {
        electron_1.ipcRenderer.on('hey-jarvis:status', (_event, status) => callback(status));
        return () => electron_1.ipcRenderer.removeAllListeners('hey-jarvis:status');
    },
    onHeyJarvisError: (callback) => {
        electron_1.ipcRenderer.on('hey-jarvis:error', (_event, error) => callback(error));
        return () => electron_1.ipcRenderer.removeAllListeners('hey-jarvis:error');
    },
    setWakeWordEnabled: (enabled) => {
        electron_1.ipcRenderer.send('hey-jarvis:set-enabled', enabled);
    },
    setWakeWordSensitivity: (sensitivity) => {
        electron_1.ipcRenderer.send('hey-jarvis:set-sensitivity', sensitivity);
    },
    setWakeWordMicInUse: (inUse) => {
        electron_1.ipcRenderer.send('hey-jarvis:mic-in-use', inUse);
    },
    getTouchInputStatus: () => electron_1.ipcRenderer.invoke('touch-input:get-status'),
    onTouchInputStatus: (callback) => {
        electron_1.ipcRenderer.on('touch-input:status', (_event, status) => callback(status));
        return () => electron_1.ipcRenderer.removeAllListeners('touch-input:status');
    },
    setWindowOpaque: (opaque) => electron_1.ipcRenderer.invoke('window:set-opaque', opaque),
    socialStart: () => electron_1.ipcRenderer.invoke('social:start'),
    socialStop: () => electron_1.ipcRenderer.invoke('social:stop'),
    socialSetBounds: (all) => electron_1.ipcRenderer.invoke('social:set-bounds', all),
    socialNavigate: (id, url) => electron_1.ipcRenderer.invoke('social:navigate', id, url),
    socialNavigateAll: (url) => electron_1.ipcRenderer.invoke('social:navigate-all', url),
    socialReload: (id) => electron_1.ipcRenderer.invoke('social:reload', id),
    socialHome: (id) => electron_1.ipcRenderer.invoke('social:home', id),
    socialGetUrl: (id) => electron_1.ipcRenderer.invoke('social:get-url', id),
    socialCaptureHtml: (id) => electron_1.ipcRenderer.invoke('social:capture-html', id),
    socialExec: (id, code) => electron_1.ipcRenderer.invoke('social:exec', id, code),
    socialPostReply: (id, author, commentText, reply, options) => electron_1.ipcRenderer.invoke('social:post-reply', id, author, commentText, reply, options),
});
