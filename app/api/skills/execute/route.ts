import { NextRequest, NextResponse } from 'next/server';
import { SkillManager } from '@/app/lib/skills/config-loader';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const TIMEOUT_MS = 30_000;

/** Resolve the system shell for the current platform. */
function resolveShell(command: string): { shell: string; args: string[] } {
  const platform = process.platform;
  const isWindows = platform === 'win32' || process.env.OS === 'Windows_NT';

  if (isWindows) {
    const comSpec =
      process.env.ComSpec && process.env.ComSpec.trim().replace(/^["']+|["']+$/g, '');
    const systemRoot =
      (process.env.SystemRoot || process.env.windir || '').replace(/^["']+|["']+$/g, '');
    const candidates: string[] = [];

    if (comSpec && !/%[^%]+%/.test(comSpec) && fs.existsSync(comSpec)) {
      candidates.push(comSpec);
    }
    if (systemRoot && !/%[^%]+%/.test(systemRoot)) {
      candidates.push(
        path.join(systemRoot, 'System32', 'cmd.exe'),
        path.join(systemRoot, 'Sysnative', 'cmd.exe'),
      );
    }
    candidates.push('C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\Sysnative\\cmd.exe');

    for (const shell of candidates) {
      if (fs.existsSync(shell)) {
        return { shell, args: ['/d', '/s', '/c', command] };
      }
    }
    // Last resort — let the OS resolve it
    return { shell: 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }

  // Unix — prefer sh for simplicity and wide compatibility
  if (fs.existsSync('/bin/sh')) {
    return { shell: '/bin/sh', args: ['-c', command] };
  }
  if (fs.existsSync('/bin/bash')) {
    return { shell: '/bin/bash', args: ['-c', command] };
  }
  return { shell: 'sh', args: ['-c', command] };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, arguments: args } = body as {
      name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!name) {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 },
      );
    }

    const manager = SkillManager.getInstance();
    manager.initialize();
    const tool = manager.findTool(name);

    if (!tool) {
      return NextResponse.json(
        { error: `Skill tool "${name}" not found` },
        { status: 404 },
      );
    }

    // Handle MCP type — proxy to MCP server
    if (tool.handler.type === 'mcp') {
      const { McpServerManager } = await import('@/app/lib/mcp/server-manager');
      const mcpManager = McpServerManager.getInstance();
      await mcpManager.initialize();
      const result = await mcpManager.callTool(
        tool.handler.server,
        tool.handler.tool,
        args ?? {},
      );
      return NextResponse.json(result);
    }

    // Handle Shell type — execute shell command via spawn
    if (tool.handler.type === 'shell') {
      // Substitute ${paramName} tokens with function arguments
      let command = tool.handler.command;
      if (args && typeof args === 'object') {
        for (const [key, value] of Object.entries(args)) {
          command = command.replaceAll(`\${${key}}`, String(value ?? ''));
        }
      }
      const { shell, args: shellArgs } = resolveShell(command);

      console.log(`[skills] Executing shell command: ${command}`);

      const result = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
      }>((resolve) => {
        const proc = spawn(shell, shellArgs, {
          env: {
            ...process.env,
            PATH: [
              process.env.PATH,
              '/opt/homebrew/bin',
              '/opt/homebrew/sbin',
              '/usr/local/bin',
              process.platform === 'win32'
                ? 'C:\\Windows\\System32'
                : '/usr/bin:/bin',
            ]
              .filter(Boolean)
              .join(path.delimiter),
          },
          ...(process.platform === 'win32'
            ? {
                windowsHide: true,
                cwd:
                  process.env.USERPROFILE ||
                  (process.env.SystemDrive
                    ? `${process.env.SystemDrive}\\`
                    : 'C:\\'),
              }
            : {}),
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (d: Buffer) => {
          stdout += d.toString();
        });

        proc.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
        });

        const timer = setTimeout(() => {
          proc.kill();
          resolve({
            stdout: stdout.trim(),
            stderr: `Command timed out after ${TIMEOUT_MS / 1000}s`,
            exitCode: 124,
          });
        }, TIMEOUT_MS);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? 0,
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ stdout: '', stderr: err.message, exitCode: 1 });
        });
      });

      if (result.exitCode !== 0) {
        console.warn(
          `[skills] Shell command exited with code ${result.exitCode}: ${result.stderr}`,
        );
      }

      return NextResponse.json({
        content: [{ type: 'text', text: result.stdout || result.stderr }],
        isError: result.exitCode !== 0,
      });
    }

    return NextResponse.json(
      { error: `Unknown handler type` },
      { status: 500 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
