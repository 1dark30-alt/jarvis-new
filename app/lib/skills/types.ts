/** Handler types for skill tool execution */
export type SkillHandlerType = 'mcp' | 'shell';

/** MCP handler — proxies execution to an MCP server tool */
export interface SkillMcpHandler {
  type: 'mcp';
  server: string; // MCP server name from jarvis-mcp.config.json
  tool: string;   // MCP tool name to call
}

/** Shell handler — executes a shell command */
export interface SkillShellHandler {
  type: 'shell';
  command: string; // Shell command to execute
}

export type SkillHandlerConfig = SkillMcpHandler | SkillShellHandler;

/** A single tool exposed by a skill */
export interface SkillToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for tool parameters
  handler: SkillHandlerConfig;
}

/** A composable capability bundle consisting of one or more tools */
export interface SkillDefinition {
  name: string;
  description: string;
  tools: SkillToolDefinition[];
}

/** Top-level skills configuration */
export interface SkillsConfig {
  skills: SkillDefinition[];
}
