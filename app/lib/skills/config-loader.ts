import { SkillsConfig, SkillDefinition, SkillToolDefinition } from './types';
import path from 'path';
import fs from 'fs';

function resolveSkillsConfigPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'jarvis-skills.config.json'),
    path.join(process.cwd(), '..', 'jarvis-skills.config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadSkillsConfig(): SkillsConfig {
  const configPath = resolveSkillsConfigPath();
  if (!configPath) {
    console.log('[skills] No config file found, skipping skills initialization');
    return { skills: [] };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as SkillsConfig;
    console.log(`[skills] Loaded config: ${config.skills.length} skill(s) defined`);
    return config;
  } catch (err) {
    console.error('[skills] Failed to load config:', err);
    return { skills: [] };
  }
}

export class SkillManager {
  private static instance: SkillManager;
  private skills: SkillDefinition[] = [];
  private initialized = false;

  private constructor() {}

  static getInstance(): SkillManager {
    if (!SkillManager.instance) {
      SkillManager.instance = new SkillManager();
    }
    return SkillManager.instance;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    const config = loadSkillsConfig();
    this.skills = config.skills;
  }

  getTools(): SkillToolDefinition[] {
    this.initialize();
    const tools: SkillToolDefinition[] = [];
    for (const skill of this.skills) {
      for (const tool of skill.tools) {
        tools.push({
          ...tool,
          name: `${skill.name}_${tool.name}`,
        });
      }
    }
    return tools;
  }

  findTool(name: string): SkillToolDefinition | undefined {
    return this.getTools().find(t => t.name === name);
  }

  getSkills(): SkillDefinition[] {
    this.initialize();
    return this.skills;
  }
}
