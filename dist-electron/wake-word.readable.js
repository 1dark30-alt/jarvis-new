"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WakeWordService = void 0;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * WakeWordService spawns a Python subprocess running openWakeWord and
 * communicates with it via stdin/stdout JSON messages.
 */
class WakeWordService {
    constructor() {
        this.process = null;
        this._enabled = false;
        this._listening = false;
        this.threshold = 0.5;
        this.onDetect = null;
        this.onError = null;
        this.buffer = '';
    }
    get enabled() {
        return this._enabled;
    }
    get listening() {
        return this._listening;
    }
    setCallbacks(onDetect, onError, onStatus) {
        this.onDetect = onDetect;
        this.onError = onError;
        this.onStatus = onStatus;
    }
    start() {
        this._enabled = true;
        this.spawnProcess();
    }
    stop() {
        this._enabled = false;
        this.killProcess();
    }
    setSensitivity(s) {
        this.threshold = Math.max(0, Math.min(1, s));
        this.sendCommand({ command: 'set_threshold', value: this.threshold });
    }
    /**
     * Informs the wake word process whether the microphone is in use by the
     * renderer (e.g. during a voice conversation). When in use, the Python
     * process releases the mic so there's no device conflict.
     */
    setMicInUse(inUse) {
        this.sendCommand({ command: 'set_mic_in_use', value: inUse });
    }
    // ── Private ──────────────────────────────────────────────────────────
    spawnProcess() {
        if (this.process)
            return;
        const runner = this.resolveRunner();
        if (!runner) {
            this._listening = false;
            this.onError?.('Wake word runner not found. Run `npm run build:python` or use the dev script.');
            return;
        }
        this.process = (0, child_process_1.spawn)(runner.cmd, runner.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });
        this._listening = true;
        // Handle stdout (JSON messages from Python)
        this.process.stdout?.on('data', (data) => {
            this.buffer += data.toString();
            this.processBuffer();
        });
        // Handle stderr (error logging)
        this.process.stderr?.on('data', (data) => {
            console.error('[WakeWord:stderr]', data.toString().trim());
        });
        // Handle process exit
        this.process.on('exit', (code, signal) => {
            console.log(`[WakeWord] Process exited (code=${code}, signal=${signal})`);
            this.process = null;
            this._listening = false;
            // Auto-restart if still enabled (e.g., crash recovery)
            if (this._enabled) {
                console.log('[WakeWord] Auto-restarting...');
                this.spawnProcess();
            }
        });
        // Handle process error
        this.process.on('error', (err) => {
            console.error('[WakeWord] Process error:', err);
            this.onError?.(`Wake word process error: ${err.message}`);
            this.process = null;
            this._listening = false;
        });
        // Send initial threshold
        this.sendCommand({ command: 'set_threshold', value: this.threshold });
    }
    killProcess() {
        if (!this.process)
            return;
        try {
            this.sendCommand({ command: 'stop' });
            // Give it a moment to shut down gracefully, then force kill
            const killTimer = setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGKILL');
                    this.process = null;
                }
            }, 2000);
            this.process.on('exit', () => {
                clearTimeout(killTimer);
                this.process = null;
            });
            // Also send SIGTERM immediately
            this.process.kill('SIGTERM');
        }
        catch {
            // Ignore errors during cleanup
        }
        this._listening = false;
        this.process = null;
    }
    sendCommand(cmd) {
        if (!this.process?.stdin?.writable)
            return;
        try {
            this.process.stdin.write(JSON.stringify(cmd) + '\n');
        }
        catch {
            // Ignore write errors
        }
    }
    resolveRunner() {
        const binaryName = process.platform === 'win32' ? 'wake_word.exe' : 'wake_word';
        const resourceRoot = electron_1.app.isPackaged ? process.resourcesPath : path_1.default.resolve(__dirname, '..');
        const binaryPath = path_1.default.join(resourceRoot, 'scripts', 'dist', binaryName);
        if (!electron_1.app.isPackaged) {
            const scriptPath = path_1.default.resolve(__dirname, '..', 'scripts', 'wake_word.py');
            if (fs_1.default.existsSync(scriptPath)) {
                return {
                    cmd: process.platform === 'win32' ? 'python' : 'python3',
                    args: [scriptPath],
                };
            }
        }
        if (fs_1.default.existsSync(binaryPath)) {
            return { cmd: binaryPath, args: [] };
        }
        return null;
    }
    processBuffer() {
        const lines = this.buffer.split('\n');
        // Keep the last incomplete line in the buffer
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const msg = JSON.parse(trimmed);
                this.handleMessage(msg);
            }
            catch {
                console.warn('[WakeWord] Unparseable message:', trimmed);
            }
        }
    }
    handleMessage(msg) {
        const event = msg.event;
        switch (event) {
            case 'detected': {
                const score = msg.score;
                console.log(`[WakeWord] "Jarvis" detected (score=${score})`);
                this.onDetect?.();
                break;
            }
            case 'status': {
                if (typeof msg.listening === 'boolean') {
                    this._listening = msg.listening;
                }
                if (typeof msg.threshold === 'number') {
                    this.threshold = msg.threshold;
                }
                console.log('[WakeWord] Status:', msg.message || JSON.stringify(msg));
                this.onStatus?.({ listening: this._listening });
                break;
            }
            case 'error': {
                const errMsg = msg.message;
                console.error('[WakeWord] Error:', errMsg);
                this.onError?.(errMsg);
                break;
            }
            default: {
                console.log('[WakeWord] Unknown message:', msg);
            }
        }
    }
}
exports.WakeWordService = WakeWordService;
