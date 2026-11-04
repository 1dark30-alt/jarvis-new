import { FUNCTION_REGISTRY, JarvisFunction } from './functions';

export interface DynamicFunctionState {
  allFunctions: JarvisFunction[];
  mcpFunctions: JarvisFunction[];
  skillFunctions: JarvisFunction[];
  loaded: boolean;
  loadError: string | null;
}

function createMcpHandler(
  serverName: string,
  toolName: string,
): (args: Record<string, unknown>) => Promise<unknown> {
  return async (args) => {
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName, tool: toolName, arguments: args }),
      });
      const data = await res.json();
      // Flatten MCP content array to a simple result
      if (data.content && Array.isArray(data.content)) {
        const textParts = data.content
          .filter(
            (c: { type: string; text?: string }) => c.type === 'text' && c.text,
          )
          .map((c: { text: string }) => c.text);
        return { result: textParts.join('\n'), raw: data };
      }
      return data;
    } catch (err) {
      return { error: String(err) };
    }
  };
}

function createSkillHandler(toolDef: {
  name?: string;
}): (args: Record<string, unknown>) => Promise<unknown> {
  return async (args) => {
    try {
      const toolName = toolDef.name || '';
      const res = await fetch('/api/skills/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: toolName, arguments: args }),
      });
      return await res.json();
    } catch (err) {
      return { error: String(err) };
    }
  };
}

/**
 * Fetch all dynamic functions from MCP and Skills APIs.
 * Merges them with the static FUNCTION_REGISTRY using collision resolution:
 * static > MCP > skills.
 */
export const loadDynamicFunctions: () => Promise<DynamicFunctionState> =
  async () => {
    try {
      const [mcpRes, skillsRes] = await Promise.allSettled([
        fetch('/api/mcp').then((r) => (r.ok ? r.json() : { tools: [] })),
        fetch('/api/skills').then((r) =>
          r.ok ? r.json() : { tools: [], skills: [] },
        ),
      ]);

      const mcpData =
        mcpRes.status === 'fulfilled' ? mcpRes.value : { tools: [] };
      const skillsData =
        skillsRes.status === 'fulfilled' ? skillsRes.value : { tools: [] };

      // Create JarvisFunction entries for MCP tools
      const mcpFunctions: JarvisFunction[] = (mcpData.tools || []).map(
        (tool: any) => ({
          name: tool.name,
          label: tool.label || tool.name,
          description:
            tool.description || `MCP tool from "${tool.serverName}"`,
          tool: {
            type: 'function' as const,
            name: tool.name,
            description: tool.description || `MCP tool: ${tool.name}`,
            parameters: tool.parameters || {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          handler: createMcpHandler(tool.serverName, tool.name),
        }),
      );

      // Create JarvisFunction entries for Skill tools
      const skillFunctions: JarvisFunction[] = (skillsData.tools || []).map(
        (tool: any) => ({
          name: tool.name,
          label: tool.label || tool.name,
          description: tool.description || `Skill tool`,
          tool: {
            type: 'function' as const,
            name: tool.name,
            description: tool.description || `Skill: ${tool.name}`,
            parameters: tool.parameters || {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          handler: createSkillHandler(tool),
        }),
      );

      // Merge with collision resolution (static > MCP > skills)
      const staticNames = new Set(FUNCTION_REGISTRY.map((f) => f.name));
      const mcpNames = new Set<string>();

      const filteredMcp = mcpFunctions.filter((f) => {
        if (staticNames.has(f.name)) {
          console.warn(
            `[dynamic-fn] Name collision: MCP tool "${f.name}" conflicts with built-in function. Skipping.`,
          );
          return false;
        }
        mcpNames.add(f.name);
        return true;
      });

      const filteredSkills = skillFunctions.filter((f) => {
        if (staticNames.has(f.name) || mcpNames.has(f.name)) {
          console.warn(
            `[dynamic-fn] Name collision: Skill tool "${f.name}" conflicts with existing function. Skipping.`,
          );
          return false;
        }
        return true;
      });

      const allFunctions = [
        ...FUNCTION_REGISTRY,
        ...filteredMcp,
        ...filteredSkills,
      ];

      // Inject platform context into the shell command tool description so the AI
      // knows the user's OS without having to ask or guess.
      const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
      if (platform !== 'unknown') {
        const shellTool = allFunctions.find((f) => f.name === 'run_shell_command');
        if (shellTool) {
          const platformLabel = platform.startsWith('Win')
            ? 'Windows'
            : platform.startsWith('Mac')
              ? 'macOS'
              : 'Linux';
          if (!shellTool.tool.description.startsWith('[User OS:')) {
            shellTool.tool.description = `[User OS: ${platformLabel}] ${shellTool.tool.description}`;
          }
        }
      }

      return {
        allFunctions,
        mcpFunctions: filteredMcp,
        skillFunctions: filteredSkills,
        loaded: true,
        loadError: null,
      };
    } catch (err) {
      console.error('[dynamic-fn] Failed to load dynamic functions:', err);
      return {
        allFunctions: FUNCTION_REGISTRY,
        mcpFunctions: [],
        skillFunctions: [],
        loaded: true, // Still mark as loaded so app can proceed
        loadError: String(err),
      };
    }
  };

/**
 * Create a function name lookup that searches all sources.
 */
export function createGetFunctionByName(allFunctions: JarvisFunction[]) {
  return (name: string): JarvisFunction | undefined => {
    return allFunctions.find((f) => f.name === name);
  };
}
