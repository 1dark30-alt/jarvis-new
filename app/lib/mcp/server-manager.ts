import { spawn, ChildProcess } from 'child_process';
import {
  McpConfig,
  McpServerConfig,
  McpServerState,
  McpToolDefinition,
  McpToolCallResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpExposedTool,
  McpServerStatus,
  PendingRequest,
} from './types';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { GOOGLE_CALENDAR_SERVER_NAME, JARVIS_DATA_DIR } from './dynamic-config';
import { getGoogleServiceEnvForServerName } from './google-service-runtime';

// Ensure required env vars are set for specific servers regardless of how they
// were originally registered (e.g. after an app restart with a saved config).
function applyServerEnvDefaults(name: string, cfg: McpServerConfig): McpServerConfig {
  const serviceEnv = getGoogleServiceEnvForServerName(name);
  if (serviceEnv) {
    return { ...cfg, env: { ...serviceEnv, ...(cfg.env ?? {}) } };
  }

  if (name !== GOOGLE_CALENDAR_SERVER_NAME) return cfg;

  const env = { ...(cfg.env ?? {}) };

  // Redirect XDG_CONFIG_HOME to ~/.jarvis so token files are stored in a
  // directory we control (macOS often lacks ~/.config by default).
  if (!env['XDG_CONFIG_HOME']) {
    if (!fs.existsSync(JARVIS_DATA_DIR)) {
      fs.mkdirSync(JARVIS_DATA_DIR, { recursive: true });
    }
    env['XDG_CONFIG_HOME'] = JARVIS_DATA_DIR;
  }
  if (!env['HOME']) {
    env['HOME'] = os.homedir();
  }

  return { ...cfg, env };
}

const REQUEST_TIMEOUT_MS = 30_000;
const MCP_PROTOCOL_VERSION = '2025-03-26';

function getDynamicConfigPath(): string {
  return path.join(os.homedir(), '.jarvis', 'mcp-dynamic.json');
}

function loadConfig(): McpConfig {
  const dynamicPath = getDynamicConfigPath();
  const mcpServers: Record<string, McpServerConfig> = {};

  // 1. Load from ~/.jarvis/mcp-dynamic.json (user config — survives restart)
  try {
    const dir = path.dirname(dynamicPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(dynamicPath)) {
      const raw = fs.readFileSync(dynamicPath, 'utf-8');
      const config = JSON.parse(raw) as McpConfig;
      Object.assign(mcpServers, config.mcpServers);
      console.log(`[mcp] Loaded ${Object.keys(config.mcpServers).length} server(s) from user config`);
    }
  } catch (err) {
    console.error('[mcp] Failed to load user config:', err);
  }

  // 2. Also load from project root jarvis-mcp.config.json if it exists (dev convenience)
  const projectCandidates = [
    path.join(process.cwd(), 'jarvis-mcp.config.json'),
    path.join(process.cwd(), '..', 'jarvis-mcp.config.json'),
  ];
  for (const p of projectCandidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const config = JSON.parse(raw) as McpConfig;
        // Project config OVERRIDES user config for same-named servers (dev convenience)
        Object.assign(mcpServers, config.mcpServers);
        console.log(`[mcp] Merged ${Object.keys(config.mcpServers).length} server(s) from project config`);
      } catch (err) {
        console.error('[mcp] Failed to load project config:', err);
      }
      break;
    }
  }

  return { mcpServers };
}

export class McpServerManager {
  private static instance: McpServerManager;
  private servers: Map<string, McpServerState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): McpServerManager {
    if (!McpServerManager.instance) {
      McpServerManager.instance = new McpServerManager();
    }
    return McpServerManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const config = loadConfig();
    const servers = Object.entries(config.mcpServers).filter(
      ([, cfg]) => !cfg.disabled,
    );

    if (servers.length === 0) {
      console.log('[mcp] No enabled MCP servers configured');
      return;
    }

    console.log(`[mcp] Initializing ${servers.length} MCP server(s)...`);

    const results = await Promise.allSettled(
      servers.map(([name, cfg]) => this.connectServer(name, applyServerEnvDefaults(name, cfg))),
    );

    let failures = 0;
    for (const r of results) {
      if (r.status === 'rejected') failures++;
    }

    const connected = [...this.servers.values()].filter((s) => s.connected).length;
    console.log(
      `[mcp] ${connected}/${servers.length} server(s) connected` +
        (failures > 0 ? ` (${failures} failed)` : ''),
    );
  }

  public async connectServer(
    name: string,
    config: McpServerConfig,
  ): Promise<void> {
    console.log(`[mcp] Connecting to server: ${name} (${config.command})`);

    const env = { ...process.env } as Record<string, string | undefined>;
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        env[key] = value;
      }
    }

    const proc = spawn(config.command, config.args, {
      env: env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(name, proc);

    const state: McpServerState = {
      name,
      config,
      connected: false,
      tools: [],
      serverInfo: null,
      buffer: '',
      nextId: 1,
    };

    this.servers.set(name, state);

    proc.stdout!.on('data', (data: Buffer) => {
      this.onStdoutData(name, data);
    });

    proc.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trimEnd();
      if (text) {
        console.log(`[mcp:${name}:stderr] ${text}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[mcp] Server "${name}" error:`, err.message);
      state.connected = false;
      this.rejectAllPending(name, err);
    });

    proc.on('close', (code) => {
      console.log(`[mcp] Server "${name}" exited with code ${code}`);
      state.connected = false;
      this.rejectAllPending(
        name,
        new Error(`Server "${name}" exited with code ${code}`),
      );
      this.servers.delete(name);
      this.processes.delete(name);
    });

    try {
      await this.waitForSpawn(proc, name);
      await this.performInitialize(name);
      await this.fetchTools(name);

      state.connected = true;
      console.log(
        `[mcp] Server "${name}" initialized: ${state.tools.length} tool(s) available`,
      );
    } catch (err) {
      console.error(`[mcp] Failed to connect server "${name}":`, err);
      proc.kill();
      this.processes.delete(name);
      this.servers.delete(name);
      throw err;
    }
  }

  private waitForSpawn(proc: ChildProcess, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for server "${name}" to spawn`));
      }, 10_000);

      proc.on('spawn', () => {
        clearTimeout(timer);
        resolve();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async performInitialize(name: string): Promise<void> {
    const response = await this.sendRequest(name, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'jarvis',
        version: '5.0.0',
      },
    });

    if (response.error) {
      throw new Error(
        `Initialize failed for "${name}": ${response.error.message}`,
      );
    }

    const state = this.servers.get(name);
    if (state && response.result) {
      const serverInfo = response.result.serverInfo as
        | { name: string; version: string }
        | undefined;
      if (serverInfo) {
        state.serverInfo = serverInfo;
      }
    }

    // Send initialized notification (no id — it's a notification, per JSON-RPC 2.0 spec)
    const notification = {
      jsonrpc: '2.0' as const,
      method: 'notifications/initialized',
    };
    const stateForWrite = this.servers.get(name);
    if (stateForWrite) {
      const raw = JSON.stringify(notification) + '\n';
      const proc = this.processes.get(name);
      if (proc?.stdin) {
        proc.stdin.write(raw);
      }
    }
  }

  private async fetchTools(name: string): Promise<void> {
    const response = await this.sendRequest(name, 'tools/list');

    if (response.error) {
      console.error(
        `[mcp] Failed to list tools for "${name}": ${response.error.message}`,
      );
      return;
    }

    const state = this.servers.get(name);
    if (state && response.result) {
      const tools = response.result.tools as McpToolDefinition[] | undefined;
      if (Array.isArray(tools)) {
        state.tools = tools;
      }
    }
  }

  private onStdoutData(name: string, data: Buffer): void {
    const state = this.servers.get(name);
    if (!state) return;

    state.buffer += data.toString();
    const lines = state.buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    state.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as McpJsonRpcResponse;
        this.dispatchResponse(name, msg);
      } catch (err) {
        console.error(
          `[mcp] Failed to parse JSON from "${name}":`,
          err,
          `\n  Raw: ${trimmed.slice(0, 300)}`,
        );
      }
    }
  }

  private dispatchResponse(name: string, msg: McpJsonRpcResponse): void {
    // Notifications (no id or empty string id) — acknowledge silently
    if (msg.id === undefined || msg.id === null || msg.id === '') {
      return;
    }

    const key = `${name}:${msg.id}`;
    const pending = this.pendingRequests.get(key);
    if (pending) {
      this.pendingRequests.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(msg);
    }
  }

  private sendRequest(
    serverName: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<McpJsonRpcResponse> {
    const state = this.servers.get(serverName);
    if (!state) {
      return Promise.reject(
        new Error(`MCP server "${serverName}" is not connected`),
      );
    }

    const proc = this.processes.get(serverName);
    if (!proc?.stdin || !proc?.stdin.writable) {
      return Promise.reject(
        new Error(`MCP server "${serverName}" stdin is not available`),
      );
    }

    return new Promise((resolve, reject) => {
      const id = state.nextId++;
      const request: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const key = `${serverName}:${id}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(key);
        reject(
          new Error(
            `Request "${method}" (id=${id}) to "${serverName}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(key, { resolve, reject, timer });

      const message = JSON.stringify(request) + '\n';
      proc.stdin!.write(message);
    });
  }

  private rejectAllPending(name: string, err: Error): void {
    const toReject: string[] = [];
    for (const [key, pending] of this.pendingRequests.entries()) {
      if (key.startsWith(`${name}:`)) {
        toReject.push(key);
        clearTimeout(pending.timer);
        pending.reject(err);
      }
    }
    for (const key of toReject) {
      this.pendingRequests.delete(key);
    }
  }

  listTools(): McpExposedTool[] {
    const tools: McpExposedTool[] = [];
    for (const state of this.servers.values()) {
      if (!state.connected) continue;
      for (const tool of state.tools) {
        tools.push({
          name: tool.name,
          label: tool.name
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          description: tool.description || `MCP tool: ${tool.name}`,
          serverName: state.name,
          parameters: tool.inputSchema,
        });
      }
    }
    return tools;
  }

  getServerStatus(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];
    for (const state of this.servers.values()) {
      statuses.push({
        name: state.name,
        connected: state.connected,
        tools: state.tools.length,
        serverInfo: state.serverInfo,
      });
    }
    return statuses;
  }

  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  getServer(name: string): McpServerState | undefined {
    return this.servers.get(name);
  }

  async addServerConfig(name: string, config: McpServerConfig): Promise<void> {
    const servers: Record<string, McpServerConfig> = {};
    const dynamicPath = getDynamicConfigPath();
    const dir = path.dirname(dynamicPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(dynamicPath)) {
      try {
        const raw = fs.readFileSync(dynamicPath, 'utf-8');
        const existing = JSON.parse(raw) as McpConfig;
        Object.assign(servers, existing.mcpServers);
      } catch (err) {
        console.error('[mcp] Failed to read dynamic config:', err);
      }
    }
    servers[name] = config;
    this.saveDynamicConfig(servers);
    await this.connectServer(name, config);
  }

  async removeServer(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      try {
        if (proc.stdin) {
          proc.stdin.end();
        }
      } catch {
        void 0;
      }
      proc.kill();
      this.processes.delete(name);
    }
    this.servers.delete(name);

    const dynamicPath = getDynamicConfigPath();
    if (fs.existsSync(dynamicPath)) {
      try {
        const raw = fs.readFileSync(dynamicPath, 'utf-8');
        const config = JSON.parse(raw) as McpConfig;
        delete config.mcpServers[name];
        this.saveDynamicConfig(config.mcpServers);
        console.log(`[mcp] Removed server "${name}" from dynamic config`);
      } catch (err) {
        console.error('[mcp] Failed to update dynamic config on remove:', err);
      }
    }
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const state = this.servers.get(serverName);
    if (!state || !state.connected) {
      return {
        content: [
          {
            type: 'text',
            text: `MCP server "${serverName}" is not connected`,
          },
        ],
        isError: true,
      };
    }

    try {
      const response = await this.sendRequest(serverName, 'tools/call', {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error calling "${toolName}" on "${serverName}": ${response.error.message}`,
            },
          ],
          isError: true,
        };
      }

      if (
        response.result &&
        typeof response.result === 'object' &&
        'content' in response.result
      ) {
        return response.result as unknown as McpToolCallResult;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.result ?? {}),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `MCP call failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private saveDynamicConfig(servers: Record<string, McpServerConfig>): void {
    const dynamicPath = getDynamicConfigPath();
    const dir = path.dirname(dynamicPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write to temp file first, then rename atomically to prevent corruption
    const tmpPath = dynamicPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ mcpServers: servers }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, dynamicPath);
  }

  async shutdown(): Promise<void> {
    const names = [...this.processes.keys()];
    if (names.length === 0) return;

    console.log(`[mcp] Shutting down ${names.length} server(s)...`);

    await Promise.allSettled(
      names.map(async (name) => {
        const proc = this.processes.get(name);
        if (!proc) return;

        try {
          await this.sendRequest(name, 'shutdown');
        } catch {
          // Server may already be gone — that's fine
        }

        if (proc.stdin) {
          try {
            proc.stdin.end();
          } catch {
            void 0;
          }
        }
        proc.kill();
        this.servers.delete(name);
        this.processes.delete(name);
      }),
    );

    this.initialized = false;
    console.log('[mcp] All servers shut down');
  }
}

// Register cleanup handlers for MCP child processes
function registerMcpCleanup(): void {
  const cleanup = () => {
    const manager = McpServerManager.getInstance();
    if (manager) {
      manager.shutdown().catch(() => {});
    }
  };

  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGHUP', () => { cleanup(); process.exit(0); });
}

// Auto-register on import
registerMcpCleanup();
