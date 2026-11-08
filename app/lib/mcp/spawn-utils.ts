import path from 'path';
import fs from 'fs';

/**
 * On Windows, `npx` (and `npm`) are .cmd batch files. child_process.spawn()
 * cannot execute .cmd files directly — it fails with ENOENT (and modern Node
 * versions refuse to shell out to batch files implicitly for security).
 *
 * Resolve such commands to the real node.exe plus the npm/npx CLI script from
 * the running Node distribution, so the spawned process is a proper, killable
 * child process with clean stdio pipes (no cmd.exe wrapper, no orphaned
 * processes on kill).
 *
 * Returns the resolved command plus any args that must be prepended.
 * Non-Windows platforms and unresolvable paths pass through unchanged.
 */
export function resolveSpawnTarget(command: string): { command: string; args: string[] } {
  if (
    process.platform === 'win32' &&
    (command === 'npx' || command === 'npm')
  ) {
    const nodeExe = process.execPath;
    const cli = path.join(
      path.dirname(nodeExe),
      'node_modules',
      'npm',
      'bin',
      command === 'npx' ? 'npx-cli.js' : 'npm-cli.js',
    );
    if (fs.existsSync(cli)) {
      return { command: nodeExe, args: [cli] };
    }
  }
  return { command, args: [] };
}
