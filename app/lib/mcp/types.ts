/** MCP Server configuration (from jarvis-mcp.config.json) */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** JSON-RPC 2.0 request */
export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/** Tool definition returned by tools/list */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Content item inside a tool call result */
export interface McpToolCallContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Result returned by tools/call */
export interface McpToolCallResult {
  content: McpToolCallContent[];
  isError?: boolean;
}

/** Pending request tracker */
export interface PendingRequest {
  resolve: (value: McpJsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Runtime state for a connected MCP server */
export interface McpServerState {
  name: string;
  config: McpServerConfig;
  connected: boolean;
  tools: McpToolDefinition[];
  serverInfo: { name: string; version: string } | null;
  buffer: string;
  nextId: number;
}

/** Tool exposed by an MCP server, adapted for Jarvis's function registry */
export interface McpExposedTool {
  name: string;
  label: string;
  description: string;
  serverName: string;
  parameters: Record<string, unknown>;
}

/** Server status summary */
export interface McpServerStatus {
  name: string;
  connected: boolean;
  tools: number;
  serverInfo: { name: string; version: string } | null;
}
