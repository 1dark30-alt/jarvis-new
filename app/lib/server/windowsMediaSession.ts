import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type WindowsTrackPayload = {
  app: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  position: number;
  duration: number;
  isPlaying: boolean;
};

function powershellExe(): string {
  const root = process.env.SystemRoot || process.env.windir || '';
  if (root && !/%[^%]+%/.test(root)) {
    const p = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'powershell.exe';
}

function runPs(scriptBody: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `jarvis_music_${Date.now()}_${Math.random().toString(16).slice(2)}.ps1`);
  fs.writeFileSync(tmp, `\ufeff${scriptBody}`, 'utf8');
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      {
        timeout: 20_000,
        windowsHide: true,
        maxBuffer: 2_000_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          Path: [
            process.env.Path || process.env.PATH,
            'C:\\Windows\\System32',
            'C:\\Windows',
          ]
            .filter(Boolean)
            .join(';'),
          PATH: [
            process.env.Path || process.env.PATH,
            'C:\\Windows\\System32',
            'C:\\Windows',
          ]
            .filter(Boolean)
            .join(';'),
        },
      },
      (err, stdout, stderr) => {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        if (err) {
          reject(new Error(String(stderr || (err instanceof Error ? err.message : err))));
          return;
        }
        resolve((stdout ?? '').trim());
      }
    );
  });
}

/** WinRT await helper + session manager. Windows PowerShell 5.1 only (ships with Windows). */
const PS_WINRT = [
  '$ErrorActionPreference = "Stop"',
  '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Media.MediaPlaybackStatus,Windows.Media,ContentType=WindowsRuntime] | Out-Null',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
  '  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\'',
  '})[0]',
  'function Await-WinRt {',
  '  param($WinRtTask, [type]$ResultType)',
  '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
  '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
  '  $null = $netTask.Wait(-1)',
  '  return $netTask.Result',
  '}',
  '$script:MediaMgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
].join('\n');

export async function getWindowsNowPlaying(): Promise<
  | { ok: true; track: WindowsTrackPayload }
  | { ok: false; error: string }
> {
  const script = [
    PS_WINRT,
    'try {',
    '  $session = $script:MediaMgr.GetCurrentSession()',
    '  if ($null -eq $session) { @{ error = "No active Windows media session." } | ConvertTo-Json -Compress; exit 0 }',
    '  $playback = $session.GetPlaybackInfo()',
    '  $status = $playback.PlaybackStatus',
    '  $props = Await-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
    '  $tl = $session.GetTimelineProperties()',
    '  $posSec = 0',
    '  $durSec = 0',
    '  if ($null -ne $tl) {',
    '    $posSec = [int][Math]::Floor([Math]::Max(0, $tl.Position.TotalSeconds))',
    '    $durSec = [int][Math]::Floor([Math]::Max(0, $tl.EndTime.TotalSeconds))',
    '  }',
    '  if ($durSec -gt 864000) { $durSec = 0 }',
    '  $app = $session.SourceAppUserModelId',
    '  $isPlaying = ($status -eq [Windows.Media.MediaPlaybackStatus]::Playing)',
    '  $title = $props.Title',
    '  $artist = $props.Artist',
    '  $album = $props.AlbumTitle',
    '  if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($artist)) {',
    '    @{ error = "No track metadata from media session." } | ConvertTo-Json -Compress; exit 0',
    '  }',
    '  @{',
    '    app = ([string]$app)',
    '    title = ([string]$title)',
    '    artist = ([string]$artist)',
    '    album = ([string]$album)',
    '    artworkUrl = ""',
    '    position = [int]$posSec',
    '    duration = [int]$durSec',
    '    isPlaying = [bool]$isPlaying',
    '  } | ConvertTo-Json -Compress -Depth 6',
    '} catch {',
    '  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress',
    '}',
  ].join('\n');

  try {
    const raw = await runPs(script);
    if (!raw) {
      return { ok: false, error: 'Empty response from Windows media script.' };
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.error === 'string') {
      return { ok: false, error: parsed.error };
    }
    const track: WindowsTrackPayload = {
      app: String(parsed.app ?? 'Windows'),
      title: String(parsed.title ?? ''),
      artist: String(parsed.artist ?? ''),
      album: String(parsed.album ?? ''),
      artworkUrl: String(parsed.artworkUrl ?? ''),
      position: Number(parsed.position ?? 0),
      duration: Number(parsed.duration ?? 0),
      isPlaying: Boolean(parsed.isPlaying),
    };
    return { ok: true, track };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Windows media query failed: ${msg}. Use Windows 10 (1803+) / 11 with Groove / Spotify / Edge media playing.`,
    };
  }
}

const KBD_VOLUME_TYPES = [
  'Add-Type @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class JarvisVolKey {',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);',
  '  public static void Up() {',
  '    keybd_event(0xAF, 0, 0, UIntPtr.Zero);',
  '    keybd_event(0xAF, 0, 2, UIntPtr.Zero);',
  '  }',
  '  public static void Down() {',
  '    keybd_event(0xAE, 0, 0, UIntPtr.Zero);',
  '    keybd_event(0xAE, 0, 2, UIntPtr.Zero);',
  '  }',
  '}',
  '"@',
].join('\n');

export async function controlWindowsMedia(command: string, value?: number): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const isVolumeKey =
    command === 'volume' || command === 'volume_up' || command === 'volume_down';

  let body: string;
  switch (command) {
    case 'play':
      body =
        'Await-WinRt ($session.TryPlayAsync()) ([bool]) | Out-Null';
      break;
    case 'pause':
      body =
        'Await-WinRt ($session.TryPauseAsync()) ([bool]) | Out-Null';
      break;
    case 'playpause':
      body = [
        '$pb = $session.GetPlaybackInfo()',
        'if ($pb.PlaybackStatus -eq [Windows.Media.MediaPlaybackStatus]::Playing) {',
        '  Await-WinRt ($session.TryPauseAsync()) ([bool]) | Out-Null',
        '} else {',
        '  Await-WinRt ($session.TryPlayAsync()) ([bool]) | Out-Null',
        '}',
      ].join('\n');
      break;
    case 'next':
      body =
        'Await-WinRt ($session.TrySkipNextAsync()) ([bool]) | Out-Null';
      break;
    case 'previous':
      body =
        'Await-WinRt ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null';
      break;
    case 'volume_up':
      body = ['JarvisVolKey::Up()', 'Start-Sleep -Milliseconds 40'].join('\n');
      break;
    case 'volume_down':
      body = ['JarvisVolKey::Down()', 'Start-Sleep -Milliseconds 40'].join('\n');
      break;
    case 'volume': {
      const v = Math.max(0, Math.min(100, Number(value ?? 50)));
      const steps = Math.round((v / 100) * 50);
      body = [
        'for ($i = 0; $i -lt 50; $i++) { JarvisVolKey::Down(); Start-Sleep -Milliseconds 8 }',
        `for ($i = 0; $i -lt ${steps}; $i++) { JarvisVolKey::Up(); Start-Sleep -Milliseconds 8 }`,
      ].join('\n');
      break;
    }
    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }

  const script = isVolumeKey
    ? [
        '$ErrorActionPreference = "Stop"',
        KBD_VOLUME_TYPES,
        'try {',
        body,
        "  @{ success = $true } | ConvertTo-Json -Compress",
        '} catch {',
        "  @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress",
        '}',
      ].join('\n')
    : [
        PS_WINRT,
        'try {',
        '  $session = $script:MediaMgr.GetCurrentSession()',
        '  if ($null -eq $session) { throw "No active Windows media session." }',
        body,
        "  @{ success = $true } | ConvertTo-Json -Compress",
        '} catch {',
        "  @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress",
        '}',
      ].join('\n');

  try {
    const raw = await runPs(script);
    if (!raw) {
      return { ok: false, error: 'Empty response from media control script.' };
    }
    const parsed = JSON.parse(raw) as { success?: boolean; error?: string };
    if (!parsed.success) {
      return { ok: false, error: parsed.error || 'Media control failed.' };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function isWindowsMediaHost(): boolean {
  return process.platform === 'win32' || process.env.OS === 'Windows_NT';
}
