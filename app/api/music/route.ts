import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import {
  controlWindowsMedia,
  getWindowsNowPlaying,
  isWindowsMediaHost,
} from '@/app/lib/server/windowsMediaSession';

const execAsync = promisify(exec);

// Run a single-line osascript safely
async function osa(line: string): Promise<string> {
  const { stdout } = await execAsync(`osascript -e ${JSON.stringify(line)}`);
  return stdout.trim();
}

// Write script to a temp file and run it — avoids all shell escaping and heredoc issues
async function osaScript(script: string): Promise<string> {
  const tmp = `/tmp/jarvis_music_${Date.now()}.applescript`;
  writeFileSync(tmp, script, 'utf8');
  try {
    const { stdout } = await execAsync(`osascript ${tmp}`);
    return stdout.trim();
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
  }
}

type SupportedApp = 'Spotify' | 'Music';

const MUSIC_APPS: SupportedApp[] = ['Spotify', 'Music'];

async function isRunning(app: string): Promise<boolean> {
  try {
    const result = await osa(`application "${app}" is running`);
    return result === 'true';
  } catch {
    return false;
  }
}

async function detectApp(): Promise<SupportedApp | null> {
  for (const app of MUSIC_APPS) {
    if (await isRunning(app)) return app;
  }
  return null;
}

async function getNowPlaying(app: SupportedApp) {
  if (app === 'Spotify') {
    const raw = await osaScript(`tell application "Spotify"
  if player state is playing or player state is paused then
    set trackTitle to name of current track
    set trackArtist to artist of current track
    set trackAlbum to album of current track
    set trackArtwork to artwork url of current track
    set trackPosition to player position
    set trackDuration to duration of current track
    if player state is playing then
      set trackState to "playing"
    else
      set trackState to "paused"
    end if
    return trackTitle & "||" & trackArtist & "||" & trackAlbum & "||" & trackArtwork & "||" & (round trackPosition) & "||" & (round (trackDuration / 1000)) & "||" & trackState
  else
    return "STOPPED"
  end if
end tell`);

    if (raw === 'STOPPED' || !raw) return null;

    const parts = raw.split('||');
    return {
      app: 'Spotify',
      title:      parts[0]?.trim() ?? '',
      artist:     parts[1]?.trim() ?? '',
      album:      parts[2]?.trim() ?? '',
      artworkUrl: parts[3]?.trim() ?? '',
      position:   parseInt(parts[4] ?? '0', 10),
      duration:   parseInt(parts[5] ?? '0', 10),
      isPlaying:  (parts[6] ?? '').includes('playing'),
    };
  }

  if (app === 'Music') {
    const raw = await osaScript(`tell application "Music"
  if player state is playing or player state is paused then
    set trackTitle to name of current track
    set trackArtist to artist of current track
    set trackAlbum to album of current track
    set trackPosition to player position
    set trackDuration to duration of current track
    if player state is playing then
      set trackState to "playing"
    else
      set trackState to "paused"
    end if
    return trackTitle & "||" & trackArtist & "||" & trackAlbum & "||" & (round trackPosition) & "||" & (round trackDuration) & "||" & trackState
  else
    return "STOPPED"
  end if
end tell`);

    if (raw === 'STOPPED' || !raw) return null;

    const parts = raw.split('||');
    return {
      app: 'Music',
      title:      parts[0]?.trim() ?? '',
      artist:     parts[1]?.trim() ?? '',
      album:      parts[2]?.trim() ?? '',
      artworkUrl: '',
      position:   parseInt(parts[3] ?? '0', 10),
      duration:   parseInt(parts[4] ?? '0', 10),
      isPlaying:  (parts[5] ?? '').includes('playing'),
    };
  }

  return null;
}

// Fallback: use nowplaying-cli if installed (brew install nowplaying-cli)
// This reads the macOS system Now Playing widget — works with any app
async function getNowPlayingFallback() {
  try {
    const paths = [
      '/opt/homebrew/bin/nowplaying-cli',
      '/usr/local/bin/nowplaying-cli',
    ];

    let bin = '';
    for (const p of paths) {
      try {
        await execAsync(`test -f ${p}`);
        bin = p;
        break;
      } catch { /* not found */ }
    }
    if (!bin) return null;

    const fields = ['title', 'artist', 'album', 'artworkURL', 'elapsedTime', 'duration', 'playbackRate'];
    const values = await Promise.all(
      fields.map(async (f) => {
        try {
          const { stdout } = await execAsync(`${bin} get ${f}`);
          return stdout.trim();
        } catch {
          return '';
        }
      })
    );

    const [title, artist, album, artworkUrl, elapsedStr, durationStr, rateStr] = values;
    if (!title) return null;

    return {
      app: 'System',
      title,
      artist,
      album,
      artworkUrl: artworkUrl || '',
      position: Math.round(parseFloat(elapsedStr || '0')),
      duration: Math.round(parseFloat(durationStr || '0')),
      isPlaying: parseFloat(rateStr || '0') > 0,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    if (isWindowsMediaHost()) {
      const win = await getWindowsNowPlaying();
      if (win.ok) return NextResponse.json(win.track);
      return NextResponse.json({ error: win.error });
    }

    // macOS: Try AppleScript apps first
    const app = await detectApp();
    if (app) {
      const track = await getNowPlaying(app);
      if (track) return NextResponse.json(track);
    }

    // Fallback to system Now Playing (any app — browser, etc.)
    const fallback = await getNowPlayingFallback();
    if (fallback) return NextResponse.json(fallback);

    return NextResponse.json({ error: 'Nothing is currently playing.' });
  } catch (err) {
    console.error('[music GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { command, value } = await req.json();

    if (isWindowsMediaHost()) {
      if (!command || typeof command !== 'string') {
        return NextResponse.json({ error: 'Missing command' }, { status: 400 });
      }
      const r = await controlWindowsMedia(command, value);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ success: true, command, app: 'Windows' });
    }

    const app = await detectApp();
    if (!app) return NextResponse.json({ error: 'No supported music app (Spotify/Music) is running for control.' });

    let script = '';
    switch (command) {
      case 'play':
        script = `tell application "${app}" to play`;
        break;
      case 'pause':
        script = `tell application "${app}" to pause`;
        break;
      case 'playpause':
        script = `tell application "${app}" to playpause`;
        break;
      case 'next':
        script = `tell application "${app}" to next track`;
        break;
      case 'previous':
        script = `tell application "${app}" to previous track`;
        break;
      case 'volume': {
        const vol = Math.max(0, Math.min(100, Number(value ?? 50)));
        script = `tell application "${app}" to set sound volume to ${vol}`;
        break;
      }
      case 'volume_up':
        script = `tell application "${app}" to set sound volume to (sound volume + 10)`;
        break;
      case 'volume_down':
        script = `tell application "${app}" to set sound volume to (sound volume - 10)`;
        break;
      default:
        return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 400 });
    }

    await osa(script);
    return NextResponse.json({ success: true, command, app });
  } catch (err) {
    console.error('[music POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
